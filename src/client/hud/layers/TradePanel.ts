import { GOODS } from "@openfront/engine-api/game/GameTypes";
import {
  MAX_TRADE_LAND_SHAPES,
  TradeTerms,
} from "@openfront/engine-api/Schemas";
import { emptyTerms, isEmptyTerms } from "@openfront/engine-lib/game/Trade";
import { EventBus, GameEvent } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { CloseViewEvent, MouseUpEvent, TouchEvent } from "../../InputHandler";
import type { MapRenderer } from "../../render/gl";
import { TransformHandler } from "../../TransformHandler";
import {
  SendTradeOfferIntentEvent,
  SendTradeReplyIntentEvent,
} from "../../Transport";
import { UIState } from "../../UIState";
import { translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";
import { GOOD_ICONS } from "../GoodsText";
import { payerLand, tradeLandMask } from "../TradeText";

/** Open the trade composer, optionally prefilled (a counter-offer). */
export class OpenTradePanelEvent implements GameEvent {
  constructor(
    public readonly target: PlayerView,
    public readonly prefill: {
      give: TradeTerms;
      ask: TradeTerms;
      ceasefire: boolean;
      pact: boolean;
      /** The offer this counters: rejected when the counter is sent. */
      counterOf: number;
    } | null = null,
  ) {}
}

/** Highlight the land in an incoming offer for a few seconds. */
export class ShowTradeLandEvent implements GameEvent {
  constructor(
    public readonly give: TradeTerms,
    public readonly giver: PlayerView,
    public readonly ask: TradeTerms,
    public readonly asked: PlayerView,
  ) {}
}

type Side = "give" | "ask";
const BRUSHES = [4, 8, 16];
const GOOD_NAMES = ["goods.food", "goods.oil", "goods.metal"];
// Troops are stored at 10x what players see (renderTroops).
const TROOP_SCALE = 10;
const LAND_PREVIEW_MS = 8000;

/**
 * Borderfall trade composer: what you give and ask for (gold, troops, goods,
 * painted land), plus ceasefire and trade pact. Floats beside the map so
 * land can be painted by clicking it.
 */
@customElement("trade-panel")
export class TradePanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  public transformHandler: TransformHandler;
  public view: MapRenderer;

  @state() private target: PlayerView | null = null;
  // Troops here are in displayed units; scaled on send.
  @state() private give: TradeTerms = emptyTerms();
  @state() private ask: TradeTerms = emptyTerms();
  @state() private ceasefire = false;
  @state() private pact = false;
  @state() private painting: Side | null = null;
  @state() private brush = BRUSHES[1];
  private counterOf: number | null = null;
  private previewTimeout: ReturnType<typeof setTimeout> | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(OpenTradePanelEvent, (e) => this.open(e));
    this.eventBus.on(ShowTradeLandEvent, (e) => this.previewLand(e));
    this.eventBus.on(MouseUpEvent, (e) => this.paintAt(e.x, e.y));
    this.eventBus.on(TouchEvent, (e) => this.paintAt(e.x, e.y));
    this.eventBus.on(CloseViewEvent, () => this.setPainting(null));
  }

  tick() {
    if (this.target === null) return;
    const me = this.game.myPlayer();
    if (!me?.isAlive() || !this.target.isAlive()) {
      this.close();
      return;
    }
    // Land changes hands as the war goes on; keep the highlight honest.
    if (this.game.ticks() % 10 === 0) this.updateMask();
  }

  private open(e: OpenTradePanelEvent) {
    const pre = e.prefill;
    this.target = e.target;
    this.give = pre ? toDisplay(pre.give) : emptyTerms();
    this.ask = pre ? toDisplay(pre.ask) : emptyTerms();
    this.ceasefire = pre?.ceasefire ?? false;
    this.pact = pre?.pact ?? false;
    this.counterOf = pre?.counterOf ?? null;
    this.setPainting(null);
    this.updateMask();
  }

  private close() {
    this.target = null;
    this.counterOf = null;
    this.setPainting(null);
    this.view.setTileMask(null);
  }

  private setPainting(side: Side | null) {
    this.painting = side;
    this.uiState.tradePainting = side !== null;
  }

  private paintAt(x: number, y: number) {
    if (this.painting === null || this.target === null) return;
    const cell = this.transformHandler.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(cell.x, cell.y)) return;
    const terms = this.painting === "give" ? this.give : this.ask;
    if (terms.land.length >= MAX_TRADE_LAND_SHAPES) return;
    const land = [
      ...terms.land,
      { tile: this.game.ref(cell.x, cell.y), radius: this.brush },
    ];
    this.setTerms(this.painting, { ...terms, land });
  }

  private setTerms(side: Side, terms: TradeTerms) {
    if (side === "give") this.give = terms;
    else this.ask = terms;
    this.updateMask();
  }

  private updateMask() {
    const me = this.game.myPlayer();
    if (this.target === null || me === null) return;
    this.view.setTileMask(
      tradeLandMask(this.game, this.give, me, this.ask, this.target),
    );
  }

  private previewLand(e: ShowTradeLandEvent) {
    if (this.target !== null) return;
    this.view.setTileMask(
      tradeLandMask(this.game, e.give, e.giver, e.ask, e.asked),
    );
    if (this.previewTimeout !== null) clearTimeout(this.previewTimeout);
    this.previewTimeout = setTimeout(() => {
      this.previewTimeout = null;
      if (this.target === null) this.view.setTileMask(null);
    }, LAND_PREVIEW_MS);
  }

  private send() {
    if (this.target === null) return;
    if (this.counterOf !== null) {
      this.eventBus.emit(new SendTradeReplyIntentEvent(this.counterOf, false));
    }
    this.eventBus.emit(
      new SendTradeOfferIntentEvent(
        this.target,
        toWire(this.give),
        toWire(this.ask),
        this.ceasefire,
        this.pact,
      ),
    );
    this.close();
  }

  private renderNumberField(
    side: Side,
    label: string,
    value: number,
    set: (terms: TradeTerms, v: number) => TradeTerms,
  ) {
    const terms = side === "give" ? this.give : this.ask;
    return html`
      <label class="flex items-center justify-between gap-2">
        <span class="whitespace-nowrap">${label}</span>
        <input
          type="number"
          min="0"
          step="any"
          class="w-24 rounded-sm bg-zinc-800 px-1.5 py-0.5 text-right tabular-nums text-white ring-1 ring-zinc-700 focus:outline-hidden focus:ring-sky-500"
          .value=${value > 0 ? String(value) : ""}
          placeholder="0"
          @input=${(e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            this.setTerms(side, set(terms, Number.isFinite(v) ? v : 0));
          }}
        />
      </label>
    `;
  }

  private renderSide(side: Side, payer: PlayerView) {
    const terms = side === "give" ? this.give : this.ask;
    const tiles = payerLand(this.game, terms, payer).length;
    const painting = this.painting === side;
    return html`
      <div class="flex flex-col gap-1.5">
        <div class="font-semibold text-zinc-100">
          ${translateText(side === "give" ? "trade.you_give" : "trade.you_ask")}
        </div>
        ${this.renderNumberField(
          side,
          `💰 ${translateText("trade.gold")}`,
          terms.gold,
          (t, v) => ({ ...t, gold: Math.max(0, Math.floor(v)) }),
        )}
        ${this.renderNumberField(
          side,
          `🪖 ${translateText("trade.troops")}`,
          terms.troops,
          (t, v) => ({ ...t, troops: Math.max(0, Math.floor(v)) }),
        )}
        ${GOODS.map((g) =>
          this.renderNumberField(
            side,
            `${GOOD_ICONS[g]} ${translateText(GOOD_NAMES[g])}`,
            terms.goods[g],
            (t, v) => {
              const goods = t.goods.slice() as TradeTerms["goods"];
              goods[g] = Math.max(0, Math.floor(v));
              return { ...t, goods };
            },
          ),
        )}
        <div class="flex items-center justify-between gap-2">
          <span class="whitespace-nowrap">
            🗺️ ${translateText("trade.tiles", { count: tiles })}
          </span>
          <button
            class="rounded-sm px-2 py-0.5 text-xs font-semibold ${painting
              ? "bg-sky-600 text-white"
              : "bg-zinc-700 text-zinc-100 hover:bg-zinc-600"}"
            aria-pressed=${painting}
            @click=${() => this.setPainting(painting ? null : side)}
          >
            ${translateText(painting ? "trade.done_painting" : "trade.paint")}
          </button>
        </div>
      </div>
    `;
  }

  private renderPaintTools() {
    if (this.painting === null) return "";
    const side = this.painting;
    const terms = side === "give" ? this.give : this.ask;
    return html`
      <div
        class="mt-2 flex flex-col gap-1.5 rounded-lg bg-zinc-800/80 p-2 text-xs"
      >
        <div class="text-sky-300">
          ${translateText(
            side === "give" ? "trade.paint_hint_give" : "trade.paint_hint_ask",
          )}
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <span>${translateText("trade.brush")}</span>
          ${BRUSHES.map(
            (r) => html`
              <button
                class="rounded-sm px-2 py-0.5 ${this.brush === r
                  ? "bg-sky-600 text-white"
                  : "bg-zinc-700 hover:bg-zinc-600"}"
                aria-pressed=${this.brush === r}
                @click=${() => (this.brush = r)}
              >
                ${r}
              </button>
            `,
          )}
          <button
            class="ml-auto rounded-sm bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600 disabled:opacity-40"
            ?disabled=${terms.land.length === 0}
            @click=${() =>
              this.setTerms(side, { ...terms, land: terms.land.slice(0, -1) })}
          >
            ${translateText("trade.undo")}
          </button>
          <button
            class="rounded-sm bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600 disabled:opacity-40"
            ?disabled=${terms.land.length === 0}
            @click=${() => this.setTerms(side, { ...terms, land: [] })}
          >
            ${translateText("trade.clear")}
          </button>
        </div>
      </div>
    `;
  }

  render() {
    const me = this.game?.myPlayer();
    if (this.target === null || !me) return html``;
    const empty =
      isEmptyTerms(this.give) &&
      isEmptyTerms(this.ask) &&
      !this.ceasefire &&
      !this.pact;
    return html`
      <div
        role="dialog"
        aria-label=${translateText("trade.title", {
          name: this.target.displayName(),
        })}
        class="pointer-events-auto fixed left-2 top-1/2 z-[1000] w-[22rem] max-w-[calc(100vw-1rem)] max-h-[90vh] -translate-y-1/2 overflow-y-auto rounded-2xl bg-slate-950/90 p-3 text-sm text-slate-200 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
        @keydown=${(e: KeyboardEvent) => e.stopPropagation()}
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <div class="font-black tracking-wide text-amber-400">
            ${translateText("trade.title", {
              name: this.target.displayName(),
            })}
          </div>
          <button
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-base font-bold text-slate-100 ring-1 ring-white/15 transition-colors hover:bg-rose-600 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            aria-label=${translateText("common.close")}
            @click=${() => this.close()}
          >
            ✕
          </button>
        </div>
        <div class="grid grid-cols-2 gap-3">
          ${this.renderSide("give", me)} ${this.renderSide("ask", this.target)}
        </div>
        ${this.renderPaintTools()}
        <div class="mt-2 flex flex-col gap-1">
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              .checked=${this.ceasefire}
              @change=${(e: Event) =>
                (this.ceasefire = (e.target as HTMLInputElement).checked)}
            />
            ${translateText("trade.ceasefire")}
          </label>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              .checked=${this.pact}
              @change=${(e: Event) =>
                (this.pact = (e.target as HTMLInputElement).checked)}
            />
            ${translateText("trade.pact")}
          </label>
        </div>
        <div class="mt-3 flex justify-end gap-2">
          <button
            class="rounded-sm bg-zinc-700 px-3 py-1 hover:bg-zinc-600"
            @click=${() => this.close()}
          >
            ${translateText("common.cancel")}
          </button>
          <button
            class="rounded-sm bg-green-600 px-3 py-1 font-semibold text-white hover:bg-green-700 disabled:opacity-40"
            ?disabled=${empty}
            @click=${() => this.send()}
          >
            ${translateText(
              this.counterOf === null ? "trade.send" : "trade.send_counter",
            )}
          </button>
        </div>
      </div>
    `;
  }
}

function toWire(terms: TradeTerms): TradeTerms {
  return { ...terms, troops: terms.troops * TROOP_SCALE };
}

function toDisplay(terms: TradeTerms): TradeTerms {
  return { ...terms, troops: Math.floor(terms.troops / TROOP_SCALE) };
}
