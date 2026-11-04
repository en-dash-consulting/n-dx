import { describe, expect, it } from "vitest";
import { resolveToolPolicies, type PolicyTool } from "../../../../src/server/connections/tool-policy.js";

const tools: PolicyTool[] = [
  { name: "look", annotations: { readOnlyHint: true } },
  { name: "wipe", annotations: { destructiveHint: true } },
  { name: "poke" },
  { name: "both", annotations: { readOnlyHint: true, destructiveHint: true } },
];

function resolve(overrides?: unknown) {
  const warnings: string[] = [];
  const policies = resolveToolPolicies(tools, overrides, (message) => warnings.push(message));
  return { policies, warnings };
}

describe("tool class", () => {
  it("classifies readOnlyHint true as read, from the annotation", () => {
    expect(resolve().policies.get("look")).toMatchObject({ class: "read", classSource: "annotation" });
    expect(resolve().policies.get("both")).toMatchObject({ class: "read" });
  });

  it("classifies destructiveHint true as write, from the annotation", () => {
    expect(resolve().policies.get("wipe")).toMatchObject({ class: "write", classSource: "annotation" });
  });

  it("classifies an unannotated tool as write, by default", () => {
    expect(resolve().policies.get("poke")).toMatchObject({ class: "write", classSource: "default" });
  });

  it("lets an operator class override win and reports it as an override", () => {
    const { policies } = resolve({ look: { class: "write" }, poke: { class: "read" } });
    expect(policies.get("look")).toMatchObject({ class: "write", classSource: "override" });
    expect(policies.get("poke")).toMatchObject({ class: "read", classSource: "override", policy: "run" });
  });
});

describe("tool policy", () => {
  it("defaults read to run and write to ask", () => {
    const { policies } = resolve();
    expect(policies.get("look")).toMatchObject({ policy: "run", policySource: "default" });
    expect(policies.get("wipe")).toMatchObject({ policy: "ask", policySource: "default" });
    expect(policies.get("poke")).toMatchObject({ policy: "ask", policySource: "default" });
  });

  it.each(["run", "ask", "never"] as const)("honours a %s override, including run on a write", (policy) => {
    expect(resolve({ wipe: { policy } }).policies.get("wipe")).toMatchObject({ class: "write", policy, policySource: "override" });
    expect(resolve({ look: { policy } }).policies.get("look")).toMatchObject({ policy, policySource: "override" });
  });

  it("derives the default policy from an overridden class", () => {
    expect(resolve({ look: { class: "write" } }).policies.get("look")).toMatchObject({ policy: "ask", policySource: "default" });
  });
});

describe("invalid overrides", () => {
  it("ignores an unknown class or policy with a warning naming the tool", () => {
    const { policies, warnings } = resolve({ look: { class: "admin", policy: "sometimes" }, wipe: { policy: "never" } });
    expect(policies.get("look")).toMatchObject({ class: "read", classSource: "annotation", policy: "run", policySource: "default" });
    expect(policies.get("wipe")).toMatchObject({ policy: "never" });
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.includes('"look"'))).toBe(true);
  });

  it("ignores a tool the server does not list with a warning naming it", () => {
    const { policies, warnings } = resolve({ ghost: { policy: "run" } });
    expect(policies.has("ghost")).toBe(false);
    expect(warnings).toEqual([expect.stringContaining('"ghost"')]);
  });

  it("keeps a valid half of an entry when the other half is invalid", () => {
    const { policies, warnings } = resolve({ wipe: { class: "bogus", policy: "run" } });
    expect(policies.get("wipe")).toMatchObject({ class: "write", classSource: "annotation", policy: "run" });
    expect(warnings).toHaveLength(1);
  });

  it.each([[null], [[]], ["x"], [5]])("does not crash on malformed overrides %j", (overrides) => {
    const { policies, warnings } = resolve(overrides);
    expect(policies.size).toBe(tools.length);
    expect(warnings).toHaveLength(1);
  });

  it("does not crash on a malformed entry", () => {
    const { policies, warnings } = resolve({ look: "never", wipe: null });
    expect(policies.get("look")).toMatchObject({ policy: "run" });
    expect(warnings).toHaveLength(2);
  });
});
