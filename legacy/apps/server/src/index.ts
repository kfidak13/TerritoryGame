import { randomInt } from "node:crypto";
import { createServer } from "node:http";
import { parseClientMessage, type ServerMessage } from "@borderfall/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import { GameRoom, type Connection } from "./room.ts";

const PORT = Number(process.env.PORT ?? 3001);
const MAP_WIDTH = 800;
const MAP_HEIGHT = 500;
/** Empty rooms are kept this long so players can reconnect. */
const EMPTY_ROOM_TTL_MS = 60_000;
const HEARTBEAT_MS = 30_000;

const rooms = new Map<string, GameRoom>();
const emptySince = new Map<string, number>();

function getRoom(id: string): GameRoom {
  let room = rooms.get(id);
  if (!room) {
    room = new GameRoom(id, { seed: randomInt(2 ** 31), width: MAP_WIDTH, height: MAP_HEIGHT });
    rooms.set(id, room);
    console.log(`[room ${id}] created (seed ${room.config.seed})`);
  }
  room.start();
  emptySince.delete(id);
  return room;
}

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 4 * 1024 });
const alive = new WeakSet<WebSocket>();

wss.on("connection", (ws) => {
  alive.add(ws);
  ws.on("pong", () => alive.add(ws));

  const conn: Connection = {
    send: (message: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    },
  };
  let room: GameRoom | null = null;

  ws.on("message", (data) => {
    const msg = parseClientMessage(data.toString());
    if (!msg) {
      conn.send({ type: "error", message: "invalid message" });
      return;
    }
    if (msg.type === "join") {
      if (room) return;
      room = getRoom(msg.gameId);
      room.join(conn, msg.name, msg.token);
    } else if (!room) {
      conn.send({ type: "error", message: "join a game first" });
    } else if (msg.type === "intent") {
      room.submitIntent(conn, msg.intent);
    } else {
      room.reportHash(conn, msg.tick, msg.hash);
    }
  });

  ws.on("close", () => {
    if (!room) return;
    room.leave(conn);
    if (room.connectionCount === 0) emptySince.set(room.id, Date.now());
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
  const now = Date.now();
  for (const [id, since] of emptySince) {
    if (now - since < EMPTY_ROOM_TTL_MS) continue;
    rooms.get(id)?.stop();
    rooms.delete(id);
    emptySince.delete(id);
    console.log(`[room ${id}] closed (empty)`);
  }
}, HEARTBEAT_MS);

http.listen(PORT, () => console.log(`Borderfall server listening on :${PORT}`));
