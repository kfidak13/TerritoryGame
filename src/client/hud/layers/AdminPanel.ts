import {
  DisasterKind,
  Good,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AdminAction, MAX_ADMIN_BRUSH } from "@openfront/engine-api/Schemas";
import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { CloseViewEvent, MouseUpEvent, TouchEvent } from "../../InputHandler";
import { TransformHandler } from "../../TransformHandler";
import { SendAdminAuthEvent, SendAdminIntentEvent } from "../../Transport";
import { UIState } from "../../UIState";
import { translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";

const KEY_STORAGE = "borderfall.adminKey";
const TROOP_SCALE = 10;

type Tab = "resources" | "map" | "control" | "intel";
type Tool = "paint" | "smite" | "disaster" | "spawn" | "revive";

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

const DIPLOMACY_OPS = [
  "ally",
  "break",
  "embargo",
  "unembargo",
  "pact",
  "end_pact",
] as const;

function readKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

/**
 * Borderfall admin tab: opened with the backquote key, and only once this
 * browser holds the admin key. The server checks the key; in solo games
 * there is nobody to protect, so any key unlocks it.
 */
@customElement("admin-panel")
export class AdminPanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  public transformHandler: TransformHandler;

  @state() private open = false;
  @state() private key: string | null = readKey();
  @state() private keyDraft = "";
  @state() private tab: Tab = "resources";
  @state() private tool: Tool | null = null;
  @state() private god = false;

  // Resources
  @state() private target = "";
  @state() private amounts = { gold: 0, troops: 0, food: 0, oil: 0, metal: 0 };
  // Map
  @state() private paintOwner = "";
  @state() private brush = 10;
  @state() private nuke: UnitType.AtomBomb | UnitType.HydrogenBomb =
    UnitType.AtomBomb;
  @state() private disasterKind: DisasterKind = DisasterKind.Earthquake;
  @state() private spawnUnit: (typeof SPAWNABLE)[number] = UnitType.City;
  @state() private spawnOwner = "";
  @state() private spawnLevel = 5;
  @state() private reviveTarget = "";
  // Control
  @state() private puppet = "";
  @state() private puppetTarget = "";
  @state() private dipA = "";
  @state() private dipB = "";
  @state() private victim = "";

  createRenderRoot() {
    return this;
  }

  init() {
    window.addEventListener("keydown", this.onKey);
    this.eventBus.on(MouseUpEvent, (e) => this.applyTool(e.x, e.y));
    this.eventBus.on(TouchEvent, (e) => this.applyTool(e.x, e.y));
    this.eventBus.on(CloseViewEvent, () => this.setTool(null));
    if (this.key !== null) this.eventBus.emit(new SendAdminAuthEvent(this.key));
  }

  tick() {
    if (this.open && this.game.ticks() % 10 === 0) this.requestUpdate();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== "Backquote") return;
    const el = e.target as HTMLElement | null;
    if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;
    this.open = !this.open;
    if (!this.open) this.setTool(null);
  };

  private send(action: AdminAction) {
    this.eventBus.emit(new SendAdminIntentEvent(action));
  }

  private saveKey() {
    const key = this.keyDraft.trim();
    if (key === "") return;
    try {
      localStorage.setItem(KEY_STORAGE, key);
    } catch {
      // Private mode: the key lasts this game only.
    }
    this.key = key;
    this.keyDraft = "";
    this.eventBus.emit(new SendAdminAuthEvent(key));
  }

  private forgetKey() {
    try {
      localStorage.removeItem(KEY_STORAGE);
    } catch {
      // Nothing stored.
    }
    this.key = null;
    this.setTool(null);
  }

  private setTool(tool: Tool | null) {
    this.tool = tool;
    this.uiState.adminTool = tool !== null;
  }

  private applyTool(x: number, y: number) {
    if (this.tool === null) return;
    const cell = this.transformHandler.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(cell.x, cell.y)) return;
    const tile = this.game.ref(cell.x, cell.y);
    switch (this.tool) {
      case "paint":
        return this.send({
          kind: "paint",
          tile,
          radius: this.brush,
          owner: this.paintOwner === "" ? null : this.paintOwner,
        });
      case "smite":
        return this.send({ kind: "smite", nuke: this.nuke, tile });
      case "disaster":
        return this.send({
          kind: "disaster",
          disaster: this.disasterKind,
          tile,
        });
      case "spawn":
        if (this.spawnOwner === "") return;
        return this.send({
          kind: "spawn",
          unit: this.spawnUnit,
          tile,
          owner: this.spawnOwner,
          level: this.spawnLevel,
        });
      case "revive":
        if (this.reviveTarget === "") return;
        return this.send({ kind: "revive", target: this.reviveTarget, tile });
    }
  }

  private players(filter: (p: PlayerView) => boolean = (p) => p.isAlive()) {
    return this.game
      .players()
      .filter(filter)
      .sort((a, b) => a.displayName().localeCompare(b.displayName()));
  }

  private playerSelect(
    value: string,
    onChange: (id: string) => void,
    options: PlayerView[],
    emptyLabel?: string,
  ) {
    const me = this.game.myPlayer();
    return html`<select
      class="w-full bg-gray-800 border border-white/20 rounded px-1 py-0.5 text-sm"
      .value=${value}
      @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}
    >
      <option value="">
        ${emptyLabel ?? translateText("admin_panel.pick_player")}
      </option>
      ${options.map(
        (p) =>
          html`<option value=${p.id()} ?selected=${p.id() === value}>
            ${p.displayName()}${p === me
              ? ` (${translateText("admin_panel.you")})`
              : ""}
          </option>`,
      )}
    </select>`;
  }

  private button(label: string, onClick: () => void, danger = false) {
    return html`<button
      class="px-2 py-1 rounded text-sm font-semibold ${danger
        ? "bg-red-700 hover:bg-red-600"
        : "bg-indigo-700 hover:bg-indigo-600"}"
      @click=${onClick}
    >
      ${label}
    </button>`;
  }

  private numberInput(
    label: string,
    value: number,
    onChange: (n: number) => void,
  ) {
    return html`<label class="flex items-center justify-between gap-2 text-sm">
      <span>${label}</span>
      <input
        type="number"
        min="0"
        class="w-28 bg-gray-800 border border-white/20 rounded px-1 text-right"
        .value=${String(value)}
        @input=${(e: Event) =>
          onChange(Math.max(0, Number((e.target as HTMLInputElement).value)))}
      />
    </label>`;
  }

  private sendResources(sign: 1 | -1) {
    if (this.target === "") return;
    const a = this.amounts;
    this.send({
      kind: "resources",
      target: this.target,
      gold: sign * a.gold,
      troops: sign * a.troops * TROOP_SCALE,
      goods: [sign * a.food, sign * a.oil, sign * a.metal],
    });
  }

  private renderResources() {
    const a = this.amounts;
    const set = (k: keyof typeof a) => (n: number) => {
      this.amounts = { ...a, [k]: n };
    };
    return html`
      ${this.playerSelect(
        this.target,
        (id) => (this.target = id),
        this.players(),
      )}
      ${this.numberInput(
        translateText("admin_panel.gold"),
        a.gold,
        set("gold"),
      )}
      ${this.numberInput(
        translateText("admin_panel.troops"),
        a.troops,
        set("troops"),
      )}
      ${this.numberInput(translateText("goods.food"), a.food, set("food"))}
      ${this.numberInput(translateText("goods.oil"), a.oil, set("oil"))}
      ${this.numberInput(translateText("goods.metal"), a.metal, set("metal"))}
      <div class="flex gap-2">
        ${this.button(translateText("admin_panel.give"), () =>
          this.sendResources(1),
        )}
        ${this.button(
          translateText("admin_panel.take"),
          () => this.sendResources(-1),
          true,
        )}
      </div>
      <label class="flex items-center gap-2 text-sm mt-2">
        <input
          type="checkbox"
          .checked=${this.god}
          @change=${(e: Event) => {
            this.god = (e.target as HTMLInputElement).checked;
            this.send({ kind: "god", enabled: this.god });
          }}
        />
        ${translateText("admin_panel.god_mode")}
      </label>
    `;
  }

  private toolButton(tool: Tool) {
    const armed = this.tool === tool;
    return html`<button
      class="px-2 py-1 rounded text-sm ${armed
        ? "bg-amber-600"
        : "bg-gray-700 hover:bg-gray-600"}"
      @click=${() => this.setTool(armed ? null : tool)}
    >
      ${translateText(`admin_panel.tool_${tool}`)}
    </button>`;
  }

  private renderMap() {
    return html`
      <div class="flex flex-wrap gap-1">
        ${(["paint", "smite", "disaster", "spawn", "revive"] as const).map(
          (t) => this.toolButton(t),
        )}
      </div>
      <div class="text-xs text-gray-400">
        ${this.tool === null
          ? translateText("admin_panel.pick_tool")
          : translateText("admin_panel.click_map")}
      </div>
      ${this.tool === "paint"
        ? html`${this.playerSelect(
              this.paintOwner,
              (id) => (this.paintOwner = id),
              this.players(),
              translateText("admin_panel.neutral"),
            )}
            <label class="flex items-center gap-2 text-sm">
              ${translateText("admin_panel.brush")}
              <input
                type="range"
                min="1"
                max=${MAX_ADMIN_BRUSH}
                .value=${String(this.brush)}
                @input=${(e: Event) =>
                  (this.brush = Number((e.target as HTMLInputElement).value))}
              />
              ${this.brush}
            </label>`
        : null}
      ${this.tool === "smite"
        ? html`<div class="flex gap-1">
            ${([UnitType.AtomBomb, UnitType.HydrogenBomb] as const).map(
              (n) =>
                html`<button
                  class="px-2 py-1 rounded text-sm ${this.nuke === n
                    ? "bg-red-700"
                    : "bg-gray-700"}"
                  @click=${() => (this.nuke = n)}
                >
                  ${translateText(
                    n === UnitType.AtomBomb
                      ? "unit_type.atom_bomb"
                      : "unit_type.hydrogen_bomb",
                  )}
                </button>`,
            )}
          </div>`
        : null}
      ${this.tool === "disaster"
        ? html`<select
            class="w-full bg-gray-800 border border-white/20 rounded px-1 py-0.5 text-sm"
            @change=${(e: Event) =>
              (this.disasterKind = (e.target as HTMLSelectElement)
                .value as DisasterKind)}
          >
            ${DISASTER_CHOICES.map(
              (k) =>
                html`<option value=${k} ?selected=${k === this.disasterKind}>
                  ${translateText(`admin_panel.disaster_${k}`)}
                </option>`,
            )}
          </select>`
        : null}
      ${this.tool === "spawn"
        ? html`<select
              class="w-full bg-gray-800 border border-white/20 rounded px-1 py-0.5 text-sm"
              @change=${(e: Event) =>
                (this.spawnUnit = (e.target as HTMLSelectElement)
                  .value as (typeof SPAWNABLE)[number])}
            >
              ${SPAWNABLE.map(
                (u) =>
                  html`<option value=${u} ?selected=${u === this.spawnUnit}>
                    ${translateText(
                      `unit_type.${u.toLowerCase().replace(/ /g, "_")}`,
                    )}
                  </option>`,
              )}
            </select>
            ${this.playerSelect(
              this.spawnOwner,
              (id) => (this.spawnOwner = id),
              this.players(),
            )}
            <label class="flex items-center gap-2 text-sm">
              ${translateText("admin_panel.level")}
              <input
                type="range"
                min="1"
                max="20"
                .value=${String(this.spawnLevel)}
                @input=${(e: Event) =>
                  (this.spawnLevel = Number(
                    (e.target as HTMLInputElement).value,
                  ))}
              />
              ${this.spawnLevel}
            </label>`
        : null}
      ${this.tool === "revive"
        ? this.playerSelect(
            this.reviveTarget,
            (id) => (this.reviveTarget = id),
            this.players((p) => !p.isAlive()),
          )
        : null}
    `;
  }

  private renderControl() {
    const nations = this.players(
      (p) => p.isAlive() && p.type() !== PlayerType.Human,
    );
    const alive = this.players();
    return html`
      <h4 class="font-bold text-sm">${translateText("admin_panel.puppet")}</h4>
      ${this.playerSelect(this.puppet, (id) => (this.puppet = id), nations)}
      ${this.playerSelect(
        this.puppetTarget,
        (id) => (this.puppetTarget = id),
        alive,
      )}
      ${this.button(translateText("admin_panel.attack"), () => {
        if (this.puppet !== "" && this.puppetTarget !== "") {
          this.send({
            kind: "puppet",
            nation: this.puppet,
            target: this.puppetTarget,
          });
        }
      })}

      <h4 class="font-bold text-sm mt-2">
        ${translateText("admin_panel.diplomacy")}
      </h4>
      ${this.playerSelect(this.dipA, (id) => (this.dipA = id), alive)}
      ${this.playerSelect(this.dipB, (id) => (this.dipB = id), alive)}
      <div class="flex flex-wrap gap-1">
        ${DIPLOMACY_OPS.map((op) =>
          this.button(translateText(`admin_panel.op_${op}`), () => {
            if (this.dipA !== "" && this.dipB !== "") {
              this.send({ kind: "diplomacy", a: this.dipA, b: this.dipB, op });
            }
          }),
        )}
      </div>

      <h4 class="font-bold text-sm mt-2">
        ${translateText("admin_panel.doom")}
      </h4>
      ${this.playerSelect(this.victim, (id) => (this.victim = id), alive)}
      <div class="flex flex-wrap gap-1">
        ${this.button(
          translateText("admin_panel.eliminate"),
          () => {
            if (this.victim !== "") {
              this.send({ kind: "eliminate", target: this.victim });
            }
          },
          true,
        )}
        ${this.button(
          translateText("admin_panel.zombies"),
          () => {
            if (this.victim !== "") {
              this.send({ kind: "zombies", target: this.victim });
            }
          },
          true,
        )}
      </div>
    `;
  }

  private renderIntel() {
    const rows = this.players().sort(
      (a, b) => b.numTilesOwned() - a.numTilesOwned(),
    );
    return html`<table class="w-full text-xs">
      <thead class="text-gray-400">
        <tr>
          <th class="text-left">${translateText("admin_panel.player")}</th>
          <th>${translateText("admin_panel.troops")}</th>
          <th>${translateText("admin_panel.gold")}</th>
          <th>${translateText("admin_panel.goods_short")}</th>
          <th class="text-left">${translateText("admin_panel.attacking")}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((p) => {
          const goods = p.goods();
          const targets = p
            .outgoingAttacks()
            .map((a) => {
              const t = this.game.playerBySmallID(a.targetID);
              return t.isPlayer()
                ? (t as PlayerView).displayName()
                : translateText("admin_panel.neutral");
            })
            .join(", ");
          return html`<tr class="border-t border-white/10">
            <td class="truncate max-w-24">${p.displayName()}</td>
            <td class="text-right">${renderTroops(p.troops())}</td>
            <td class="text-right">${renderNumber(p.gold())}</td>
            <td class="text-right">
              ${Math.floor(goods[Good.Food])}/${Math.floor(
                goods[Good.Oil],
              )}/${Math.floor(goods[Good.Metal])}
            </td>
            <td class="truncate max-w-24">${targets}</td>
          </tr>`;
        })}
      </tbody>
    </table>`;
  }

  render() {
    if (!this.open) return null;
    return html`<div
      class="fixed top-16 right-2 z-[1001] w-80 max-h-[80vh] overflow-y-auto
             bg-gray-900/95 border border-amber-500/60 rounded-lg p-3 text-white
             flex flex-col gap-2 shadow-xl"
      @contextmenu=${(e: MouseEvent) => e.preventDefault()}
    >
      <div class="flex items-center justify-between">
        <h3 class="font-bold text-amber-400">
          ${translateText("admin_panel.title")}
        </h3>
        <button class="text-gray-400" @click=${() => (this.open = false)}>
          ✕
        </button>
      </div>
      ${this.key === null
        ? html`<label class="text-sm"
              >${translateText("admin_panel.enter_key")}</label
            >
            <input
              type="password"
              class="bg-gray-800 border border-white/20 rounded px-1"
              .value=${this.keyDraft}
              @input=${(e: Event) =>
                (this.keyDraft = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") this.saveKey();
              }}
            />
            ${this.button(translateText("admin_panel.unlock"), () =>
              this.saveKey(),
            )}`
        : html`<div class="flex gap-1">
              ${(["resources", "map", "control", "intel"] as const).map(
                (t) =>
                  html`<button
                    class="flex-1 px-1 py-1 rounded text-xs ${this.tab === t
                      ? "bg-amber-600"
                      : "bg-gray-700"}"
                    @click=${() => (this.tab = t)}
                  >
                    ${translateText(`admin_panel.tab_${t}`)}
                  </button>`,
              )}
            </div>
            ${this.tab === "resources" ? this.renderResources() : null}
            ${this.tab === "map" ? this.renderMap() : null}
            ${this.tab === "control" ? this.renderControl() : null}
            ${this.tab === "intel" ? this.renderIntel() : null}
            <button
              class="text-xs text-gray-500 self-end"
              @click=${() => this.forgetKey()}
            >
              ${translateText("admin_panel.forget_key")}
            </button>`}
    </div>`;
  }
}
