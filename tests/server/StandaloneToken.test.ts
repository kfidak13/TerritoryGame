import { GameEnv } from "@openfront/shared/configuration/Env";
import { afterEach, describe, expect, test, vi } from "vitest";
import { verifyClientToken } from "../../src/server/jwt";
import { ServerEnv } from "../../src/server/ServerEnv";

const PERSISTENT_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

describe("verifyClientToken in production", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test("a standalone server (no API) takes the browser's persistent ID", async () => {
    vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Prod);
    vi.stubEnv("API_KEY", "");
    expect(await verifyClientToken(PERSISTENT_ID)).toEqual({
      type: "success",
      persistentId: PERSISTENT_ID,
      claims: null,
    });
  });

  test("a server with an API still demands a signed token", async () => {
    vi.spyOn(ServerEnv, "env").mockReturnValue(GameEnv.Prod);
    vi.stubEnv("API_KEY", "some-key");
    expect((await verifyClientToken(PERSISTENT_ID)).type).toBe("error");
  });
});
