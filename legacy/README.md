# Borderfall

A real-time multiplayer territory strategy game for the browser, inspired by OpenFront.io and
written from scratch. Claim land, grow your army, trade scarce goods, forge (and break) pacts, and
fight for the map. Games are tuned to finish in under 40 minutes.

## Status

Milestone 0 (foundation) is done: you can join a lobby, see a procedurally generated map, and pick a
spawn. Every client stays in sync through the deterministic lockstep engine.

## Getting started

Requires Node.js 22.12+ (CI uses Node 24).

```bash
npm install
npm run dev        # server on :3001, client on http://localhost:5173
```

Open `http://localhost:5173` in two browser windows to play against yourself. Add `?game=<id>` to
the URL to join a specific lobby (default `main`).

| Command             | What it does                               |
| ------------------- | ------------------------------------------ |
| `npm run dev`       | Run the server and client with live reload |
| `npm test`          | Run all unit tests (Vitest)                |
| `npm run typecheck` | Type-check every workspace                 |
| `npm run build`     | Production build of the client             |
| `npm run format`    | Format with Prettier                       |
| `npm start`         | Run the game server (production)           |

## Architecture

```
packages/engine    Deterministic simulation: map, mapgen, players, intents, state hash
packages/protocol  Client/server message schemas (zod) and shared constants
apps/server        Node + ws lockstep relay: lobbies, turn ordering, reconnect, desync checks
apps/client        Vite + PixiJS renderer, camera, HUD, networking
```

**Deterministic lockstep.** The server never simulates. Clients send _intents_ (for example "spawn
at tile 1234"). The server stamps each intent with the sender's id, groups intents into 100 ms
_turns_ and broadcasts every turn to every client. Each client runs the same engine on the same
turns, so all clients compute the same game state. Rules for the engine:

- No `Math.random`, `Date`, or `Math.sin/cos/pow/exp`. Use `Rng` and plain arithmetic.
- Intents come from untrusted clients. An invalid intent must be a silent no-op.
- Clients report `game.hash()` every 50 ticks. The server broadcasts a desync warning if hashes
  differ.

Late joiners and reconnecting players receive the turn history and replay it. A secret reconnect
token (kept in `sessionStorage`) lets a player reclaim their nation after a disconnect.

## Game design

### Core (OpenFront-style)

- Tile territory on real-world and procedural maps, with terrain (plains, highlands, mountains) that
  changes attack speed and losses.
- Troops grow toward a cap set by land and cities. An attack-ratio slider decides how many troops
  each attack sends. Gold accrues over time.
- Buildings: City, Port, Defense Post, Missile Silo, SAM Launcher. Costs rise with each one you
  own.
- Naval: boat landings, trade ships, warships.
- Nukes (Atom, Hydrogen, MIRV) with fallout and SAM interception.
- Diplomacy: timed alliances, a traitor penalty, donations, quick chat.
- Win by holding most of the habitable land. Pacing (map size, win threshold, growth curves) is
  tuned so games end in under 40 minutes. There is no hard timer.

### What's new in Borderfall

**Regional goods.** Three goods come from specific tiles. No region has all three, so nations have
to trade.

| Good  | Comes from                       | Rule                                | Used for                                             |
| ----- | -------------------------------- | ----------------------------------- | ---------------------------------------------------- |
| Food  | Fertile plains, river tiles      | Soft: a shortage slows troop growth | Feeding your army                                    |
| Oil   | Desert deposits, offshore fields | Hard: required to build or launch   | Things that move: warships, missiles                 |
| Metal | Mountain and hill deposits       | Hard: required to build             | Things that stand: posts, SAMs, silos, city upgrades |

The rule of thumb: **Oil moves, Metal stands.**

**Trading and diplomacy.**

- Player trade offers: propose any mix of gold, troops, goods, tiles, or a ceasefire. The other
  player can accept, reject, or counter.
- Trade pacts give both partners bonus goods income. Embargoes cut a rival off from trading with you
  and your allies.

**Smarter AI.** Bots and Nations follow the same troop rules as humans. Difficulty changes how well
the AI decides (building defenses and SAMs, choosing nuke targets that avoid SAM cover, trading,
diplomacy), never how many troops it gets.

## Roadmap

0. ✅ Foundation: monorepo, lockstep relay, procedural map, spawning, CI
1. Core simulation: expansion, troops and gold, attacks, terrain, win condition
2. Netcode hardening: lobby browser, spawn phase, simulation in a Web Worker
3. Rendering and HUD: attack slider, build bar, names on the map
4. Buildings and naval
5. Goods, trade offers, pacts and embargoes, alliances, chat
6. Nukes, SAMs, fallout
7. AI: bots and Nations with difficulty that changes how well they decide
8. Map generation (real-world and procedural with goods placement) and pacing tuning with headless
   AI-vs-AI simulations
9. Deploy: client on Vercel, server on Fly.io
