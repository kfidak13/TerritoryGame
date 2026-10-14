# Agent notes for Borderfall

Borderfall is a fork of OpenFront. `CLAUDE.md` (from OpenFront) describes the architecture,
commands and engine rules (determinism, layer boundaries, i18n) and applies here too.

## Environment

- Requires Node 24.15+ (<25) and npm 12.1+. On this machine the system Node is 25, so a Node 24
  install lives at `~/.local/node-24`. Run commands with
  `PATH="$HOME/.local/node-24/bin:$PATH"`.
- Install dependencies with `npm run inst` (never `npm install`).
- `npm run dev` serves the game at http://localhost:9000.

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
- `legacy/` holds the original Borderfall prototype (tag `borderfall-m0`) and is excluded from
  lint, tests and formatting.
- The user prefers committing and pushing directly to `main`.
