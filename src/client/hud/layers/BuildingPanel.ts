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
    const info = upgradePaths(unit.type())[path];
    const level = unit.tiers()[path];
    const next = Math.min(MAX_TIER, level + 1);
    const reason = this.blocked(unit, path);
    const goodsOn = this.game.config().goodsEnabled();
    return html`
      <div class="rounded-lg bg-zinc-800/80 p-2">
        <div class="flex items-center justify-between gap-2">
          <span class="font-semibold text-white">
            ${translateText(`build_paths.${info.key}`)}
          </span>
          <span class="flex gap-1" aria-label=${`${level}/${MAX_TIER}`}>
            ${Array.from(
              { length: MAX_TIER },
              (_, i) => html`
                <span
                  class="h-2.5 w-2.5 rounded-full ${i < level
                    ? "bg-sky-400"
                    : "bg-zinc-600"}"
                ></span>
              `,
            )}
          </span>
        </div>
        <div class="mt-1 text-xs text-zinc-400">
          ${translateText(`build_paths.${info.key}_desc`)}
        </div>
        <div class="mt-2 flex items-center justify-between gap-2 text-xs">
          <span class="text-zinc-300">
            ${level < MAX_TIER
              ? html`${renderNumber(upgradeGold(unit.type(), next))}
                ${translateText("player_panel.gold")}
                ${goodsOn
                  ? goodsCostText(upgradeGoods(unit.type(), path, next))
                  : ""}`
              : ""}
          </span>
          <button
            class="rounded-sm bg-green-600 px-3 py-1 font-semibold text-white hover:bg-green-700 disabled:bg-zinc-700 disabled:text-zinc-400"
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
        ${reason !== null && level < MAX_TIER
          ? html`<div class="mt-1 text-xs text-amber-300">${reason}</div>`
          : ""}
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
        class="pointer-events-auto fixed right-2 top-1/2 z-[1000] w-[20rem] max-w-[calc(100vw-1rem)] max-h-[80vh] -translate-y-1/2 overflow-y-auto rounded-xl bg-zinc-900/95 p-3 text-sm text-zinc-200 shadow-2xl ring-1 ring-zinc-700"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            ${item ? html`<img src=${item.icon} alt="" class="h-6 w-6" />` : ""}
            <span class="text-base font-bold text-white">
              ${translateText(item?.key ?? "")}
            </span>
            <span class="text-zinc-400">
              ${translateText("building_panel.level", {
                level: unit.level().toString(),
              })}
            </span>
          </div>
          <button
            class="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-white hover:bg-red-500"
            aria-label=${translateText("common.close")}
            @click=${() => (this.unit = null)}
          >
            ✕
          </button>
        </div>
        ${unit.isUnderConstruction()
          ? html`<div class="mb-2 text-xs text-sky-300">
              ${translateText("build_paths.busy")}
            </div>`
          : ""}
        <div class="flex flex-col gap-2">
          ${paths.map((_, path) => this.renderPath(unit, path))}
        </div>
        <button
          class="mt-2 w-full rounded-sm bg-sky-700 px-3 py-1 font-semibold text-white hover:bg-sky-600 disabled:bg-zinc-700 disabled:text-zinc-400"
          ?disabled=${mainBlocked !== null}
          title=${translateText("build_paths.max_desc", {
            path: translateText(`build_paths.${paths[main].key}`),
          })}
          @click=${() => this.upgrade(unit, main, MAX_TIER)}
        >
          ${translateText("build_paths.max")}
        </button>
      </div>
    `;
  }
}
