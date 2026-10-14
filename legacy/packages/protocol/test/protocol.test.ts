import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../src/index.ts";

describe("parseClientMessage", () => {
  it("accepts valid messages and trims names", () => {
    expect(parseClientMessage('{"type":"join","gameId":"main","name":"  Kay  "}')).toEqual({
      type: "join",
      gameId: "main",
      name: "Kay",
    });
    expect(parseClientMessage('{"type":"intent","intent":{"type":"spawn","tile":12}}')).toEqual({
      type: "intent",
      intent: { type: "spawn", tile: 12 },
    });
  });

  it("rejects malformed or malicious input", () => {
    for (const raw of [
      "not json",
      "null",
      '{"type":"join","gameId":"../etc","name":"x"}',
      '{"type":"join","gameId":"main","name":""}',
      `{"type":"join","gameId":"main","name":"${"x".repeat(50)}"}`,
      '{"type":"intent","intent":{"type":"spawn","tile":-1}}',
      '{"type":"intent","intent":{"type":"join","clientId":"someone-else","name":"x"}}',
      '{"type":"nuke"}',
    ]) {
      expect(parseClientMessage(raw)).toBeNull();
    }
  });
});
