/**
 * Task-class registry contract test.
 *
 * Call sites declare task classes (never models); `DEFAULT_ROUTES` in
 * `@n-dx/llm-client` is the registry that maps classes to tiers. This test
 * walks every package's source for declared task classes and asserts:
 *
 * 1. Every class a call site declares exists in `DEFAULT_ROUTES` — a typo'd
 *    or unregistered class would silently resolve to the standard tier.
 * 2. The choke-point migrations hold: the classes each package is expected
 *    to declare are actually declared, so a refactor that quietly drops a
 *    `taskClass` (reverting the call to an unroutable bare tier) fails here.
 *
 * @see packages/llm-client/src/config.ts — DEFAULT_ROUTES / resolveTaskModel
 * @see docs/analysis/llm-cost-optimization-plan.md — the routing design
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Foundation tier: the routing registry (dist import, like the other
// cross-tier contract tests — run `pnpm build` if this import fails).
import { DEFAULT_ROUTES } from "../../packages/llm-client/dist/public.js";

const PACKAGES = ["rex", "sourcevision", "hench"];
const ROOT = join(import.meta.dirname, "../..");

/** Recursively collect .ts sources under a directory. */
function collectSources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSources(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Extract declared task classes: `taskClass: "x"` and `resolveTaskModel("x"`. */
function declaredClasses(source) {
  const classes = [];
  for (const match of source.matchAll(/taskClass:\s*["']([^"']+)["']/g)) {
    classes.push(match[1]);
  }
  for (const match of source.matchAll(/resolveTaskModel\(\s*["']([^"']+)["']/g)) {
    classes.push(match[1]);
  }
  return classes;
}

function scanPackage(pkg) {
  const found = new Map(); // class -> first file seen
  for (const file of collectSources(join(ROOT, "packages", pkg, "src"))) {
    for (const cls of declaredClasses(readFileSync(file, "utf-8"))) {
      if (!found.has(cls)) found.set(cls, file);
    }
  }
  return found;
}

describe("task-class registry contract", () => {
  const byPackage = new Map(PACKAGES.map((pkg) => [pkg, scanPackage(pkg)]));

  it("every declared task class is registered in DEFAULT_ROUTES", () => {
    for (const [pkg, classes] of byPackage) {
      for (const [cls, file] of classes) {
        expect(
          DEFAULT_ROUTES[cls],
          `${pkg}: "${cls}" (declared in ${file}) is not in DEFAULT_ROUTES`,
        ).toBeDefined();
      }
    }
  });

  it("rex declares its routed classes", () => {
    const classes = byPackage.get("rex");
    for (const cls of [
      "prd.rename",
      "prd.merge",
      "prd.assess",
      "prd.consolidate-check",
      "prd.clarify",
      "prd.spec",
      "prd.propose",
      "prd.modify",
      "prd.restructure",
      "prd.smart-add",
    ]) {
      expect(classes.has(cls), `rex no longer declares ${cls}`).toBe(true);
    }
  });

  it("sourcevision declares its routed classes", () => {
    const classes = byPackage.get("sourcevision");
    for (const cls of [
      "zone.enrich-scan",
      "zone.enrich-deep",
      "zone.meta-eval",
      "code.classify",
    ]) {
      expect(classes.has(cls), `sourcevision no longer declares ${cls}`).toBe(true);
    }
  });

  it("hench declares its routed classes", () => {
    const classes = byPackage.get("hench");
    for (const cls of ["agent.execute", "git.commit-message"]) {
      expect(classes.has(cls), `hench no longer declares ${cls}`).toBe(true);
    }
  });
});
