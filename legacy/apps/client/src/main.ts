import "./style.css";
import { Game, TERRAIN_NAMES, TICKS_PER_SECOND, type Terrain, type Turn } from "@borderfall/engine";
import {
  DEFAULT_GAME_ID,
  GameIdSchema,
  HASH_INTERVAL_TICKS,
  type ServerMessage,
} from "@borderfall/protocol";
import { Net, serverUrl } from "./net.ts";
import { MapRenderer } from "./renderer.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  map: $("map"),
  join: $("join"),
  joinForm: $<HTMLFormElement>("join-form"),
  nameInput: $<HTMLInputElement>("name-input"),
  gameIdLabel: $("game-id"),
  disconnected: $("disconnected"),
  reconnectBtn: $<HTMLButtonElement>("reconnect-btn"),
  hud: $("hud"),
  connDot: $("conn-dot"),
  clock: $("clock"),
  lobbyLabel: $("lobby-label"),
  playerList: $<HTMLUListElement>("player-list"),
  hint: $("hint"),
  tileInfo: $("tile-info"),
  desyncBanner: $("desync-banner"),
  desyncTick: $("desync-tick"),
};

const requestedId = new URLSearchParams(location.search).get("game") ?? DEFAULT_GAME_ID;
const gameId = GameIdSchema.safeParse(requestedId).success ? requestedId : DEFAULT_GAME_ID;
const tokenKey = `borderfall:token:${gameId}`;
const NAME_KEY = "borderfall:name";

let net: Net | null = null;
let game: Game | null = null;
let renderer: MapRenderer | null = null;
let clientId: string | null = null;
let playerName = "";

ui.gameIdLabel.textContent = gameId;
ui.lobbyLabel.textContent = `Lobby ${gameId}`;
ui.nameInput.value = localStorage.getItem(NAME_KEY) ?? "";
ui.nameInput.focus();

ui.joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  playerName = ui.nameInput.value.trim();
  if (!playerName) return;
  localStorage.setItem(NAME_KEY, playerName);
  ui.join.hidden = true;
  connect();
});

ui.reconnectBtn.addEventListener("click", () => {
  ui.disconnected.hidden = true;
  connect();
});

function connect() {
  net = new Net(serverUrl(), {
    onOpen: () => {
      ui.connDot.classList.add("ok");
      net!.send({
        type: "join",
        gameId,
        name: playerName,
        token: sessionStorage.getItem(tokenKey) ?? undefined,
      });
    },
    onMessage: handleMessage,
    onClose: () => {
      ui.connDot.classList.remove("ok");
      ui.disconnected.hidden = false;
    },
  });
}

function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case "welcome":
      return startGame(msg);
    case "turn":
      if (!game) return;
      game.executeTurn(msg.turn);
      if (msg.turn.tick % HASH_INTERVAL_TICKS === 0) {
        net?.send({ type: "hash", tick: msg.turn.tick, hash: game.hash() });
      }
      renderer?.update();
      renderHud();
      return;
    case "desync":
      ui.desyncTick.textContent = String(msg.tick);
      ui.desyncBanner.hidden = false;
      return;
    case "error":
      console.warn("server error:", msg.message);
      return;
  }
}

async function startGame(msg: Extract<ServerMessage, { type: "welcome" }>) {
  clientId = msg.clientId;
  sessionStorage.setItem(tokenKey, msg.token);
  renderer?.destroy();
  renderer = null;
  ui.desyncBanner.hidden = true;

  const g = new Game(msg.config);
  let next = 0;
  for (let tick = 0; tick < msg.tick; tick++) {
    const recorded = msg.turns[next];
    const turn: Turn = recorded?.tick === tick ? (next++, recorded) : { tick, intents: [] };
    g.executeTurn(turn);
  }
  game = g;

  const r = await MapRenderer.create(ui.map, g, {
    onTileClick: (tile) => net?.send({ type: "intent", intent: { type: "spawn", tile } }),
    onTileHover: (tile) => renderTileInfo(tile),
  });
  if (game !== g) {
    r.destroy();
    return;
  }
  renderer = r;
  ui.hud.hidden = false;
  renderHud();
}

if (import.meta.env.DEV) {
  Object.assign(window, { __borderfall: { game: () => game, renderer: () => renderer } });
}

function renderHud() {
  if (!game) return;
  const seconds = Math.floor(game.tick / TICKS_PER_SECOND);
  ui.clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  const me = clientId ? game.playerByClient(clientId) : undefined;
  ui.hint.textContent =
    me?.spawnTile === null || !me
      ? "Click any land tile to choose your spawn"
      : "Spawned. Click elsewhere to move your spawn.";

  const sorted = [...game.players].sort((a, b) => b.tileCount - a.tileCount || a.id - b.id);
  ui.playerList.replaceChildren(
    ...sorted.map((p) => {
      const li = document.createElement("li");
      li.classList.toggle("offline", !p.connected);
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = `#${p.color.toString(16).padStart(6, "0")}`;
      const name = document.createElement("span");
      name.className = p === me ? "name you" : "name";
      name.textContent = p === me ? `${p.name} (you)` : p.name;
      const tiles = document.createElement("span");
      tiles.className = "tiles";
      tiles.textContent = p.tileCount.toLocaleString();
      li.append(swatch, name, tiles);
      return li;
    }),
  );
}

function renderTileInfo(tile: number | null) {
  if (!game || tile === null) {
    ui.tileInfo.textContent = "";
    return;
  }
  const terrain = TERRAIN_NAMES[game.map.terrain[tile] as Terrain];
  const owner = game.player(game.owner[tile]!);
  const x = game.map.x(tile);
  const y = game.map.y(tile);
  ui.tileInfo.textContent = `${terrain} · ${x}, ${y}${owner ? ` · ${owner.name}` : ""}`;
}
