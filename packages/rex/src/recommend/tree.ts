import type { RecommendationTreeItem } from "./types.js";

export function* walkRecommendationTree(
  items: readonly RecommendationTreeItem[],
): Generator<RecommendationTreeItem> {
  for (const item of items) {
    yield item;
    if (item.children && item.children.length > 0) {
      yield* walkRecommendationTree(item.children);
    }
  }
}
