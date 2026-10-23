import { createHash, randomBytes, randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { DatabaseSync } from "node:sqlite";
import path from "path";

/*
 * Borderfall accounts: everything the account service (AccountService.ts)
 * keeps, in one SQLite file. Only the master process opens it; workers reach
 * the service over HTTP like they reached OpenFront's API.
 */

export type Provider = "discord" | "google";

export interface Account {
  id: string; // uuid; the JWT subject and the persistentID in game records
  publicId: string;
  discordId: string | null;
  googleId: string | null;
  email: string | null;
  emailVerified: boolean;
  discord: DiscordProfile | null;
  createdAt: string;
}

export interface DiscordProfile {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  discriminator: string;
}

export interface StatLine {
  gameType: string;
  mode: string;
  difficulty: string;
  wins: number;
  losses: number;
  total: number;
}

/** Login sessions last this long without signing in again (30 days). */
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const PUBLIC_ID_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class AccountStore {
  private db: DatabaseSync;

  /** `file` ":memory:" for tests. */
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        public_id TEXT UNIQUE NOT NULL,
        discord_id TEXT UNIQUE,
        google_id TEXT UNIQUE,
        email TEXT,
        email_verified INTEGER NOT NULL DEFAULT 0,
        discord_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS signing_keys (
        kid TEXT PRIMARY KEY,
        private_jwk TEXT NOT NULL,
        public_jwk TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recorded_games (game_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS stats (
        account_id TEXT NOT NULL,
        game_type TEXT NOT NULL,
        mode TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, game_type, mode, difficulty)
      );
    `);
  }

  private row(r: Record<string, unknown> | undefined): Account | null {
    if (r === undefined) return null;
    return {
      id: r.id as string,
      publicId: r.public_id as string,
      discordId: (r.discord_id as string | null) ?? null,
      googleId: (r.google_id as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      emailVerified: r.email_verified === 1,
      discord:
        r.discord_json === null || r.discord_json === undefined
          ? null
          : (JSON.parse(r.discord_json as string) as DiscordProfile),
      createdAt: r.created_at as string,
    };
  }

  byId(id: string): Account | null {
    return this.row(
      this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id),
    );
  }

  byPublicId(publicId: string): Account | null {
    return this.row(
      this.db
        .prepare("SELECT * FROM accounts WHERE public_id = ?")
        .get(publicId),
    );
  }

  /**
   * The account for this sign-in: the one already linked to the provider
   * account, else one with the same verified email (so Discord and Google
   * with one address are one account), else a new one. Keeps the email and
   * Discord profile current.
   */
  signIn(
    provider: Provider,
    providerId: string,
    email: string | null,
    emailVerified: boolean,
    discord: DiscordProfile | null,
  ): Account {
    const column = provider === "discord" ? "discord_id" : "google_id";
    let account = this.row(
      this.db
        .prepare(`SELECT * FROM accounts WHERE ${column} = ?`)
        .get(providerId),
    );
    if (account === null && email !== null && emailVerified) {
      account = this.row(
        this.db
          .prepare(
            "SELECT * FROM accounts WHERE email = ? AND email_verified = 1",
          )
          .get(email),
      );
    }
    if (account === null) {
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO accounts (id, public_id, created_at) VALUES (?, ?, ?)`,
        )
        .run(id, this.newPublicId(), new Date().toISOString());
      account = this.byId(id)!;
    }
    this.db
      .prepare(
        `UPDATE accounts SET ${column} = ?,
           email = COALESCE(?, email),
           email_verified = CASE WHEN ? IS NULL THEN email_verified ELSE ? END,
           discord_json = COALESCE(?, discord_json)
         WHERE id = ?`,
      )
      .run(
        providerId,
        email,
        email,
        emailVerified ? 1 : 0,
        discord === null ? null : JSON.stringify(discord),
        account.id,
      );
    return this.byId(account.id)!;
  }

  private newPublicId(): string {
    for (;;) {
      const bytes = randomBytes(8);
      const id = [...bytes]
        .map((b) => PUBLIC_ID_CHARS[b % PUBLIC_ID_CHARS.length])
        .join("");
      if (this.byPublicId(id) === null) return id;
    }
  }

  /** A new login session for the account; returns the cookie's token. */
  createSession(accountId: string, now = Date.now()): string {
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare(
        "INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)",
      )
      .run(hash(token), accountId, now + SESSION_MS);
    return token;
  }

  /** The signed-in account behind a session token, if it is still valid. */
  session(token: string, now = Date.now()): Account | null {
    const r = this.db
      .prepare(
        "SELECT account_id, expires_at FROM sessions WHERE token_hash = ?",
      )
      .get(hash(token));
    if (r === undefined) return null;
    if ((r.expires_at as number) <= now) {
      this.endSession(token);
      return null;
    }
    return this.byId(r.account_id as string);
  }

  endSession(token: string): void {
    this.db
      .prepare("DELETE FROM sessions WHERE token_hash = ?")
      .run(hash(token));
  }

  endAllSessions(accountId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
  }

  /** The signing key pair, as stored JWK JSON; null before the first one. */
  signingKey(): { kid: string; privateJwk: string; publicJwk: string } | null {
    const r = this.db.prepare("SELECT * FROM signing_keys LIMIT 1").get();
    if (r === undefined) return null;
    return {
      kid: r.kid as string,
      privateJwk: r.private_jwk as string,
      publicJwk: r.public_jwk as string,
    };
  }

  saveSigningKey(kid: string, privateJwk: string, publicJwk: string): void {
    this.db
      .prepare(
        "INSERT INTO signing_keys (kid, private_jwk, public_jwk) VALUES (?, ?, ?)",
      )
      .run(kid, privateJwk, publicJwk);
  }

  /**
   * Counts a finished game once: for each account, a game played and a win
   * or a loss under its type, mode and difficulty. False if it was already
   * counted.
   */
  recordGame(
    gameId: string,
    results: { accountId: string; won: boolean }[],
    key: { gameType: string; mode: string; difficulty: string },
  ): boolean {
    const fresh = this.db
      .prepare("INSERT OR IGNORE INTO recorded_games (game_id) VALUES (?)")
      .run(gameId);
    if (fresh.changes === 0) return false;
    const add = this.db.prepare(
      `INSERT INTO stats (account_id, game_type, mode, difficulty, wins, losses, total)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (account_id, game_type, mode, difficulty) DO UPDATE SET
         wins = wins + excluded.wins,
         losses = losses + excluded.losses,
         total = total + 1`,
    );
    for (const r of results) {
      if (this.byId(r.accountId) === null) continue;
      add.run(
        r.accountId,
        key.gameType,
        key.mode,
        key.difficulty,
        r.won ? 1 : 0,
        r.won ? 0 : 1,
      );
    }
    return true;
  }

  stats(accountId: string): StatLine[] {
    return this.db
      .prepare("SELECT * FROM stats WHERE account_id = ?")
      .all(accountId)
      .map((r) => ({
        gameType: r.game_type as string,
        mode: r.mode as string,
        difficulty: r.difficulty as string,
        wins: r.wins as number,
        losses: r.losses as number,
        total: r.total as number,
      }));
  }
}
