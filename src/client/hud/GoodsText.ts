import { GOODS, GoodsAmounts } from "@openfront/engine-api/game/GameTypes";
import { translateText } from "../Utils";

// Borderfall goods, indexed by Good.
export const GOOD_ICONS = ["🌾", "🛢️", "⚙️"];
const GOOD_NAMES = ["goods.food", "goods.oil", "goods.metal"];

/** The goods a build takes, e.g. "🛢️ 40". */
export function goodsCostText(cost: Readonly<GoodsAmounts>): string {
  return GOODS.filter((g) => cost[g] > 0)
    .map((g) => `${GOOD_ICONS[g]} ${cost[g]}`)
    .join(" ");
}

/** Why a build is blocked on goods, e.g. "Not enough Oil". */
export function goodsShortText(
  cost: Readonly<GoodsAmounts>,
  stock: Readonly<GoodsAmounts>,
): string {
  const short = GOODS.filter((g) => stock[g] < cost[g]).map((g) =>
    translateText(GOOD_NAMES[g]),
  );
  return translateText("build_menu.not_enough_goods", {
    goods: short.join(", "),
  });
}
