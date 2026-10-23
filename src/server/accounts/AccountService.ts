import {
  GameMode,
  GameType,
  HumansVsNations,
} from "@openfront/engine-api/game/GameTypes";
import { base64urlToUuid, uuidToBase64url } from "@openfront/shared/Base64";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import express, { Request, Response, Router } from "express";
import {
  exportJWK,
  generateKeyPair,
  importJWK,
  JWK,
  jwtVerify,
  SignJWT,
} from "jose";
import {
  Account,
  AccountStore,
  DiscordProfile,
  Provider,
  SESSION_MS,
} from "./AccountStore";

/*
 * Borderfall's account service: the slice of OpenFront's closed API that the
 * client's account screens and the game servers use, mounted under /account
 * on this server (ServerEnv.accountApi). Players sign in with Discord or
 * Google; a session cookie then trades for short-lived EdDSA tokens, which
 * the game servers check against /.well-known/jwks.json. Finished games feed
 * per-account stats.
 *
 * The admin is whoever signs in with ADMIN_EMAIL (verified by the
 * provider): only that account gets the "admin" role, and admin powers still
 * need the admin password on top (adminPasswordMatches).
 */

export interface AccountServiceConfig {
  /** Public base URL of this service, e.g. https://borderfall.fly.dev/account. */
  base: string;
  /** Token audience: the site's domain (DOMAIN). */
  audience: string;
  discord?: { clientId: string; clientSecret: string };
  google?: { clientId: string; clientSecret: string };
  adminEmail?: string;
  /** Server-to-server key the game servers send (API_KEY). */
  apiKey: string;
  /** For tests: stands in for the providers' token and profile endpoints. */
  fetch?: typeof fetch;
}

const TOKEN_SECONDS = 15 * 60;
const SESSION_COOKIE = "bf_session";
const STATE_COOKIE = "bf_oauth";

function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sameSecret(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

/**
 * Whether `password` is the admin password (ADMIN_PASSWORD); an unset
 * password opens nothing.
 */
export function adminPasswordMatches(password: string): boolean {
  const expected = process.env.BORDERFALL_ADMIN_PASSWORD ?? "";
  if (expected === "" || password === "") return false;
  return sameSecret(password, expected);
}

/** Where a finished game counts: type, mode and difficulty, as the profile shows them. */
export function statsKey(config: {
  gameType: string;
  gameMode: string;
  playerTeams?: unknown;
  difficulty: string;
}): { gameType: string; mode: string; difficulty: string } {
  const mode =
    config.playerTeams === HumansVsNations
      ? HumansVsNations
      : config.gameMode === GameMode.Team
        ? GameMode.Team
        : GameMode.FFA;
  return { gameType: config.gameType, mode, difficulty: config.difficulty };
}

export class AccountService {
  private key: {
    kid: string;
    privateKey: CryptoKey | Uint8Array;
    publicJwk: JWK;
  } | null = null;
  private readonly fetch: typeof fetch;

  constructor(
    private store: AccountStore,
    private config: AccountServiceConfig,
  ) {
    this.fetch = config.fetch ?? fetch;
  }

  private secure(): boolean {
    return this.config.base.startsWith("https://");
  }

  private origin(): string {
    return new URL(this.config.base).origin;
  }

  private async signingKey() {
    if (this.key !== null) return this.key;
    let stored = this.store.signingKey();
    if (stored === null) {
      const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
        extractable: true,
      });
      const kid = randomBytes(8).toString("hex");
      stored = {
        kid,
        privateJwk: JSON.stringify(await exportJWK(privateKey)),
        publicJwk: JSON.stringify(await exportJWK(publicKey)),
      };
      this.store.saveSigningKey(kid, stored.privateJwk, stored.publicJwk);
    }
    this.key = {
      kid: stored.kid,
      privateKey: await importJWK(JSON.parse(stored.privateJwk), "EdDSA"),
      publicJwk: {
        ...JSON.parse(stored.publicJwk),
        kid: stored.kid,
        alg: "EdDSA",
        use: "sig",
      },
    };
    return this.key;
  }

  isAdmin(account: Account): boolean {
    const admin = this.config.adminEmail?.trim().toLowerCase();
    return (
      admin !== undefined &&
      admin !== "" &&
      account.emailVerified &&
      account.email?.toLowerCase() === admin
    );
  }

  /** A short-lived token for the account, as /auth/refresh hands out. */
  async issueToken(account: Account): Promise<string> {
    const key = await this.signingKey();
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      ...(this.isAdmin(account) ? { role: "admin" } : {}),
      provider: account.discordId !== null ? "discord" : "google",
    })
      .setProtectedHeader({ alg: "EdDSA", kid: key.kid })
      .setJti(randomBytes(12).toString("base64url"))
      .setSubject(uuidToBase64url(account.id))
      .setIssuer(this.config.base)
      .setAudience(this.config.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + TOKEN_SECONDS)
      .sign(key.privateKey);
  }

  /** The account a Bearer token belongs to, or null. */
  async bearer(req: Request): Promise<Account | null> {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) return null;
    try {
      const key = await this.signingKey();
      const { payload } = await jwtVerify(
        header.slice(7),
        await importJWK(key.publicJwk, "EdDSA"),
        { issuer: this.config.base, audience: this.config.audience },
      );
      const id = base64urlToUuid(String(payload.sub));
      return id ? this.store.byId(id) : null;
    } catch {
      return null;
    }
  }

  userMe(account: Account) {
    const name =
      account.discord?.global_name ??
      account.discord?.username ??
      account.email?.split("@")[0] ??
      null;
    return {
      user: {
        ...(account.discord !== null ? { discord: account.discord } : {}),
        ...(account.googleId !== null && account.email !== null
          ? { google: { email: account.email } }
          : {}),
        ...(account.email !== null ? { email: account.email } : {}),
      },
      ban: null,
      steamLicence: false,
      noticesSeen: [],
      player: {
        publicId: account.publicId,
        adfree: true,
        canCreatePublicLobbies: true,
        trustTier: "trusted",
        username: name,
        flares: [],
        achievements: { singleplayerMap: [], player: [] },
        friends: [],
        subscription: null,
      },
    };
  }

  profile(account: Account) {
    const stats: Record<string, Record<string, Record<string, unknown>>> = {};
    for (const s of this.store.stats(account.id)) {
      stats[s.gameType] ??= {};
      stats[s.gameType][s.mode] ??= {};
      stats[s.gameType][s.mode][s.difficulty] = {
        wins: String(s.wins),
        losses: String(s.losses),
        total: String(s.total),
        stats: {},
      };
    }
    return {
      createdAt: account.createdAt,
      ...(account.discord !== null ? { user: account.discord } : {}),
      username: this.userMe(account).player.username,
      stats,
    };
  }

  /** Counts a finished game record's signed-in players. */
  recordGame(record: {
    info: {
      gameID: string;
      config: {
        gameType: string;
        gameMode: string;
        playerTeams?: unknown;
        difficulty: string;
      };
      players: { clientID: string; persistentID: string | null }[];
      winner?: unknown;
    };
  }): boolean {
    const winner = Array.isArray(record.info.winner) ? record.info.winner : [];
    const winners = new Set(
      winner.slice(winner[0] === "player" ? 1 : 2).map(String),
    );
    return this.store.recordGame(
      record.info.gameID,
      record.info.players
        .filter((p) => p.persistentID !== null)
        .map((p) => ({
          accountId: p.persistentID!,
          won: winners.has(p.clientID),
        })),
      statsKey(record.info.config),
    );
  }

  private setSession(res: Response, token: string | null): void {
    const parts = [
      `${SESSION_COOKIE}=${token ?? ""}`,
      "Path=/account",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${token === null ? 0 : Math.floor(SESSION_MS / 1000)}`,
      ...(this.secure() ? ["Secure"] : []),
    ];
    res.append("Set-Cookie", parts.join("; "));
  }

  private providerConfig(p: Provider) {
    return p === "discord" ? this.config.discord : this.config.google;
  }

  private callbackUrl(p: Provider): string {
    return `${this.config.base}/auth/callback/${p}`;
  }

  /** Signs in with the provider's code; returns the account. */
  private async exchange(p: Provider, code: string): Promise<Account> {
    const creds = this.providerConfig(p)!;
    const form = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: this.callbackUrl(p),
    });
    const tokenUrl =
      p === "discord"
        ? "https://discord.com/api/oauth2/token"
        : "https://oauth2.googleapis.com/token";
    const tokenRes = await this.fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!tokenRes.ok)
      throw new Error(`${p} token exchange: ${tokenRes.status}`);
    const { access_token } = (await tokenRes.json()) as {
      access_token: string;
    };
    const meUrl =
      p === "discord"
        ? "https://discord.com/api/users/@me"
        : "https://openidconnect.googleapis.com/v1/userinfo";
    const meRes = await this.fetch(meUrl, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!meRes.ok) throw new Error(`${p} profile: ${meRes.status}`);
    const me = (await meRes.json()) as Record<string, unknown>;
    if (p === "discord") {
      const discord: DiscordProfile = {
        id: String(me.id),
        username: String(me.username),
        global_name: (me.global_name as string | null) ?? null,
        avatar: (me.avatar as string | null) ?? null,
        discriminator: String(me.discriminator ?? "0"),
      };
      return this.store.signIn(
        "discord",
        discord.id,
        (me.email as string | undefined) ?? null,
        me.verified === true,
        discord,
      );
    }
    return this.store.signIn(
      "google",
      String(me.sub),
      (me.email as string | undefined) ?? null,
      me.email_verified === true,
      null,
    );
  }

  router(): Router {
    const r = express.Router();
    r.use(express.json({ limit: "20mb" }));

    r.get("/auth/login/:provider", (req, res) => {
      const p = req.params.provider as Provider;
      const creds =
        p === "discord" || p === "google" ? this.providerConfig(p) : undefined;
      if (creds === undefined) {
        res.status(404).json({ error: "sign-in method not set up" });
        return;
      }
      // Only ever send players back to this site.
      let back = `${this.origin()}/`;
      try {
        const asked = new URL(String(req.query.redirect_uri ?? ""));
        if (asked.origin === this.origin()) back = asked.toString();
      } catch {
        // Not a URL: the homepage it is.
      }
      const state = randomBytes(16).toString("base64url");
      res.append(
        "Set-Cookie",
        [
          `${STATE_COOKIE}=${encodeURIComponent(`${state} ${back}`)}`,
          "Path=/account/auth",
          "HttpOnly",
          "SameSite=Lax",
          "Max-Age=600",
          ...(this.secure() ? ["Secure"] : []),
        ].join("; "),
      );
      const params = new URLSearchParams({
        client_id: creds.clientId,
        response_type: "code",
        redirect_uri: this.callbackUrl(p),
        state,
        scope: p === "discord" ? "identify email" : "openid email profile",
      });
      res.redirect(
        p === "discord"
          ? `https://discord.com/oauth2/authorize?${params}`
          : `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      );
    });

    r.get("/auth/callback/:provider", async (req, res) => {
      const p = req.params.provider as Provider;
      const [state, back] = (cookies(req)[STATE_COOKIE] ?? "").split(" ");
      res.append(
        "Set-Cookie",
        `${STATE_COOKIE}=; Path=/account/auth; Max-Age=0`,
      );
      if (
        (p !== "discord" && p !== "google") ||
        this.providerConfig(p) === undefined ||
        !state ||
        req.query.state !== state ||
        typeof req.query.code !== "string"
      ) {
        res.status(400).send("Sign-in failed. Please try again.");
        return;
      }
      try {
        const account = await this.exchange(p, req.query.code);
        this.setSession(res, this.store.createSession(account.id));
        res.redirect(back || `${this.origin()}/`);
      } catch (e) {
        console.error("sign-in failed", e);
        res.status(502).send("Sign-in failed. Please try again.");
      }
    });

    r.post("/auth/refresh", async (req, res) => {
      const token = cookies(req)[SESSION_COOKIE];
      const account = token ? this.store.session(token) : null;
      if (account === null) {
        this.setSession(res, null);
        res.status(401).json({ error: "not signed in" });
        return;
      }
      res.json({
        jwt: await this.issueToken(account),
        expiresIn: TOKEN_SECONDS,
      });
    });

    r.post("/auth/logout", (req, res) => {
      const token = cookies(req)[SESSION_COOKIE];
      if (token) this.store.endSession(token);
      this.setSession(res, null);
      res.json({ ok: true });
    });

    r.post("/auth/revoke", (req, res) => {
      const token = cookies(req)[SESSION_COOKIE];
      const account = token ? this.store.session(token) : null;
      if (account !== null) this.store.endAllSessions(account.id);
      this.setSession(res, null);
      res.json({ ok: true });
    });

    r.get("/.well-known/jwks.json", async (_req, res) => {
      res.json({ keys: [(await this.signingKey()).publicJwk] });
    });

    r.get("/users/@me", async (req, res) => {
      const account = await this.bearer(req);
      if (account === null) {
        res.status(401).json({ error: "not signed in" });
        return;
      }
      res.json(this.userMe(account));
    });

    // Admin: the admin account proves the admin password before the client
    // shows its tools. Game servers check the password again themselves.
    r.post("/admin/verify", async (req, res) => {
      const account = await this.bearer(req);
      const ok =
        account !== null &&
        this.isAdmin(account) &&
        adminPasswordMatches(String(req.body?.password ?? ""));
      res.status(ok ? 200 : 403).json({ ok });
    });

    r.get("/public/player/:publicId", (req, res) => {
      const account = this.store.byPublicId(req.params.publicId);
      if (account === null) {
        res.status(404).json({ error: "no such player" });
        return;
      }
      res.json(this.profile(account));
    });

    // Finished multiplayer games, from this site's game servers.
    r.post("/game/:id", (req, res) => {
      const key = String(req.headers["x-api-key"] ?? "");
      if (this.config.apiKey === "" || !sameSecret(key, this.config.apiKey)) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      try {
        this.recordGame(req.body);
        res.json({ ok: true });
      } catch (e) {
        console.error("recording game failed", e);
        res.status(400).json({ error: "bad record" });
      }
    });

    // Solo games, from the signed-in player's own browser.
    r.post("/archive_singleplayer_game", async (req, res) => {
      const account = await this.bearer(req);
      if (account === null) {
        res.status(401).json({ error: "not signed in" });
        return;
      }
      try {
        const record = req.body;
        const mine = (record.info.players ?? []).filter(
          (p: { persistentID: string | null }) => p.persistentID === account.id,
        );
        this.recordGame({
          ...record,
          info: {
            ...record.info,
            config: { ...record.info.config, gameType: GameType.Singleplayer },
            players: mine,
          },
        });
        res.json({ ok: true });
      } catch (e) {
        console.error("recording solo game failed", e);
        res.status(400).json({ error: "bad record" });
      }
    });

    return r;
  }
}
