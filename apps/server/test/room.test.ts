import type { ServerMessage } from "@borderfall/protocol";
import { describe, expect, it } from "vitest";
import { GameRoom, type Connection } from "../src/room.ts";

class FakeConn implements Connection {
  messages: ServerMessage[] = [];
  send(message: ServerMessage) {
    this.messages.push(message);
  }
  last<T extends ServerMessage["type"]>(type: T) {
    return this.messages.findLast((m) => m.type === type) as Extract<ServerMessage, { type: T }>;
  }
}

const newRoom = () => new GameRoom("test", { seed: 1, width: 64, height: 40 });

describe("GameRoom", () => {
  it("stamps intents with the sender and broadcasts them in order", () => {
    const room = newRoom();
    const a = new FakeConn();
    const b = new FakeConn();
    room.join(a, "Ann");
    room.join(b, "Bob");
    room.submitIntent(a, { type: "spawn", tile: 5 });
    room.step();

    const aId = a.last("welcome").clientId;
    const turn = b.last("turn").turn;
    expect(turn.tick).toBe(0);
    expect(turn.intents).toEqual([
      { type: "join", clientId: aId, name: "Ann" },
      { type: "join", clientId: b.last("welcome").clientId, name: "Bob" },
      { type: "spawn", clientId: aId, tile: 5 },
    ]);
    expect(a.last("turn")).toEqual(b.last("turn"));
  });

  it("replays non-empty history to late joiners", () => {
    const room = newRoom();
    const a = new FakeConn();
    room.join(a, "Ann");
    room.step();
    room.step();
    room.step();

    const late = new FakeConn();
    room.join(late, "Late");
    const welcome = late.last("welcome");
    expect(welcome.tick).toBe(3);
    expect(welcome.turns.map((t) => t.tick)).toEqual([0]);
  });

  it("restores the same clientId when reconnecting with a token", () => {
    const room = newRoom();
    const first = new FakeConn();
    room.join(first, "Ann");
    const { clientId, token } = first.last("welcome");
    room.leave(first);

    const again = new FakeConn();
    room.join(again, "Ann", token);
    expect(again.last("welcome").clientId).toBe(clientId);

    const stranger = new FakeConn();
    room.join(stranger, "Eve", "00000000-0000-4000-8000-000000000000");
    expect(stranger.last("welcome").clientId).not.toBe(clientId);
  });

  it("caps intents per client per turn", () => {
    const room = newRoom();
    const a = new FakeConn();
    room.join(a, "Ann");
    room.step();
    for (let i = 0; i < 50; i++) room.submitIntent(a, { type: "spawn", tile: i });
    room.step();
    expect(a.last("turn").turn.intents.length).toBe(10);
  });

  it("broadcasts a desync when clients report different hashes", () => {
    const room = newRoom();
    const a = new FakeConn();
    const b = new FakeConn();
    room.join(a, "Ann");
    room.join(b, "Bob");
    room.step();
    room.reportHash(a, 0, 111);
    room.reportHash(b, 0, 111);
    expect(a.messages.some((m) => m.type === "desync")).toBe(false);
    room.reportHash(b, 0, 222);
    expect(a.last("desync")).toEqual({ type: "desync", tick: 0 });
  });
});
