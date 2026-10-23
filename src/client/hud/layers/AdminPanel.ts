import {
  DisasterKind,
  Good,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AdminAction, MAX_ADMIN_BRUSH } from "@openfront/engine-api/Schemas";
import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import { isAdminRole } from "@openfront/shared/ApiSchemas";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getApiBase } from "../../Api";
import { getAuthHeader, userAuth } from "../../Auth";
import { Controller } from "../../Controller";
import { CloseViewEvent, MouseUpEvent, TouchEvent } from "../../InputHandler";
import { TransformHandler } from "../../TransformHandler";
import { SendAdminAuthEvent, SendAdminIntentEvent } from "../../Transport";
import { UIState } from "../../UIState";
import { translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";

const TROOP_SCALE = 10;

type Tab = "resources" | "map" | "control" | "intel";
type Tool = "paint" | "smite" | "disaster" | "spawn" | "revive";
type Resource = "gold" | "troops" | "food" | "oil" | "metal";
type DiplomacyOp =
  | "ally"
  | "break"
  | "embargo"
  | "unembargo"
  | "pact"
  | "end_pact";
/** An action that needs a second country, picked with the next map click. */
type SecondPick = { kind: "puppet" } | { kind: "diplomacy"; op: DiplomacyOp };

const RESOURCES: readonly Resource[] = [
  "gold",
  "troops",
  "food",
  "oil",
  "metal",
];
/** Quick amounts per resource, in displayed units. */
const PRESETS: Record<Resource, readonly number[]> = {
  gold: [10_000, 100_000, 1_000_000],
  troops: [10_000, 100_000, 1_000_000],
  food: [100, 500, 2000],
  oil: [100, 500, 2000],
  metal: [100, 500, 2000],
};
const RESOURCE_COLORS: Record<Resource, string> = {
  gold: "bg-yellow-400",
  troops: "bg-sky-400",
  food: "bg-lime-400",
  oil: "bg-zinc-300",
  metal: "bg-orange-400",
};

const TOOLS: readonly Tool[] = [
  "paint",
  "spawn",
  "smite",
  "disaster",
  "revive",
];

const SPAWNABLE = [
  UnitType.City,
  UnitType.Port,
  UnitType.Factory,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
  UnitType.Farm,
  UnitType.Mineshaft,
  UnitType.OilExtractor,
  UnitType.OilRig,
  UnitType.Warship,
] as const;

const DISASTER_CHOICES = [
  DisasterKind.Earthquake,
  DisasterKind.Hurricane,
  DisasterKind.Drought,
  DisasterKind.Tornado,
  DisasterKind.Outbreak,
  DisasterKind.Zombies,
] as const;

const DIPLOMACY_OPS: readonly DiplomacyOp[] = [
  "ally",
  "break",
  "embargo",
  "unembargo",
  "pact",
  "end_pact",
];

function unitKey(u: UnitType): string {
  return `unit_type.${u.toLowerCase().replace(/ /g, "_")}`;
}

/**
 * Borderfall admin tab. Only the admin account (its token carries the admin
 * role) sees the Admin button (or the backquote shortcut), and the tools
 * open only after the account service accepts the admin password. Game
 * servers check the account and password again before obeying.
 *
 * While the panel is open, map clicks belong to it: a click selects the
 * country under the cursor as the target, or, with a tool armed or a second
 * country asked for, applies that instead.
 */
@customElement("admin-panel")
export class AdminPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  public transformHandler: TransformHandler;

  @state() private open = false;
  @state() private isAdminAccount = false;
  // The admin password, once the account service accepted it this session.
  @state() private password: string | null = null;
  @state() private passwordDraft = "";
  @state() private wrongPassword = false;
  @state() private tab: Tab = "resources";
  @state() private target: string | null = null;
  @state() private tool: Tool | null = null;
  @state() private secondPick: SecondPick | null = null;
  @state() private status: string | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  @state() private god = false;

  @state() private amounts: Record<Resource, number> = {
    gold: 100_000,
    troops: 0,
    food: 0,
    oil: 0,
    metal: 0,
  };
  @state() private paintNeutral = false;
  @state() private brush = 10;
  @state() private nuke: UnitType.AtomBomb | UnitType.HydrogenBomb =
    UnitType.AtomBomb;
  @state() private disasterKind: DisasterKind = DisasterKind.Earthquake;
  @state() private spawnUnit: (typeof SPAWNABLE)[number] = UnitType.City;
  @state() private spawnLevel = 5;
  @state() private reviveTarget = "";

  createRenderRoot() {
    return this;
  }

  init() {
    window.addEventListener("keydown", this.onKey);
    this.eventBus.on(MouseUpEvent, (e) => this.onMapClick(e.x, e.y));
    this.eventBus.on(TouchEvent, (e) => this.onMapClick(e.x, e.y));
    this.eventBus.on(CloseViewEvent, () => this.cancelPick());
    void userAuth().then((auth) => {
      this.isAdminAccount = auth !== false && isAdminRole(auth.claims.role);
    });
  }

  tick() {
    if (this.open && this.game.ticks() % 10 === 0) this.requestUpdate();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== "Backquote" || !this.isAdminAccount) return;
    const el = e.target as HTMLElement | null;
    if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
    this.setOpen(!this.open);
  };

  private setOpen(open: boolean) {
    this.open = open;
    if (!open) this.cancelPick();
    this.syncClicks();
  }

  /** Map clicks are the panel's while it is open and unlocked. */
  private syncClicks() {
    this.uiState.adminTool = this.open && this.password !== null;
  }

  private cancelPick() {
    this.tool = null;
    this.secondPick = null;
  }

  private send(action: AdminAction, done: string) {
    this.eventBus.emit(new SendAdminIntentEvent(action));
    this.say(done);
  }

  private say(message: string) {
    this.status = message;
    if (this.statusTimer !== null) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => (this.status = null), 4000);
  }

  private async unlock() {
    const password = this.passwordDraft;
    if (password === "") return;
    let ok: boolean;
    try {
      const res = await fetch(`${getApiBase()}/admin/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await getAuthHeader(),
        },
        body: JSON.stringify({ password }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    this.wrongPassword = !ok;
    if (!ok) return;
    this.password = password;
    this.passwordDraft = "";
    this.target ??= this.game.myPlayer()?.id() ?? null;
    this.syncClicks();
    // The game server checks it too before it obeys (solo games have none).
    this.eventBus.emit(new SendAdminAuthEvent(password));
  }

  private lock() {
    this.password = null;
    this.cancelPick();
    this.syncClicks();
  }

  private player(id: string | null): PlayerView | null {
    if (id === null) return null;
    return this.game.players().find((p) => p.id() === id) ?? null;
  }

  private name(id: string | null): string {
    return this.player(id)?.displayName() ?? "?";
  }

  private onMapClick(x: number, y: number) {
    if (!this.open || this.password === null) return;
    const cell = this.transformHandler.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(cell.x, cell.y)) return;
    const tile = this.game.ref(cell.x, cell.y);
    if (this.tool !== null) return this.applyTool(tile);
    const owner = this.game.owner(tile);
    const clicked = owner.isPlayer() ? (owner as PlayerView) : null;
    if (this.secondPick !== null) {
      if (clicked === null || this.target === null) return;
      return this.applySecond(this.secondPick, clicked);
    }
    if (clicked === null) {
      this.say(translateText("admin_panel.no_country"));
      return;
    }
    this.target = clicked.id();
  }

  private applyTool(tile: number) {
    switch (this.tool) {
      case "paint":
        if (!this.paintNeutral && this.target === null) return;
        return this.send(
          {
            kind: "paint",
            tile,
            radius: this.brush,
            owner: this.paintNeutral ? null : this.target,
          },
          translateText("admin_panel.done_paint", {
            name: this.paintNeutral
              ? translateText("admin_panel.neutral")
              : this.name(this.target),
          }),
        );
      case "smite":
        return this.send(
          { kind: "smite", nuke: this.nuke, tile },
          translateText("admin_panel.done_smite"),
        );
      case "disaster":
        return this.send(
          { kind: "disaster", disaster: this.disasterKind, tile },
          translateText("admin_panel.done_disaster", {
            what: translateText(`admin_panel.disaster_${this.disasterKind}`),
          }),
        );
      case "spawn":
        if (this.target === null) return;
        return this.send(
          {
            kind: "spawn",
            unit: this.spawnUnit,
            tile,
            owner: this.target,
            level: this.spawnLevel,
          },
          translateText("admin_panel.done_spawn", {
            what: translateText(unitKey(this.spawnUnit)),
            name: this.name(this.target),
          }),
        );
      case "revive":
        if (this.reviveTarget === "") return;
        return this.send(
          { kind: "revive", target: this.reviveTarget, tile },
          translateText("admin_panel.done_revive", {
            name: this.name(this.reviveTarget),
          }),
        );
    }
  }

  private applySecond(pick: SecondPick, other: PlayerView) {
    const target = this.target!;
    this.secondPick = null;
    if (other.id() === target) return;
    if (pick.kind === "puppet") {
      return this.send(
        { kind: "puppet", nation: target, target: other.id() },
        translateText("admin_panel.done_puppet", {
          name: this.name(target),
          other: other.displayName(),
        }),
      );
    }
    this.send(
      { kind: "diplomacy", a: target, b: other.id(), op: pick.op },
      translateText(`admin_panel.done_op_${pick.op}`, {
        name: this.name(target),
        other: other.displayName(),
      }),
    );
  }

  private sendResources(sign: 1 | -1) {
    const target = this.target;
    if (target === null) return;
    const a = this.amounts;
    if (RESOURCES.every((r) => a[r] <= 0)) {
      this.say(translateText("admin_panel.pick_amount"));
      return;
    }
    this.send(
      {
        kind: "resources",
        target,
        gold: sign * a.gold,
        troops: sign * a.troops * TROOP_SCALE,
        goods: [sign * a.food, sign * a.oil, sign * a.metal],
      },
      translateText(
        sign > 0 ? "admin_panel.done_give" : "admin_panel.done_take",
        {
          name: this.name(target),
        },
      ),
    );
  }

  // ---------------------------------------------------------------- styles

  private chip(
    label: string | TemplateResult,
    active: boolean,
    onClick: () => void,
  ) {
    return html`<button
      class="px-2.5 py-1 rounded-full text-xs font-semibold transition-colors
        ${active
        ? "bg-amber-500 text-slate-950"
        : "bg-white/5 text-slate-200 hover:bg-white/10 ring-1 ring-white/10"}"
      @click=${onClick}
    >
      ${label}
    </button>`;
  }

  private action(
    label: string,
    onClick: () => void,
    tone: "go" | "stop" | "plain" = "plain",
  ) {
    const colors = {
      go: "bg-emerald-500 hover:bg-emerald-400 text-slate-950",
      stop: "bg-rose-600 hover:bg-rose-500 text-white",
      plain: "bg-white/10 hover:bg-white/15 text-slate-100",
    }[tone];
    return html`<button
      class="flex-1 px-3 py-2 rounded-lg text-sm font-bold transition-colors ${colors}"
      @click=${onClick}
    >
      ${label}
    </button>`;
  }

  private section(title: string, body: TemplateResult) {
    return html`<div class="flex flex-col gap-2">
      <div
        class="text-[11px] font-bold uppercase tracking-wider text-slate-400"
      >
        ${title}
      </div>
      ${body}
    </div>`;
  }

  private swatch(p: PlayerView | null, size = "w-3 h-3") {
    return html`<span
      class="${size} rounded-full ring-1 ring-white/30 shrink-0"
      style="background:${p?.territoryColor().toHex() ?? "#475569"}"
    ></span>`;
  }

  // --------------------------------------------------------------- render

  private renderTarget() {
    const p = this.player(this.target);
    const me = this.game.myPlayer();
    return html`<div
      class="rounded-xl bg-white/5 ring-1 ring-white/10 p-3 flex items-center gap-3"
    >
      ${this.swatch(p, "w-8 h-8")}
      <div class="min-w-0 flex-1">
        <div class="text-[11px] uppercase tracking-wider text-slate-400">
          ${translateText("admin_panel.selected")}
        </div>
        <div class="font-bold truncate">
          ${p === null
            ? translateText("admin_panel.click_country")
            : p.displayName()}
        </div>
        ${p !== null
          ? html`<div class="text-xs text-slate-400 truncate">
              ${translateText("admin_panel.target_stats", {
                tiles: renderNumber(p.numTilesOwned()),
                troops: renderTroops(p.troops()),
                gold: renderNumber(p.gold()),
              })}
            </div>`
          : nothing}
      </div>
      ${me !== null && me.id() !== this.target
        ? html`<button
            class="px-2 py-1 rounded-md text-xs font-semibold bg-white/10 hover:bg-white/15"
            @click=${() => (this.target = me.id())}
          >
            ${translateText("admin_panel.me")}
          </button>`
        : nothing}
    </div>`;
  }

  private renderResources() {
    const target = this.name(this.target);
    return html`
      ${RESOURCES.map(
        (r) =>
          html`<div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full ${RESOURCE_COLORS[r]}"></span>
              <span class="text-sm font-semibold flex-1">
                ${translateText(`admin_panel.res_${r}`)}
              </span>
              <input
                type="number"
                min="0"
                class="w-28 bg-slate-900 ring-1 ring-white/10 focus:ring-amber-500
                     rounded-md px-2 py-1 text-right text-sm outline-none"
                .value=${String(this.amounts[r])}
                @input=${(e: Event) => {
                  this.amounts = {
                    ...this.amounts,
                    [r]: Math.max(
                      0,
                      Number((e.target as HTMLInputElement).value),
                    ),
                  };
                }}
              />
            </div>
            <div class="flex gap-1.5 pl-4">
              ${PRESETS[r].map((n) =>
                this.chip(renderNumber(n), this.amounts[r] === n, () => {
                  this.amounts = {
                    ...this.amounts,
                    [r]: this.amounts[r] === n ? 0 : n,
                  };
                }),
              )}
            </div>
          </div>`,
      )}
      <div
        class="sticky -bottom-4 -mx-4 px-4 py-3 flex gap-2 bg-slate-950/95 border-t border-white/10"
      >
        ${this.action(
          translateText("admin_panel.give_to", { name: target }),
          () => this.sendResources(1),
          "go",
        )}
        ${this.action(
          translateText("admin_panel.take_from", { name: target }),
          () => this.sendResources(-1),
          "stop",
        )}
      </div>
      <label
        class="flex items-center justify-between gap-3 rounded-lg bg-white/5 ring-1 ring-white/10 p-3 cursor-pointer"
      >
        <div>
          <div class="text-sm font-bold">
            ${translateText("admin_panel.god_mode")}
          </div>
          <div class="text-xs text-slate-400">
            ${translateText("admin_panel.god_mode_desc")}
          </div>
        </div>
        <input
          type="checkbox"
          class="sr-only peer"
          .checked=${this.god}
          @change=${(e: Event) => {
            this.god = (e.target as HTMLInputElement).checked;
            this.send(
              { kind: "god", enabled: this.god },
              translateText(
                this.god
                  ? "admin_panel.done_god_on"
                  : "admin_panel.done_god_off",
              ),
            );
          }}
        />
        <span
          class="relative w-10 h-6 rounded-full bg-white/15 peer-checked:bg-amber-500 transition-colors
                 after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:rounded-full after:bg-white
                 after:transition-transform peer-checked:after:translate-x-4"
        ></span>
      </label>
    `;
  }

  private renderTools() {
    return html`<div class="grid grid-cols-2 gap-2">
      ${TOOLS.map((t) => {
        const armed = this.tool === t;
        return html`<button
          class="text-left rounded-lg p-2.5 transition-colors ring-1
            ${armed
            ? "bg-amber-500/15 ring-amber-500"
            : "bg-white/5 ring-white/10 hover:bg-white/10"}"
          @click=${() => {
            this.secondPick = null;
            this.tool = armed ? null : t;
          }}
        >
          <div class="text-sm font-bold">
            ${translateText(`admin_panel.tool_${t}`)}
          </div>
          <div class="text-[11px] text-slate-400 leading-snug">
            ${translateText(`admin_panel.tool_${t}_desc`)}
          </div>
        </button>`;
      })}
    </div>`;
  }

  private renderToolOptions() {
    switch (this.tool) {
      case "paint":
        return html`<div class="flex gap-1.5 flex-wrap">
            ${this.chip(
              translateText("admin_panel.paint_target", {
                name: this.name(this.target),
              }),
              !this.paintNeutral,
              () => (this.paintNeutral = false),
            )}
            ${this.chip(
              translateText("admin_panel.neutral"),
              this.paintNeutral,
              () => (this.paintNeutral = true),
            )}
          </div>
          ${this.slider(
            translateText("admin_panel.brush"),
            this.brush,
            1,
            MAX_ADMIN_BRUSH,
            (n) => (this.brush = n),
          )}`;
      case "smite":
        return html`<div class="flex gap-1.5">
          ${([UnitType.AtomBomb, UnitType.HydrogenBomb] as const).map((n) =>
            this.chip(translateText(unitKey(n)), this.nuke === n, () => {
              this.nuke = n;
            }),
          )}
        </div>`;
      case "disaster":
        return html`<div class="flex gap-1.5 flex-wrap">
          ${DISASTER_CHOICES.map((k) =>
            this.chip(
              translateText(`admin_panel.disaster_${k}`),
              this.disasterKind === k,
              () => (this.disasterKind = k),
            ),
          )}
        </div>`;
      case "spawn":
        return html`<div class="flex gap-1.5 flex-wrap">
            ${SPAWNABLE.map((u) =>
              this.chip(translateText(unitKey(u)), this.spawnUnit === u, () => {
                this.spawnUnit = u;
              }),
            )}
          </div>
          ${this.slider(
            translateText("admin_panel.level"),
            this.spawnLevel,
            1,
            20,
            (n) => (this.spawnLevel = n),
          )}`;
      case "revive": {
        const dead = this.game.players().filter((p) => !p.isAlive());
        return dead.length === 0
          ? html`<div class="text-xs text-slate-400">
              ${translateText("admin_panel.nobody_dead")}
            </div>`
          : html`<div class="flex gap-1.5 flex-wrap">
              ${dead.map((p) =>
                this.chip(p.displayName(), this.reviveTarget === p.id(), () => {
                  this.reviveTarget = p.id();
                }),
              )}
            </div>`;
      }
      default:
        return nothing;
    }
  }

  private slider(
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (n: number) => void,
  ) {
    return html`<label class="flex items-center gap-3 text-sm">
      <span class="w-14 text-slate-300">${label}</span>
      <input
        type="range"
        class="flex-1 accent-amber-500"
        min=${min}
        max=${max}
        .value=${String(value)}
        @input=${(e: Event) =>
          onChange(Number((e.target as HTMLInputElement).value))}
      />
      <span class="w-6 text-right font-semibold">${value}</span>
    </label>`;
  }

  private renderMap() {
    return html`${this.renderTools()}
    ${this.tool !== null
      ? html`<div
          class="flex flex-col gap-2 rounded-lg bg-white/5 ring-1 ring-white/10 p-3"
        >
          ${this.renderToolOptions()}
          <div class="text-xs text-amber-300">
            ${translateText("admin_panel.click_map")}
          </div>
        </div>`
      : nothing}`;
  }

  private renderControl() {
    const name = this.name(this.target);
    const asking = (pick: SecondPick) =>
      this.secondPick?.kind === pick.kind &&
      (pick.kind !== "diplomacy" ||
        (this.secondPick as { op: DiplomacyOp }).op === pick.op);
    const ask = (pick: SecondPick) => {
      this.tool = null;
      this.secondPick = asking(pick) ? null : pick;
    };
    const target = this.player(this.target);
    const isNation = target !== null && target.type() !== PlayerType.Human;
    return html`
      ${this.section(
        translateText("admin_panel.puppet"),
        isNation
          ? html`<div class="flex">
              ${this.action(
                translateText("admin_panel.make_attack", { name }),
                () => ask({ kind: "puppet" }),
              )}
            </div>`
          : html`<div class="text-xs text-slate-400">
              ${translateText("admin_panel.puppet_needs_nation")}
            </div>`,
      )}
      ${this.section(
        translateText("admin_panel.diplomacy"),
        html`<div class="grid grid-cols-2 gap-1.5">
          ${DIPLOMACY_OPS.map((op) =>
            this.chip(
              translateText(`admin_panel.op_${op}`),
              asking({ kind: "diplomacy", op }),
              () => ask({ kind: "diplomacy", op }),
            ),
          )}
        </div>`,
      )}
      ${this.secondPick !== null
        ? html`<div class="text-xs text-amber-300">
            ${translateText("admin_panel.click_other", { name })}
          </div>`
        : nothing}
      ${this.section(
        translateText("admin_panel.doom"),
        html`<div class="flex gap-2">
          ${this.action(
            translateText("admin_panel.eliminate"),
            () => {
              if (this.target === null) return;
              this.send(
                { kind: "eliminate", target: this.target },
                translateText("admin_panel.done_eliminate", { name }),
              );
            },
            "stop",
          )}
          ${this.action(
            translateText("admin_panel.zombies"),
            () => {
              if (this.target === null) return;
              this.send(
                { kind: "zombies", target: this.target },
                translateText("admin_panel.done_zombies", { name }),
              );
            },
            "stop",
          )}
        </div>`,
      )}
    `;
  }

  private renderIntel() {
    const rows = this.game
      .players()
      .filter((p) => p.isAlive())
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    return html`<div class="flex flex-col gap-1">
      ${rows.map((p) => {
        const goods = p.goods();
        const attacking = p
          .outgoingAttacks()
          .map((a) => {
            const t = this.game.playerBySmallID(a.targetID);
            return t.isPlayer()
              ? (t as PlayerView).displayName()
              : translateText("admin_panel.neutral");
          })
          .join(", ");
        const selected = p.id() === this.target;
        return html`<button
          class="text-left rounded-lg px-2.5 py-2 ring-1 transition-colors
            ${selected
            ? "bg-amber-500/15 ring-amber-500"
            : "bg-white/5 ring-white/5 hover:bg-white/10"}"
          @click=${() => (this.target = p.id())}
        >
          <div class="flex items-center gap-2">
            ${this.swatch(p)}
            <span class="font-semibold text-sm truncate flex-1"
              >${p.displayName()}</span
            >
            <span class="text-xs text-slate-400"
              >${renderNumber(p.numTilesOwned())}</span
            >
          </div>
          <div class="text-[11px] text-slate-400 pl-5">
            ${translateText("admin_panel.intel_line", {
              troops: renderTroops(p.troops()),
              gold: renderNumber(p.gold()),
              food: Math.floor(goods[Good.Food]),
              oil: Math.floor(goods[Good.Oil]),
              metal: Math.floor(goods[Good.Metal]),
            })}
          </div>
          ${attacking !== ""
            ? html`<div class="text-[11px] text-rose-300 pl-5 truncate">
                ${translateText("admin_panel.attacking_line", {
                  names: attacking,
                })}
              </div>`
            : nothing}
        </button>`;
      })}
    </div>`;
  }

  private renderLocked() {
    return html`<div class="flex flex-col gap-3 p-1">
      <div class="text-sm text-slate-300">
        ${translateText("admin_panel.enter_password")}
      </div>
      <input
        type="password"
        class="bg-slate-900 ring-1 ring-white/10 focus:ring-amber-500 rounded-lg px-3 py-2 outline-none"
        .value=${this.passwordDraft}
        @input=${(e: Event) =>
          (this.passwordDraft = (e.target as HTMLInputElement).value)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter") void this.unlock();
        }}
      />
      ${this.wrongPassword
        ? html`<div class="text-xs text-rose-400">
            ${translateText("admin_panel.wrong_password")}
          </div>`
        : nothing}
      <div class="flex">
        ${this.action(
          translateText("admin_panel.unlock"),
          () => void this.unlock(),
          "go",
        )}
      </div>
    </div>`;
  }

  render() {
    if (!this.isAdminAccount) return null;
    if (!this.open) {
      return html`<button
        class="fixed bottom-24 right-3 z-[1001] px-4 py-2 rounded-full text-sm font-bold
               bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20"
        @click=${() => this.setOpen(true)}
      >
        ${translateText("admin_panel.title")}
      </button>`;
    }
    const unlocked = this.password !== null;
    return html`<div
      class="fixed top-16 right-3 z-[1001] w-[360px] max-w-[calc(100vw-1.5rem)]
             max-h-[calc(100vh-8rem)] flex flex-col rounded-2xl overflow-hidden
             bg-slate-950/90 backdrop-blur-md ring-1 ring-white/10 shadow-2xl text-slate-100"
      @contextmenu=${(e: MouseEvent) => e.preventDefault()}
    >
      <div
        class="flex items-center justify-between px-4 py-3 border-b border-white/10"
      >
        <div>
          <div class="font-black tracking-wide text-amber-400">
            ${translateText("admin_panel.title")}
          </div>
          <div class="text-[11px] text-slate-400">
            ${translateText(
              unlocked ? "admin_panel.subtitle" : "admin_panel.subtitle_locked",
            )}
          </div>
        </div>
        <button
          class="w-8 h-8 rounded-full hover:bg-white/10 text-slate-400"
          aria-label=${translateText("admin_panel.close")}
          @click=${() => this.setOpen(false)}
        >
          ✕
        </button>
      </div>
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        ${unlocked
          ? html`${this.renderTarget()}
              <div class="grid grid-cols-4 gap-1 rounded-lg bg-white/5 p-1">
                ${(["resources", "map", "control", "intel"] as const).map(
                  (t) =>
                    html`<button
                      class="py-1.5 rounded-md text-xs font-bold transition-colors
                        ${this.tab === t
                        ? "bg-amber-500 text-slate-950"
                        : "text-slate-300 hover:bg-white/10"}"
                      @click=${() => {
                        this.tab = t;
                        this.cancelPick();
                      }}
                    >
                      ${translateText(`admin_panel.tab_${t}`)}
                    </button>`,
                )}
              </div>
              ${this.tab === "resources" ? this.renderResources() : nothing}
              ${this.tab === "map" ? this.renderMap() : nothing}
              ${this.tab === "control" ? this.renderControl() : nothing}
              ${this.tab === "intel" ? this.renderIntel() : nothing}`
          : this.renderLocked()}
      </div>
      ${unlocked
        ? html`<div
            class="flex items-center justify-between gap-2 px-4 py-2 border-t border-white/10 text-xs"
          >
            <span class="text-emerald-300 truncate"
              >${this.status ?? translateText("admin_panel.hint")}</span
            >
            <button
              class="text-slate-500 hover:text-slate-300 shrink-0"
              @click=${() => this.lock()}
            >
              ${translateText("admin_panel.lock")}
            </button>
          </div>`
        : nothing}
    </div>`;
  }
}
