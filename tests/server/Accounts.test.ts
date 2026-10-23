import {
  Difficulty,
  GameMode,
  GameType,
} from "@openfront/engine-api/game/GameTypes";
import {
  PlayerProfileSchema,
  TokenPayloadSchema,
  UserMeResponseSchema,
} from "@openfront/shared/ApiSchemas";
import express from "express";
import { decodeJwt } from "jose";
import { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AccountService } from "../../src/server/accounts/AccountService";
import { AccountStore } from "../../src/server/accounts/AccountStore";

const ADMIN_EMAIL = "owner@example.com";
const API_KEY = "server-to-server";

/** Discord, as far as the sign-in flow can tell. */
function fakeDiscord(email: string, id = "1001") {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "discord-token" }));
    }
    if (u.endsWith("/users/@me")) {
      return new Response(
        JSON.stringify({
          id,
          username: "kaydon",
          global_name: "Kaydon",
          avatar: null,
          discriminator: "0",
          email,
          verified: true,
        }),
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

let server: ReturnType<express.Express["listen"]>;
let base: string;
let store: AccountStore;

async function start(email: string) {
  store = new AccountStore(":memory:");
  const app = express();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/account`;
  const service = new AccountService(store, {
    base,
    audience: "borderfall.test",
    discord: { clientId: "client", clientSecret: "secret" },
    adminEmail: ADMIN_EMAIL,
    apiKey: API_KEY,
    fetch: fakeDiscord(email),
  });
  app.use("/account", service.router());
}

/** Signs in through Discord; returns the session cookie. */
async function signIn(): Promise<string> {
  const login = await fetch(
    `${base}/auth/login/discord?redirect_uri=${encodeURIComponent(base.replace("/account", "/lobby"))}`,
    { redirect: "manual" },
  );
  expect(login.status).toBe(302);
  const state = new URL(login.headers.get("location")!).searchParams.get(
    "state",
  );
  const stateCookie = login.headers.get("set-cookie")!.split(";")[0];
  const callback = await fetch(
    `${base}/auth/callback/discord?code=abc&state=${state}`,
    { redirect: "manual", headers: { cookie: stateCookie } },
  );
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).toContain("/lobby");
  const session = callback.headers
    .getSetCookie()
    .find((c) => c.startsWith("bf_session="))!;
  return session.split(";")[0];
}

async function refresh(cookie: string) {
  return fetch(`${base}/auth/refresh`, {
    method: "POST",
    headers: { cookie },
  });
}

describe("Borderfall accounts", () => {
  afterEach(() => {
    server.close();
    vi.unstubAllEnvs();
  });

  describe("a regular player", () => {
    beforeEach(() => start("player@example.com"));

    test("signs in with Discord and gets tokens the client accepts", async () => {
      const cookie = await signIn();
      const res = await refresh(cookie);
      expect(res.status).toBe(200);
      const { jwt, expiresIn } = await res.json();
      expect(expiresIn).toBeGreaterThan(0);
      const claims = TokenPayloadSchema.parse(decodeJwt(jwt));
      expect(claims.iss).toBe(base);
      expect(claims.aud).toBe("borderfall.test");
      expect(claims.role).toBeUndefined();

      const me = await fetch(`${base}/users/@me`, {
        headers: { authorization: `Bearer ${jwt}` },
      });
      const parsed = UserMeResponseSchema.parse(await me.json());
      expect(parsed.user.discord?.username).toBe("kaydon");
      expect(parsed.player.username).toBe("Kaydon");
    });

    test("is refused without a session, and after logging out", async () => {
      expect((await refresh("bf_session=nope")).status).toBe(401);
      const cookie = await signIn();
      await fetch(`${base}/auth/logout`, {
        method: "POST",
        headers: { cookie },
      });
      expect((await refresh(cookie)).status).toBe(401);
    });

    test("is never sent off-site after signing in", async () => {
      const login = await fetch(
        `${base}/auth/login/discord?redirect_uri=${encodeURIComponent("https://evil.example/")}`,
        { redirect: "manual" },
      );
      const cookie = decodeURIComponent(
        login.headers.get("set-cookie")!.split(";")[0],
      );
      expect(cookie).not.toContain("evil.example");
    });

    test("cannot pass the admin check, even with the password", async () => {
      vi.stubEnv("BORDERFALL_ADMIN_PASSWORD", "hunter2");
      const { jwt } = await (await refresh(await signIn())).json();
      const res = await fetch(`${base}/admin/verify`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: "hunter2" }),
      });
      expect(res.status).toBe(403);
    });

    test("gets stats from finished games, counted once", async () => {
      const { jwt } = await (await refresh(await signIn())).json();
      const id = TokenPayloadSchema.parse(decodeJwt(jwt)).sub;
      const record = (gameID: string, won: boolean) => ({
        info: {
          gameID,
          config: {
            gameType: GameType.Public,
            gameMode: GameMode.FFA,
            difficulty: Difficulty.Medium,
          },
          players: [
            { clientID: "me", persistentID: id },
            { clientID: "guest", persistentID: null },
          ],
          winner: won ? ["player", "me"] : ["player", "guest"],
        },
      });
      const post = (body: unknown, key = API_KEY) =>
        fetch(`${base}/game/x`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key },
          body: JSON.stringify(body),
        });
      expect((await post(record("g1", true), "wrong")).status).toBe(403);
      await post(record("g1", true));
      await post(record("g1", true));
      await post(record("g2", false));

      const { player } = UserMeResponseSchema.parse(
        await (
          await fetch(`${base}/users/@me`, {
            headers: { authorization: `Bearer ${jwt}` },
          })
        ).json(),
      );
      const profile = PlayerProfileSchema.parse(
        await (await fetch(`${base}/public/player/${player.publicId}`)).json(),
      );
      const leaf = profile.stats.Public?.[GameMode.FFA]?.[Difficulty.Medium];
      expect([leaf?.wins, leaf?.losses, leaf?.total]).toEqual([1n, 1n, 2n]);
    });
  });

  describe("the admin's account", () => {
    beforeEach(() => start(ADMIN_EMAIL));

    test("carries the admin role, and passes the check only with the password", async () => {
      vi.stubEnv("BORDERFALL_ADMIN_PASSWORD", "hunter2");
      const { jwt } = await (await refresh(await signIn())).json();
      expect(TokenPayloadSchema.parse(decodeJwt(jwt)).role).toBe("admin");
      const verify = (password: string) =>
        fetch(`${base}/admin/verify`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${jwt}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ password }),
        });
      expect((await verify("nope")).status).toBe(403);
      expect((await verify("hunter2")).status).toBe(200);
    });
  });
});
