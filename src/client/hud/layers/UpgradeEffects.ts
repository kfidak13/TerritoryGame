import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import {
  CITY_GOLD,
  CITY_POP,
  FACTORY_BANDIT_GOLD_PERCENT,
  FACTORY_BANDIT_STEAL_PERCENT,
  FACTORY_BANDIT_TOLL_PERCENT,
  FACTORY_EXPRESS_ROLLS,
  FACTORY_EXPRESS_SPEED,
  FACTORY_FREIGHT_GOLD_PERCENT,
  GOODS_OUTPUT_PERCENT,
  MAX_TIER,
  PORT_INVASION_SPEED_PERCENT,
  PORT_INVASION_TROOPS_PERCENT,
  PORT_INVASION_TWIN_TIER,
  PORT_NAVY_POWER_PERCENT,
  PORT_NAVY_SPEED_PERCENT,
  PORT_TRADE_GOLD_PERCENT,
  PORT_TRADE_ROLLS,
  PORT_TRADE_SPEED_PERCENT,
  POST_BARRACKS_REGROWTH_PERCENT,
  POST_BARRACKS_TROOPS,
  POST_FORTRESS_DEFENSE_PERCENT,
  POST_FORTRESS_SLOW_PERCENT,
  POST_WATCHTOWER_BOAT_TIER,
  POST_WATCHTOWER_RANGE_PERCENT,
  POST_WATCHTOWER_WARSHIP_TIER,
  RIG_DRILL_YIELD_PERCENT,
  RIG_HULL_HEALTH_PERCENT,
  RIG_HULL_REPAIR,
  RIG_PLATFORM_DAMAGE_PERCENT,
  RIG_PLATFORM_INTERVAL,
  RIG_PLATFORM_RANGE,
  RIG_PLATFORM_WARSHIP_TIER,
  SAM_AEGIS_DAMAGE_PERCENT,
  SAM_AEGIS_INTERVAL,
  SAM_AEGIS_WARSHIP_TIER,
  SAM_BASE_RANGE,
  SAM_BATTERY_RELOAD_PERCENT,
  SAM_BATTERY_TUBES,
  SAM_RANGE_PERCENT,
  SILO_ARSENAL_RELOAD_PERCENT,
  SILO_ARSENAL_TUBES,
  SILO_PLAGUE_AREA_PERCENT,
  SILO_PLAGUE_TICKS,
  SILO_WARHEAD_BLAST_PERCENT,
  SILO_WARHEAD_STRENGTH,
  upgradePaths,
} from "@openfront/engine-lib/game/Upgrades";
import { translateText } from "../../Utils";

type Part = [key: string, params?: Record<string, string | number>];

const pct = (n: number) => ({ n });
const secs = (ticks: number) => ({ n: Math.round(ticks / 10) });

/**
 * What one level of a path gives, in total at that level (Upgrades.ts
 * tables): the parts that make up the line in the building panel. Unlocks
 * are named at the level they arrive.
 */
function parts(key: string, t: number): Part[] {
  switch (key) {
    case "city_metropolis":
    case "city_market":
    case "city_capital": {
      const path = ["city_metropolis", "city_market", "city_capital"].indexOf(
        key,
      );
      const out: Part[] = [
        ["upgrade_effect.troops", { n: renderNumber(CITY_POP[path][t]) }],
      ];
      // Gold per tick, shown per second.
      if (CITY_GOLD[path][t] > 0) {
        out.push([
          "upgrade_effect.gold",
          { n: renderNumber(CITY_GOLD[path][t] * 10) },
        ]);
      }
      if (key === "city_capital" && t === MAX_TIER)
        out.push(["upgrade_effect.capital"]);
      return out;
    }
    case "port_trade":
      return [
        ["upgrade_effect.trade_gold", pct(PORT_TRADE_GOLD_PERCENT[t])],
        ["upgrade_effect.spawns", { n: PORT_TRADE_ROLLS[t] }],
        ...speed(PORT_TRADE_SPEED_PERCENT[t]),
      ];
    case "port_navy":
      return [
        ["upgrade_effect.navy", pct(PORT_NAVY_POWER_PERCENT[t])],
        ...speed(PORT_NAVY_SPEED_PERCENT[t]),
      ];
    case "port_invasion":
      return [
        ["upgrade_effect.invasion", pct(PORT_INVASION_TROOPS_PERCENT[t])],
        ...speed(PORT_INVASION_SPEED_PERCENT[t]),
        ...(t >= PORT_INVASION_TWIN_TIER
          ? [["upgrade_effect.twin"] as Part]
          : []),
      ];
    case "factory_freight":
      return [["upgrade_effect.freight", pct(FACTORY_FREIGHT_GOLD_PERCENT[t])]];
    case "factory_express":
      return [
        ["upgrade_effect.trains", { n: FACTORY_EXPRESS_ROLLS[t] }],
        ["upgrade_effect.train_speed", { n: FACTORY_EXPRESS_SPEED[t] }],
      ];
    case "factory_bandit":
      return [
        ["upgrade_effect.bandit_station"],
        ...(FACTORY_BANDIT_GOLD_PERCENT[t] > 0
          ? [
              [
                "upgrade_effect.freight",
                pct(FACTORY_BANDIT_GOLD_PERCENT[t]),
              ] as Part,
            ]
          : []),
        ...(FACTORY_BANDIT_STEAL_PERCENT[t] > 0
          ? [
              [
                "upgrade_effect.steal",
                pct(FACTORY_BANDIT_STEAL_PERCENT[t]),
              ] as Part,
            ]
          : []),
        ...(t === MAX_TIER
          ? [["upgrade_effect.toll", pct(FACTORY_BANDIT_TOLL_PERCENT)] as Part]
          : []),
      ];
    case "sam_range":
      return [
        [
          "upgrade_effect.reach",
          {
            n: SAM_RANGE_PERCENT[t],
            tiles: Math.round(
              (SAM_BASE_RANGE * (100 + SAM_RANGE_PERCENT[t])) / 100,
            ),
          },
        ],
      ];
    case "sam_battery":
      return [
        ["upgrade_effect.missiles", { n: SAM_BATTERY_TUBES[t] }],
        ...reload(SAM_BATTERY_RELOAD_PERCENT[t]),
      ];
    case "sam_aegis":
      return [
        [
          t >= SAM_AEGIS_WARSHIP_TIER
            ? "upgrade_effect.shells_ships"
            : "upgrade_effect.shells_boats",
          secs(SAM_AEGIS_INTERVAL[t]),
        ],
        ...damage(SAM_AEGIS_DAMAGE_PERCENT[t]),
      ];
    case "silo_warhead":
      return [
        ["upgrade_effect.blast", pct(SILO_WARHEAD_BLAST_PERCENT[t])],
        ...(SILO_WARHEAD_STRENGTH[t] > 0
          ? [
              [
                "upgrade_effect.strength",
                { n: SILO_WARHEAD_STRENGTH[t] },
              ] as Part,
            ]
          : []),
      ];
    case "silo_arsenal":
      return [
        ["upgrade_effect.nukes", { n: SILO_ARSENAL_TUBES[t] }],
        ...reload(SILO_ARSENAL_RELOAD_PERCENT[t]),
      ];
    case "silo_plague":
      return [
        ["upgrade_effect.plague", secs(SILO_PLAGUE_TICKS[t])],
        ...(SILO_PLAGUE_AREA_PERCENT[t] > 100
          ? [
              [
                "upgrade_effect.area",
                pct(SILO_PLAGUE_AREA_PERCENT[t] - 100),
              ] as Part,
            ]
          : []),
      ];
    case "post_fortress":
      return [
        ["upgrade_effect.defense", pct(POST_FORTRESS_DEFENSE_PERCENT[t] - 100)],
        ...(POST_FORTRESS_SLOW_PERCENT[t] > 100
          ? [
              [
                "upgrade_effect.slow",
                pct(POST_FORTRESS_SLOW_PERCENT[t] - 100),
              ] as Part,
            ]
          : []),
      ];
    case "post_watchtower":
      return [
        ["upgrade_effect.post_reach", pct(POST_WATCHTOWER_RANGE_PERCENT[t])],
        ...(t >= POST_WATCHTOWER_WARSHIP_TIER
          ? [["upgrade_effect.post_shells_ships"] as Part]
          : t >= POST_WATCHTOWER_BOAT_TIER
            ? [["upgrade_effect.post_shells_boats"] as Part]
            : []),
      ];
    case "post_barracks":
      return [
        ["upgrade_effect.regrowth", pct(POST_BARRACKS_REGROWTH_PERCENT[t])],
        ...(POST_BARRACKS_TROOPS[t] > 0
          ? [
              [
                "upgrade_effect.troops",
                { n: renderNumber(POST_BARRACKS_TROOPS[t]) },
              ] as Part,
            ]
          : []),
      ];
    case "rig_drill":
      return [["upgrade_effect.oil", { n: RIG_DRILL_YIELD_PERCENT[t] / 100 }]];
    case "rig_hull":
      return [
        ["upgrade_effect.health", { n: RIG_HULL_HEALTH_PERCENT[t] / 100 }],
        ["upgrade_effect.repair", { n: RIG_HULL_REPAIR[t] }],
      ];
    case "rig_platform":
      return [
        [
          t >= RIG_PLATFORM_WARSHIP_TIER
            ? "upgrade_effect.shells_ships"
            : "upgrade_effect.shells_boats",
          secs(RIG_PLATFORM_INTERVAL[t]),
        ],
        ["upgrade_effect.range", { n: RIG_PLATFORM_RANGE[t] }],
        ...damage(RIG_PLATFORM_DAMAGE_PERCENT[t]),
      ];
    case "output":
      return [["upgrade_effect.output", { n: GOODS_OUTPUT_PERCENT[t] / 100 }]];
    default:
      return [];
  }
}

const speed = (p: number): Part[] =>
  p > 0 ? [["upgrade_effect.speed", pct(p)]] : [];
const reload = (p: number): Part[] =>
  p < 100 ? [["upgrade_effect.reload", pct(100 - p)]] : [];
const damage = (p: number): Part[] =>
  p > 100 ? [["upgrade_effect.damage", { n: p / 100 }]] : [];

/** One line per level (1-5) of `path`, each its total effect at that level. */
export function levelEffects(type: UnitType, path: number): string[] {
  const info = upgradePaths(type)[path];
  if (info === undefined) return [];
  return Array.from({ length: MAX_TIER }, (_, i) =>
    parts(info.key, i + 1)
      .map(([k, params]) => translateText(k, params))
      .join(" · "),
  );
}
