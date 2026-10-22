# Agent notes for Borderfall

Borderfall is a fork of OpenFront. `CLAUDE.md` (from OpenFront) describes the architecture,
commands and engine rules (determinism, layer boundaries, i18n) and applies here too.

## Environment

- Requires Node 24.15+ (<25) and npm 12.1+. On this machine the system Node is 25, so a Node 24
  install lives at `~/.local/node-24`. Run commands with
  `PATH="$HOME/.local/node-24/bin:$PATH"`.
- Install dependencies with `npm run inst` (never `npm install`).
- `npm run dev` serves the game at http://localhost:9000. The game server's master listens on
  3000; set `MASTER_PORT=3100` (or any free port) for both `npm run dev` and the server if 3000 is
  taken, as it is on this machine.
- Browser checks: `playwright-cli` is installed globally; in-game state is readable through
  `document.querySelector("build-menu").game` (see `.claude/skills/run-openfront/SKILL.md`).

## Pacing

`npm run sim:pacing -- --maps world,europe --seeds 2` plays AI-only public-FFA-style games
(Medium nations, tribes, goods and overtime on) headlessly and reports when each game ended and
the leader's land share over time (`tests/sim/PacingSim.ts`). Target: 25-35 minute games, 40 at
most. With overtime the win bar starts at 90% and falls 4% a minute from minute 20
(`Config.percentageTilesOwnedToWin`); without overtime it is a flat 80%.

## Verification

`npm run typecheck && npm run lint && npx prettier --check . && npm test`, plus
`npm run build-prod` for build changes.

## Fork rules

- `upstream` is openfrontio/OpenFrontIO. Merge it with `git fetch --no-tags upstream main && git merge upstream/main`.
  Keep changes to OpenFront files small so upstream merges stay easy.
- Never re-add OpenFront's `proprietary/` assets (logo, font, music); they are all rights reserved.
- Keep the "© OpenFront and Contributors" notice (`main.copyright` in `resources/lang/en.json`)
  visible; it is required by OpenFront's AGPL additional terms. Don't call the game "OpenFront".
- User-facing text uses Borderfall branding in `resources/lang/en.json`. Other language files still
  say OpenFront (not yet rebranded).
- Standalone mode: OpenFront's closed-source API (accounts, store, cosmetics, matchmaking, news,
  ads, server registry) is not part of this project. `src/client/Standalone.ts` exports `STANDALONE`
  (true except under vitest); gate API-only behaviour on it rather than deleting OpenFront code, so
  upstream merges stay small. Server-side, trusted-only public lobbies are off unless
  `TRUSTED_LOBBIES=true`.
- `legacy/` holds the original Borderfall prototype (tag `borderfall-m0`) and is excluded from
  lint, tests and formatting.
- The user prefers committing and pushing directly to `main`.
