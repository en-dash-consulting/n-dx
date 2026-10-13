import { describe, it, expect } from "vitest";
import { createdItemToast } from "../../../src/viewer/hooks/use-prd-actions.js";

describe("createdItemToast", () => {
  it("names the v2 type, which the v2 Quick Add answers instead of a level", () => {
    expect(createdItemToast({ type: "change", title: "Gift cards" })).toBe("Created change: Gift cards");
  });

  it("names the v1 level", () => {
    expect(createdItemToast({ level: "feature", title: "Checkout" })).toBe("Created feature: Checkout");
  });
});
