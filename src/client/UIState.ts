import { PlayerBuildableUnitType } from "@openfront/engine-api/game/GameTypes";

export interface UIState {
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  rocketDirectionUp: boolean;
  upgradeMultiplier: number;
  /** Borderfall: map clicks paint trade land instead of attacking. */
  tradePainting?: boolean;
}
