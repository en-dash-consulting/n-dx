/**
 * Identity strings: one person, however their assignee was spelled.
 *
 * @see src/shared/people.ts
 */

import { describe, it, expect } from "vitest";
import { identityKey, parseIdentity } from "../../../src/shared/index.js";

describe("parseIdentity", () => {
  it.each([
    ["Ann Lee <ann@shop.io>", { name: "Ann Lee", email: "ann@shop.io" }],
    ["<ann@shop.io>", { email: "ann@shop.io" }],
    ["ann@shop.io", { email: "ann@shop.io" }],
    ["@shop/core", { name: "@shop/core" }],
    ["ann", { name: "ann" }],
    ["   ", {}],
  ])("reads %j", (value, expected) => {
    expect(parseIdentity(value)).toEqual(expected);
  });
});

describe("identityKey", () => {
  it("keys a person by email, ignoring case and the name", () => {
    expect(identityKey("Ann Lee <Ann@Shop.io>")).toBe("ann@shop.io");
    expect(identityKey("ann@shop.io")).toBe(identityKey("A. Lee <ANN@shop.io>"));
  });

  it("keys anything without an email by its trimmed, lowercased text", () => {
    expect(identityKey("  Ann ")).toBe("ann");
    expect(identityKey("@shop/core")).toBe("@shop/core");
  });
});
