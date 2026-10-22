import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EventBus } from "@openfront/shared/EventBus";
import "../../src/client/hud/layers/ControlPanel";
import type { ControlPanel } from "../../src/client/hud/layers/ControlPanel";
import type { UIState } from "../../src/client/UIState";
import type { GameView } from "../../src/client/view";

// Borderfall goods readout: stockpile and net per-second change per good,
// flagged red while troops starve.
describe("control-panel goods", () => {
  let panel: ControlPanel;

  beforeEach(() => {
    document.body.innerHTML = "";
    panel = document.createElement("control-panel") as ControlPanel;
    panel.uiState = { attackRatio: 0 } as UIState;
    panel.eventBus = new EventBus();
    panel.game = {
      inSpawnPhase: () => false,
      myPlayer: () => null,
    } as unknown as GameView;
    document.body.appendChild(panel);
    panel.init();
    panel.setVisibile(true);
  });

  afterEach(() => panel.remove());

  const goodsRow = () =>
    panel.querySelector(".hidden.lg\\:block [aria-label]")?.parentElement;

  it("renders nothing when goods are off", async () => {
    await panel.updateComplete;
    expect(goodsRow()).toBeUndefined();
  });

  it("shows stock and per-second rates, red while starving", async () => {
    (panel as any)._goods = {
      stock: [0, 120.7, 45],
      rate: [-0.03, 0.05, 0.0004],
      starving: true,
    };
    await panel.updateComplete;

    const cells = goodsRow()!.children;
    expect(cells).toHaveLength(3);
    expect(cells[0].getAttribute("aria-label")).toBe(
      "control_panel.food_shortage",
    );
    expect(cells[0].className).toContain("border-red-500");
    expect(cells[0].textContent).toContain("-0.3/s");
    expect(cells[1].getAttribute("aria-label")).toBe("control_panel.oil");
    expect(cells[1].textContent).toContain("120");
    expect(cells[1].textContent).toContain("+0.5/s");
    expect(cells[2].textContent).toContain("0.0/s");
    expect(cells[2].textContent).not.toContain("+0.0");
  });
});
