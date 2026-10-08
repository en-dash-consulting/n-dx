import { describe, it, expect } from "vitest";
import { planCodeOwners, CODE_OWNER_FILES } from "../../../src/codeowners/plan.js";
import type { RuleNode } from "../../../src/schema/v2-rules.js";

function capability(slug: string): RuleNode {
  return { id: slug, type: "capability", title: slug, slug, status: "pending" } as unknown as RuleNode;
}

/** An area with children, so stored as a folder. Pass `[]` for a leaf area (`<slug>.md`). */
function area(slug: string, extra: Record<string, unknown> = {}, children: RuleNode[] = [capability(slug + "-cap")]): RuleNode {
  return { id: slug, type: "area", title: slug, slug, status: "pending", children, ...extra } as unknown as RuleNode;
}

const productDir = ".rex/product";
const github = (p: ReturnType<typeof planCodeOwners>) => p.files.find((f) => f.host === "github")!.content;
const bitbucket = (p: ReturnType<typeof planCodeOwners>) => p.files.find((f) => f.host === "bitbucket")!.content;
const rules = (content: string) => content.split("\n").filter((l) => l && !l.startsWith("#"));

describe("planCodeOwners", () => {
  it("writes both files from one stewards list, at each host's path", () => {
    const plan = planCodeOwners({
      defaultStewards: ["ann@example.com"],
      product: [area("checkout"), area("search")],
      productDir,
    });
    expect(plan.files.map((f) => f.path)).toEqual([CODE_OWNER_FILES.github, CODE_OWNER_FILES.bitbucket]);
    const expected = ["/.rex/product/checkout/ ann@example.com", "/.rex/product/search/ ann@example.com"];
    expect(rules(github(plan))).toEqual(expected);
    expect(rules(bitbucket(plan))).toEqual(expected);
    expect(plan.warnings).toEqual([]);
  });

  it("lets an area's own stewards replace the default for its folder", () => {
    const plan = planCodeOwners({
      defaultStewards: ["ann@example.com"],
      product: [area("checkout", { stewards: ["bob@example.com"] }), area("search")],
      productDir,
    });
    expect(rules(github(plan))).toEqual([
      "/.rex/product/checkout/ bob@example.com",
      "/.rex/product/search/ ann@example.com",
    ]);
  });

  it("keeps @handles in the GitHub file only and warns once per omitted handle", () => {
    const plan = planCodeOwners({
      defaultStewards: ["ann@example.com", "@shop/core"],
      product: [area("checkout"), area("search")],
      productDir,
    });
    expect(rules(github(plan))[0]).toBe("/.rex/product/checkout/ ann@example.com @shop/core");
    expect(bitbucket(plan)).not.toContain("@shop/core");
    expect(rules(bitbucket(plan))[0]).toBe("/.rex/product/checkout/ ann@example.com");
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain("@shop/core");
    expect(plan.warnings[0]).toContain(".bitbucket/CODEOWNERS");
  });

  it("writes no rule for an area whose only stewards are handles in the Bitbucket file", () => {
    const plan = planCodeOwners({ defaultStewards: ["@shop/core"], product: [area("checkout")], productDir });
    expect(rules(github(plan))).toEqual(["/.rex/product/checkout/ @shop/core"]);
    expect(rules(bitbucket(plan))).toEqual([]);
  });

  it("matches only area folders: nothing for the root header, state files or the change layer", () => {
    const plan = planCodeOwners({ defaultStewards: ["ann@example.com"], product: [area("checkout")], productDir });
    for (const file of plan.files) {
      for (const line of rules(file.content)) {
        const path = line.split(" ")[0];
        expect(path).toBe("/.rex/product/checkout/");
        expect(path.startsWith("/.rex/changes")).toBe(false);
        expect(".rex/product/index.md".startsWith(path.slice(1))).toBe(false);
      }
    }
  });

  it("writes nothing without stewards, and skips deleted areas and non-area nodes", () => {
    const none = planCodeOwners({ product: [area("checkout")], productDir });
    expect(rules(github(none))).toEqual([]);

    const plan = planCodeOwners({
      defaultStewards: ["ann@example.com"],
      product: [area("gone", { status: "deleted" }), { ...area("cap"), type: "capability" } as RuleNode],
      productDir,
    });
    expect(rules(github(plan))).toEqual([]);
  });

  it("writes parents before nested areas, and an ownerless rule only where it cancels an enclosing one", () => {
    const plan = planCodeOwners({
      defaultStewards: ["ann@example.com"],
      product: [area("a", {}, [area("b", { stewards: [] }), area("c", { stewards: ["cy@example.com"] })])],
      productDir,
    });
    expect(rules(github(plan))).toEqual([
      "/.rex/product/a/ ann@example.com",
      "/.rex/product/a/b/",
      "/.rex/product/a/c/ cy@example.com",
    ]);
  });

  it("matches a childless area's own file, since it is stored as <slug>.md rather than a folder", () => {
    const plan = planCodeOwners({
      defaultStewards: ["ann@example.com"],
      product: [area("a", {}, [area("leaf", { stewards: [] }, [])]), area("solo", {}, [])],
      productDir,
    });
    expect(rules(github(plan))).toEqual([
      "/.rex/product/a/ ann@example.com",
      "/.rex/product/a/leaf.md",
      "/.rex/product/solo.md ann@example.com",
    ]);
  });

  it("warns about, and drops, an entry that is neither an email nor a handle", () => {
    const plan = planCodeOwners({ defaultStewards: ["ann", "ann@example.com"], product: [area("a")], productDir });
    expect(rules(github(plan))).toEqual(["/.rex/product/a/ ann@example.com"]);
    expect(plan.warnings.some((w) => w.includes('"ann"'))).toBe(true);
  });
});
