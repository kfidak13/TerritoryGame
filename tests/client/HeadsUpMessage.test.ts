import { MessageType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeadsUpMessage } from "../../src/client/hud/layers/HeadsUpMessage";

function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  x: number,
  y: number,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: y,
  });
  target.dispatchEvent(event);
}

describe("HeadsUpMessage toast gestures", () => {
  let element: HeadsUpMessage;

  beforeEach(async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
    });
    if (!customElements.get("heads-up-message")) {
      customElements.define("heads-up-message", HeadsUpMessage);
    }
    element = document.createElement("heads-up-message") as HeadsUpMessage;
    document.body.appendChild(element);
    await element.updateComplete;
  });

  afterEach(() => {
    element.remove();
    vi.unstubAllGlobals();
  });

  async function showToast(): Promise<HTMLElement> {
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: "Connection failed",
          color: "red",
          duration: 60_000,
        },
      }),
    );
    await element.updateComplete;
    const toast = element.querySelector<HTMLElement>("[data-game-toast]");
    expect(toast).not.toBeNull();
    Object.defineProperty(toast, "setPointerCapture", { value: () => {} });
    return toast!;
  }

  it("follows a drag and snaps back below the dismissal threshold", async () => {
    const toast = await showToast();

    dispatchPointer(toast, "pointerdown", 10, 10);
    dispatchPointer(toast, "pointermove", 50, 30);
    await element.updateComplete;
    expect(
      element.querySelector<HTMLElement>("[data-game-toast-content]")?.style
        .transform,
    ).toBe("translate3d(40px, 20px, 0)");

    dispatchPointer(toast, "pointerup", 50, 30);
    await element.updateComplete;
    expect(element.querySelector("[data-game-toast]")).not.toBeNull();
    expect(
      element.querySelector<HTMLElement>("[data-game-toast-content]")?.style
        .transform,
    ).toBe("translate3d(0px, 0px, 0)");
  });

  it("dismisses the toast after dragging past the threshold", async () => {
    const toast = await showToast();

    dispatchPointer(toast, "pointerdown", 0, 0);
    dispatchPointer(toast, "pointermove", 80, 0);
    dispatchPointer(toast, "pointerup", 80, 0);
    await element.updateComplete;

    expect(element.querySelector("[data-game-toast]")).toBeNull();
  });

  it("uses the final pointer position when no move event arrives", async () => {
    const toast = await showToast();

    dispatchPointer(toast, "pointerdown", 0, 0);
    dispatchPointer(toast, "pointerup", 80, 0);
    await element.updateComplete;

    expect(element.querySelector("[data-game-toast]")).toBeNull();
  });

  it("restores the toast when the pointer gesture is cancelled", async () => {
    const toast = await showToast();

    dispatchPointer(toast, "pointerdown", 0, 0);
    dispatchPointer(toast, "pointermove", 100, 20);
    dispatchPointer(toast, "pointercancel", 100, 20);
    await element.updateComplete;

    expect(element.querySelector("[data-game-toast]")).not.toBeNull();
    expect(
      element.querySelector<HTMLElement>("[data-game-toast-content]")?.style
        .transform,
    ).toBe("translate3d(0px, 0px, 0)");
  });
});

describe("HeadsUpMessage disaster banner", () => {
  let element: HeadsUpMessage;

  beforeEach(async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
    });
    if (!customElements.get("heads-up-message")) {
      customElements.define("heads-up-message", HeadsUpMessage);
    }
    element = document.createElement("heads-up-message") as HeadsUpMessage;
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
    vi.unstubAllGlobals();
  });

  function tickWith(playerID: number) {
    element.game = {
      updatesSinceLastTick: () => ({
        [GameUpdateType.DisplayEvent]: [
          {
            type: GameUpdateType.DisplayEvent,
            message: "events_display.disaster_earthquake",
            messageType: MessageType.DISASTER,
            playerID,
            params: { troops: "1.2K", buildings: 2 },
          },
        ],
      }),
      myPlayer: () => ({ smallID: () => 7 }),
      ticks: () => 5000,
      inSpawnPhase: () => false,
      isSpawnImmunityActive: () => false,
      isCatchingUp: () => false,
      elapsedGameSeconds: () => 500,
      config: () => ({
        numSpawnPhaseTurns: () => 100,
        hasExtendedSpawnImmunity: () => false,
        isReplay: () => false,
        overtimeConfig: () => ({ enabled: false, startMinutes: 20 }),
      }),
    } as any;
    element.tick();
    return element.updateComplete;
  }

  it("shouts the disaster at the player it hit", async () => {
    await tickWith(7);
    const banner = element.querySelector("[role=alert]");
    expect(banner?.textContent).toContain("disaster_banner.earthquake");
  });

  it("stays quiet for everyone else", async () => {
    await tickWith(8);
    expect(element.querySelector("[role=alert]")).toBeNull();
  });
});
