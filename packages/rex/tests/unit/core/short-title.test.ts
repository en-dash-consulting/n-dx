import { describe, it, expect } from "vitest";
import {
  assertShortTitleAvailable,
  findNameCollision,
  holdsName,
  shownName,
  ShortTitleCollisionError,
  type NamedItem,
} from "../../../src/core/short-title.js";

const item = (id: string, title: string, status: string, extra: Partial<NamedItem> = {}): NamedItem => ({ id, title, status, ...extra });

describe("shownName", () => {
  it("is the short title when there is one, trimmed", () => {
    expect(shownName({ title: "Add Apple Pay to the checkout page", shortTitle: "  Apple Pay " })).toBe("Apple Pay");
  });

  it("falls back to the title when the short title is absent, blank or not a string", () => {
    expect(shownName({ title: "Add Apple Pay" })).toBe("Add Apple Pay");
    expect(shownName({ title: "Add Apple Pay", shortTitle: "   " })).toBe("Add Apple Pay");
    expect(shownName({ title: "Add Apple Pay", shortTitle: 3 })).toBe("Add Apple Pay");
  });
});

describe("holdsName", () => {
  it("holds for pending, in_progress, blocked and deferred, and a missing status", () => {
    for (const s of ["pending", "in_progress", "blocked", "deferred", undefined]) expect(holdsName(s)).toBe(true);
  });

  it("does not hold for completed or any other closed status", () => {
    for (const s of ["completed", "cancelled", "deleted", "failing"]) expect(holdsName(s)).toBe(false);
  });
});

describe("findNameCollision", () => {
  const items: NamedItem[] = [
    item("a", "Add Apple Pay to checkout", "in_progress", {
      shortTitle: "Apple Pay",
      children: [item("a1", "Wire the button", "pending")],
    }),
    item("b", "Refunds", "completed"),
    item("c", "Gift cards", "deferred"),
  ];

  it("matches an open item's short title, ignoring case and extra whitespace", () => {
    expect(findNameCollision(items, " apple   PAY ")?.id).toBe("a");
  });

  it("matches an open item's title when it has no short title, nested ones included", () => {
    expect(findNameCollision(items, "Gift cards")?.id).toBe("c");
    expect(findNameCollision(items, "wire the button")?.id).toBe("a1");
  });

  it("does not match the full title of an item whose shown name is its short title", () => {
    expect(findNameCollision(items, "Add Apple Pay to checkout")).toBeUndefined();
  });

  it("exempts completed items", () => {
    expect(findNameCollision(items, "Refunds")).toBeUndefined();
  });

  it("skips the item itself", () => {
    expect(findNameCollision(items, "Apple Pay", "a")).toBeUndefined();
  });
});

describe("assertShortTitleAvailable", () => {
  const items: NamedItem[] = [
    item("a", "Add Apple Pay to checkout", "blocked", { shortTitle: "Apple Pay", displayId: "CH-1", type: "change" }),
    item("b", "Refunds", "completed"),
  ];

  it("refuses a short title an open item shows, naming that item", () => {
    let error: unknown;
    try {
      assertShortTitleAvailable(items, "Apple Pay", { id: "x" });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ShortTitleCollisionError);
    expect((error as ShortTitleCollisionError).collidingId).toBe("a");
    expect((error as Error).message).toContain("Apple Pay");
    expect((error as Error).message).toContain("Add Apple Pay to checkout");
    expect((error as Error).message).toContain("CH-1");
    expect((error as Error).message).toContain("change");
  });

  it("accepts a short title only completed items show", () => {
    expect(() => assertShortTitleAvailable(items, "Refunds", { id: "x" })).not.toThrow();
  });

  it("accepts a blank short title, which clears it", () => {
    expect(() => assertShortTitleAvailable(items, "  ", { id: "x" })).not.toThrow();
    expect(() => assertShortTitleAvailable(items, undefined)).not.toThrow();
  });

  it("accepts the item keeping its own name", () => {
    expect(() => assertShortTitleAvailable(items, "Apple Pay", { id: "a" })).not.toThrow();
  });

  it("does not hold a completed item's own short title against open items", () => {
    expect(() => assertShortTitleAvailable(items, "Apple Pay", { id: "b", status: "completed" })).not.toThrow();
  });
});
