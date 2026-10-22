/**
 * Borderfall pacing simulator: AI-only games, timed to the end.
 *
 * Plays public-FFA-style games (Medium nations from the map manifest, tribes,
 * goods on, overtime on) with the real engine and EngineConfig, no humans,
 * until someone wins or a time cap passes, and reports how long each game
 * took and how the land leader's share grew. Use it to tune game length:
 * the target is 25-35 minutes, 40 at most.
 *
 * Usage:
 *   npm run sim:pacing -- [--maps world,europe] [--seeds 2] [--minutes 60]
 *                         [--bots 400] [--difficulty Medium]
 *                         [--overtime on|off] [--overtime-start 30]
 *
 * Every run is deterministic for its map and seed.
 */
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { GameConfig, GameStartInfo } from "@openfront/engine-api/Schemas";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { simpleHash } from "@openfront/engine-lib/Util";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { Player } from "@openfront/engine/game/Game";
import { createGame } from "@openfront/engine/game/GameImpl";
import { createNationsForGame } from "@openfront/engine/game/NationCreation";
import { GameRunner } from "@openfront/engine/GameRunner";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import path from "path";
import { fileURLToPath } from "url";
import { NodeGameMapLoader } from "../perf/fullgame/NodeGameMapLoader";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const TICKS_PER_MINUTE = 600;
const SAMPLE_MINUTES = [5, 10, 15, 20, 25, 30, 35, 40, 50, 60];

interface Options {
  maps: GameMapType[];
  seeds: number;
  minutes: number;
  bots: number;
  difficulty: Difficulty;
  overtime: boolean;
  /** Overrides the minute overtime (the falling win bar) starts. */
  overtimeStart?: number;
}

function resolveEnum<T extends Record<string, string>>(
  e: T,
  name: string,
): T[keyof T] {
  const key = Object.keys(e).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (key === undefined) throw new Error(`unknown value "${name}"`);
  return e[key as keyof T];
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    maps: [GameMapType.World],
    seeds: 1,
    minutes: 60,
    bots: 400,
    difficulty: Difficulty.Medium,
    overtime: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i] ?? "";
    switch (argv[i]) {
      case "--maps":
        opts.maps = next()
          .split(",")
          .map((m) => resolveEnum(GameMapType, m.trim()));
        break;
      case "--seeds":
        opts.seeds = Number(next());
        break;
      case "--minutes":
        opts.minutes = Number(next());
        break;
      case "--bots":
        opts.bots = Number(next());
        break;
      case "--difficulty":
        opts.difficulty = resolveEnum(Difficulty, next());
        break;
      case "--overtime":
        opts.overtime = next() !== "off";
        break;
      case "--overtime-start":
        opts.overtimeStart = Number(next());
        break;
      default:
        throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  return opts;
}

interface GameResult {
  map: string;
  seed: string;
  /** Minutes from the end of the spawn phase, or null if nobody won in time. */
  endMinute: number | null;
  winner: string;
  /** Leader's share of land (percent) at each sampled minute. */
  leaderShare: Map<number, number>;
  survivors: number;
}

async function playGame(
  map: GameMapType,
  seed: string,
  opts: Options,
): Promise<GameResult> {
  const gameConfig: GameConfig = {
    gameMap: map,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    difficulty: opts.difficulty,
    nations: "default",
    donateGold: false,
    donateTroops: false,
    bots: opts.bots,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    goods: true,
    overtime: opts.overtime
      ? {
          enabled: true,
          startMinutes: opts.overtimeStart,
        }
      : undefined,
  };
  const gameStart: GameStartInfo = {
    gameID: seed,
    lobbyCreatedAt: 0,
    config: gameConfig,
    players: [],
  };
  const config = new EngineConfig(gameConfig, false);
  const terrain = await loadTerrainMap(
    await loadMapFiles(
      new NodeGameMapLoader(path.join(PROJECT_ROOT, "resources/maps")),
      map,
      GameMapSize.Normal,
    ),
  );
  const nations = createNationsForGame(
    gameStart,
    terrain.nations,
    terrain.additionalNations,
    0,
    new PseudoRandom(simpleHash(seed)),
  );
  const game = createGame(
    [],
    nations,
    terrain.gameMap,
    terrain.miniGameMap,
    config,
    terrain.teamGameSpawnAreas,
  );

  let won = false;
  let fatal: string | undefined;
  const runner = new GameRunner(
    game,
    new Executor(game, seed, undefined),
    (gu) => {
      if ("errMsg" in gu) fatal = gu.errMsg;
      else if (gu.updates[GameUpdateType.Win].length > 0) won = true;
    },
  );
  runner.init();

  let turn = 0;
  const step = () => {
    runner.addTurn({ turnNumber: turn++, intents: [] });
    runner.executeNextTick();
    if (fatal !== undefined) throw new Error(fatal);
  };
  while (game.inSpawnPhase()) step();
  const startTick = game.ticks();

  const leaderShare = new Map<number, number>();
  const landShare = (p: Player) =>
    (100 * p.numTilesOwned()) /
    Math.max(1, game.numLandTiles() - game.numTilesWithFallout());
  const leader = () =>
    game
      .players()
      .reduce<Player | null>(
        (best, p) =>
          best === null || p.numTilesOwned() > best.numTilesOwned() ? p : best,
        null,
      );

  const endTick = startTick + opts.minutes * TICKS_PER_MINUTE;
  while (!won && game.ticks() < endTick) {
    step();
    const elapsed = game.ticks() - startTick;
    if (elapsed % TICKS_PER_MINUTE === 0) {
      const minute = elapsed / TICKS_PER_MINUTE;
      const top = leader();
      if (SAMPLE_MINUTES.includes(minute) && top !== null) {
        leaderShare.set(minute, Math.round(landShare(top)));
      }
    }
  }

  const winner = game.getWinner();
  const nonBots = game.players().filter((p) => p.type() !== PlayerType.Bot);
  return {
    map,
    seed,
    endMinute: won
      ? Math.round(((game.ticks() - startTick) / TICKS_PER_MINUTE) * 10) / 10
      : null,
    winner:
      winner === null
        ? "-"
        : typeof winner === "string"
          ? winner
          : `${winner.name()} (${Math.round(landShare(winner))}%)`,
    leaderShare,
    survivors: nonBots.length,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.debug = () => {};
  // The engine logs every win and spawn, and warns about failed AI builds.
  console.log = () => {};
  console.warn = () => {};
  const out = (line: string) => process.stdout.write(line + "\n");
  out(
    `Pacing: ${opts.maps.join(", ")} x ${opts.seeds} seed(s), ` +
      `${opts.difficulty} nations, ${opts.bots} tribes, ` +
      `overtime ${opts.overtime ? "on" : "off"}, cap ${opts.minutes} min`,
  );

  const results: GameResult[] = [];
  for (const map of opts.maps) {
    for (let s = 0; s < opts.seeds; s++) {
      const started = performance.now();
      const r = await playGame(map, `pacing-${s}`, opts);
      results.push(r);
      const shares = SAMPLE_MINUTES.filter((m) => r.leaderShare.has(m))
        .map((m) => `${m}m:${r.leaderShare.get(m)}%`)
        .join(" ");
      out(
        `${r.map.padEnd(16)} ${r.seed}  ` +
          `end ${r.endMinute ?? `>${opts.minutes}`} min  ` +
          `winner ${r.winner}  nations+humans left ${r.survivors}  ` +
          `[${shares}]  (${((performance.now() - started) / 1000).toFixed(0)}s)`,
      );
    }
  }

  const ended = results
    .map((r) => r.endMinute)
    .filter((m): m is number => m !== null);
  out(
    `\n${ended.length}/${results.length} games ended within ${opts.minutes} min` +
      (ended.length > 0
        ? `; median ${median(ended)} min, range ${Math.min(...ended)}-${Math.max(...ended)}`
        : ""),
  );
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : e}\n`);
  process.exit(1);
});
