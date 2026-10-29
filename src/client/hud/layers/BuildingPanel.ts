import { renderNumber } from "@openfront/engine-lib/Format";
import { canAffordGoods } from "@openfront/engine-lib/game/Goods";
import {
  canRaiseTier,
  mainPath,
  MAX_TIER,
  MAX_TIER5_PER_TYPE,
  topTier,
  upgradeGold,
  upgradeGoods,
  upgradePaths,
} from "@openfront/engine-lib/game/Upgrades";
import { EventBus, GameEvent } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { CloseViewEvent } from "../../InputHandler";
import { SendUpgradeStructureIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView, UnitView } from "../../view";
import { goodsCostText } from "../GoodsText";
import { flattenedBuildTable } from "./BuildMenu";
import { levelEffects } from "./UpgradeEffects";

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-amber-400";

/** Show a building's upgrade paths (null hides the panel). */
export class SelectBuildingEvent implements GameEvent {
  constructor(public readonly unit: UnitView | null) {}
}

/**
 * Borderfall tech tree: a clicked building's upgrade paths beside the map,
 * the only place a building goes up (engine-lib/game/Upgrades).
 */
@customElement("building-panel")
export class BuildingPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state() private unit: UnitView | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(SelectBuildingEvent, (e) => (this.unit = e.unit));
    this.eventBus.on(CloseViewEvent, () => (this.unit = null));
  }

  tick() {
    if (this.unit === null) return;
    if (!this.unit.isActive() || this.unit.owner() !== this.game.myPlayer()) {
      this.unit = null;
      return;
    }
    // Gold, goods and tiers change every tick.
    this.requestUpdate();
  }

  /** Why `path` can't go up now, or null when it can. */
  private blocked(unit: UnitView, path: number): string | null {
    const me = this.game.myPlayer()!;
    const type = unit.type();
    const tiers = unit.tiers();
    const tier = tiers[path] + 1;
    if (tiers[path] >= MAX_TIER) return translateText("build_paths.maxed");
    if (!canRaiseTier(type, tiers, path)) {
      return translateText(
        tiers.filter((t) => t > 0).length >= 2 && tiers[path] === 0
          ? "build_paths.locked_third"
          : "build_paths.locked_second",
      );
    }
    const level5s = me
      .units(type)
      .filter((u) => topTier(u.tiers()) >= MAX_TIER).length;
    if (tier === MAX_TIER && level5s >= MAX_TIER5_PER_TYPE) {
      return translateText("build_paths.locked_level5");
    }
    if (unit.isUnderConstruction()) return translateText("build_paths.busy");
    const goodsOn = this.game.config().goodsEnabled();
    const short =
      me.gold() < upgradeGold(type, tier) ||
      (goodsOn && !canAffordGoods(me.goods(), upgradeGoods(type, path, tier)));
    return short ? translateText("build_paths.cant_afford") : null;
  }

  private upgrade(unit: UnitView, path: number, amount: number) {
    this.eventBus.emit(
      new SendUpgradeStructureIntentEvent(unit.id(), unit.type(), amount, path),
    );
  }

  private renderPath(unit: UnitView, path: number) {
    const type = unit.type();
    const info = upgradePaths(type)[path];
    const level = unit.tiers()[path];
    const next = Math.min(MAX_TIER, level + 1);
    const reason = this.blocked(unit, path);
    const maxed = level >= MAX_TIER;
    // A path the Bloons rules shut for good: shown, but dimmed.
    const shut = !maxed && !canRaiseTier(type, unit.tiers(), path);
    const goodsOn = this.game.config().goodsEnabled();
    return html`
      <div
        class="rounded-xl p-3 ring-1 transition-colors ${level > 0
          ? "bg-amber-500/10 ring-amber-500/40"
          : "bg-white/5 ring-white/10"} ${shut ? "opacity-50" : ""}"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="font-bold text-slate-100">
            ${translateText(`build_paths.${info.key}`)}
          </span>
          <span
            class="flex gap-1"
            role="img"
            aria-label=${translateText("building_panel.level", {
              level: level.toString(),
            })}
          >
            ${Array.from(
              { length: MAX_TIER },
              (_, i) => html`
                <span
                  class="h-2 w-4 rounded-full ${i < level
                    ? "bg-amber-400"
                    : "bg-white/15"}"
                ></span>
              `,
            )}
          </span>
        </div>
        <div class="mt-1 text-xs leading-snug text-slate-400">
          ${translateText(`build_paths.${info.key}_desc`)}
        </div>
        <ol class="mt-2 flex flex-col gap-0.5">
          ${levelEffects(type, path).map((text, i) => {
            const lvl = i + 1;
            const done = lvl <= level;
            const next = lvl === level + 1 && !shut;
            return html`<li
              class="flex gap-2 text-[11px] leading-snug ${done
                ? "text-amber-100"
                : next
                  ? "text-slate-100"
                  : "text-slate-500"}"
            >
              <span
                class="w-3 shrink-0 font-bold tabular-nums ${done
                  ? "text-amber-400"
                  : next
                    ? "text-emerald-400"
                    : ""}"
                >${lvl}</span
              >
              <span>${text}</span>
            </li>`;
          })}
        </ol>
        ${maxed
          ? html`<div
              class="mt-2 text-xs font-bold uppercase tracking-wider text-amber-400"
            >
              ${translateText("build_paths.maxed")}
            </div>`
          : html`<div class="mt-2 flex items-center justify-between gap-2">
                <span class="text-xs text-slate-300">
                  ${renderNumber(upgradeGold(type, next))}
                  ${translateText("player_panel.gold")}
                  ${goodsOn
                    ? goodsCostText(upgradeGoods(type, path, next))
                    : ""}
                </span>
                <button
                  class="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition-colors hover:bg-emerald-400 ${FOCUS} disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-500"
                  ?disabled=${reason !== null}
                  title=${reason ?? ""}
                  @click=${() => this.upgrade(unit, path, 1)}
                >
                  ${translateText("build_paths.title", {
                    path: translateText(`build_paths.${info.key}_short`),
                    level: next.toString(),
                  })}
                </button>
              </div>
              ${reason !== null
                ? html`<div class="mt-1.5 text-[11px] text-amber-300">
                    ${reason}
                  </div>`
                : ""}`}
      </div>
    `;
  }

  render() {
    const unit = this.unit;
    if (unit === null || this.game?.myPlayer() === null) return html``;
    const type = unit.type();
    const paths = upgradePaths(type);
    const item = flattenedBuildTable.find((i) => i.unitType === type);
    const main = mainPath(unit.tiers());
    const mainBlocked = this.blocked(unit, main);
    return html`
      <div
        role="dialog"
        aria-label=${translateText(item?.key ?? "")}
        class="pointer-events-auto fixed right-2 top-1/2 z-[1000] flex max-h-[80vh] w-[21rem] max-w-[calc(100vw-1rem)] -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-slate-950/90 text-sm text-slate-100 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="flex items-center justify-between gap-3 border-b border-white/10 bg-gradient-to-r from-amber-500/15 to-transparent px-4 py-3"
        >
          <div class="flex min-w-0 items-center gap-2.5">
            ${item
              ? html`<img
                  src=${item.icon}
                  alt=""
                  class="h-8 w-8 shrink-0 rounded-lg bg-white/10 p-1"
                />`
              : ""}
            <div class="min-w-0">
              <div class="truncate font-black tracking-wide text-amber-400">
                ${translateText(item?.key ?? "")}
              </div>
              <div class="text-[11px] text-slate-400">
                ${unit.isUnderConstruction()
                  ? translateText("build_paths.busy")
                  : translateText("building_panel.level", {
                      level: unit.level().toString(),
                    })}
              </div>
            </div>
          </div>
          <button
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-base font-bold text-slate-100 ring-1 ring-white/15 transition-colors hover:bg-rose-600 hover:text-white ${FOCUS}"
            aria-label=${translateText("common.close")}
            title=${translateText("common.close")}
            @click=${() => (this.unit = null)}
          >
            ✕
          </button>
        </div>
        <div class="flex flex-col gap-2 overflow-y-auto p-3">
          ${paths.map((_, path) => this.renderPath(unit, path))}
        </div>
        <div class="border-t border-white/10 p-3">
          <button
            class="w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-400 ${FOCUS} disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-500"
            ?disabled=${mainBlocked !== null}
            title=${translateText("build_paths.max_desc", {
              path: translateText(`build_paths.${paths[main].key}`),
            })}
            @click=${() => this.upgrade(unit, main, MAX_TIER)}
          >
            ${translateText("build_paths.max")}
          </button>
        </div>
      </div>
    `;
  }
}
