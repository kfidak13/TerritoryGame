# Agent notes for Borderfall

## Commands

- `npm install`: install all workspaces (npm workspaces monorepo)
- `npm run dev`: server (:3001, tsx watch) and client (:5173, Vite, proxies `/ws` to the server)
- `npm test`: Vitest across `packages/*/test` and `apps/*/test`
- `npm run typecheck`: `tsc -p .` in every workspace (TypeScript 7)
- `npm run build`: client production build
- `npm run format:check` / `npm run format`: Prettier (printWidth 100)

Verify changes with: `npm run format:check && npm run typecheck && npm test && npm run build`.

## Conventions

- Workspace packages export TypeScript source directly (`exports: ./src/index.ts`). There is no
  per-package build step. Relative imports use `.ts` extensions.
- `packages/engine` must stay deterministic and free of DOM and Node APIs. No `Math.random`, `Date`,
  or transcendental `Math.*` functions. Use `Rng` and plain arithmetic. Invalid intents are silent
  no-ops (they come from untrusted clients).
- The server is a relay only and never runs the simulation.
- Dependencies: pin exact versions that were published at least 7 days ago.
- The user prefers committing and pushing directly to `main`.

## Browser testing

In dev builds the client exposes `window.__borderfall.game()` and `window.__borderfall.renderer()`.
`renderer.tileToScreen(tile)` gives click coordinates for a tile.
