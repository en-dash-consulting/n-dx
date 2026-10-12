import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PRDItem } from "../../../../src/schema/v1.js";
import { CLIError } from "../../../../src/cli/errors.js";
import { FileStore } from "../../../../src/store/index.js";

const mocks = vi.hoisted(() => ({
  place: vi.fn(async () => null as string | null),
  draft: vi.fn(async () => ({ statement: "Caches pages for offline reading.", criteria: [] as { text: string }[] })),
  askJev: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../../../../src/analyze/place-reason.js", () => ({
  createTextPlacementModel: (model?: string) => ({ model: model ?? "text-model", place: mocks.place }),
}));
vi.mock("../../../../src/analyze/spec-draft-reason.js", () => ({
  createTextSpecModel: (model?: string) => ({ model: model ?? "text-model", draft: mocks.draft }),
}));
vi.mock("@n-dx/llm-client", async (importOriginal) => ({ ...(await importOriginal<object>()), askJev: mocks.askJev }));
vi.mock("../../../../src/cli/output.js", async (importOriginal) => ({ ...(await importOriginal<object>()), warn: mocks.warn, info: vi.fn(), result: vi.fn() }));

const { cmdMigrate } = await import("../../../../src/cli/commands/migrate.js");

const item = (id: string, level: PRDItem["level"], title: string, children: PRDItem[] = [], extra: Partial<PRDItem> = {}): PRDItem => ({
  id,
  level,
  title,
  status: "completed",
  children,
  ...extra,
});

const TREE: PRDItem[] = [
  item("e1", "epic", "Storage", [
    item("f1", "feature", "Offline cache", [item("t1", "task", "Write the cache")]),
    item("f2", "feature", "Sync conflicts", [item("t2", "task", "Resolve conflicts")], { status: "pending" }),
    item("f4", "feature", "Cache eviction", [item("t4", "task", "Evict entries", [], { status: "pending" })], { status: "pending" }),
  ]),
  item("e2", "epic", "Review findings", [item("f3", "feature", "Lock is never released", [item("t3", "task", "Release it")])], { source: "ndx-adversarial-review" }),
];

/** Every file under a directory with its bytes, for before/after comparison. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p.slice(dir.length)] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

describe("cmdMigrate --plan", () => {
  let repo: string;
  let spies: Array<ReturnType<typeof vi.spyOn>>;
  const planPath = () => join(repo, ".ndx-migration", "plan.json");
  const readPlan = () => JSON.parse(readFileSync(planPath(), "utf8"));
  const savedKey = process.env.TYPESAFE_API_KEY;

  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), "rex-migrate-")));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    mkdirSync(join(repo, ".rex"));
    writeFileSync(join(repo, ".rex", "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
    await new FileStore(join(repo, ".rex")).saveDocument({ schema: "rex/v1", title: "Shop", items: TREE });
    delete process.env.TYPESAFE_API_KEY;
    vi.clearAllMocks();
    spies = [vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    if (savedKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = savedKey;
    rmSync(repo, { recursive: true });
  });

  it("writes the plan to the default path, gitignored, and leaves .rex unchanged", async () => {
    const before = snapshot(join(repo, ".rex"));
    await cmdMigrate(repo, { plan: "true", "rules-only": "true" });

    expect(snapshot(join(repo, ".rex"))).toEqual(before);
    expect(readFileSync(join(repo, ".ndx-migration", ".gitignore"), "utf8")).toBe("*\n");
    const plan = readPlan();
    expect(plan.header).toMatchObject({ migration: "v1-to-v2", passes: [{ name: "rules" }] });
    // Every v1 item has an entry with its target.
    expect(Object.keys(plan.entries).sort()).toEqual(["e1", "e2", "f1", "f2", "f3", "f4", "t1", "t2", "t3", "t4"]);
    expect(plan.entries.f1.target).toBe("capability");
    expect(plan.summary.areas.map((a: { id: string }) => a.id)).toEqual(["e1"]);
  });

  it("writes an identical file when re-run on an unchanged tree", async () => {
    await cmdMigrate(repo, { plan: "true", "rules-only": "true" });
    const first = readFileSync(planPath(), "utf8");
    await cmdMigrate(repo, { plan: "true", "rules-only": "true" });
    expect(readFileSync(planPath(), "utf8")).toBe(first);
  });

  it("keeps the earlier cut time unless --cut-at is given", async () => {
    await cmdMigrate(repo, { plan: "true", "rules-only": "true", "cut-at": "2026-01-01T00:00:00.000Z" });
    await cmdMigrate(repo, { plan: "true", "rules-only": "true" });
    expect(readPlan().header.cutAt).toBe("2026-01-01T00:00:00.000Z");
    await cmdMigrate(repo, { plan: "true", "rules-only": "true", "cut-at": "2026-02-02T00:00:00.000Z" });
    expect(readPlan().header.cutAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("--out overrides the path; a path inside the rex directory is refused", async () => {
    const out = join(repo, "elsewhere", "p.json");
    await cmdMigrate(repo, { plan: "true", "rules-only": "true", out });
    expect(existsSync(out)).toBe(true);
    expect(existsSync(planPath())).toBe(false);

    const before = snapshot(join(repo, ".rex"));
    await expect(cmdMigrate(repo, { plan: "true", "rules-only": "true", out: join(repo, ".rex", "plan.json") })).rejects.toThrow(CLIError);
    expect(snapshot(join(repo, ".rex"))).toEqual(before);
  });

  it("does not overwrite a file that is not a migration plan", async () => {
    mkdirSync(join(repo, ".ndx-migration"));
    writeFileSync(planPath(), "{}\n");
    await expect(cmdMigrate(repo, { plan: "true", "rules-only": "true" })).rejects.toThrow(/not a migration plan/);
    expect(readFileSync(planPath(), "utf8")).toBe("{}\n");
  });

  it("needs --plan", async () => {
    await expect(cmdMigrate(repo, {})).rejects.toThrow(/--plan/);
  });

  describe("model passes", () => {
    it("defaults to text placement and spec drafting, and skips Jev with one warning when no key is set", async () => {
      await cmdMigrate(repo, { plan: "true" });
      expect(readPlan().header.passes).toEqual([{ name: "rules" }, { name: "text", model: "text-model" }]);
      expect(mocks.draft).toHaveBeenCalled();
      expect(mocks.askJev).not.toHaveBeenCalled();
      expect(mocks.warn).toHaveBeenCalledTimes(1);
      expect(String(mocks.warn.mock.calls[0]?.[0])).toMatch(/TYPESAFE_API_KEY/);
    });

    it("never places a change on the text model's pick alone: it stays held as a suggestion", async () => {
      // f4 "Cache eviction" shares one word with the capability f1 "Offline cache": too weak for
      // the rules to place, but a clear leader, so under autoAccept "agree" a text pick of f1 would place it.
      mocks.place.mockResolvedValue("f1");
      await cmdMigrate(repo, { plan: "true" });
      expect(mocks.place).toHaveBeenCalled();
      expect(readPlan().entries.f4).toMatchObject({ needsPlacement: true, modelPlacement: { accepted: null, text: { pick: "f1" } } });
      expect(readPlan().entries.f4.placement).toBeUndefined();
    });

    it("runs the Jev review pass when a TypeSafe key is set", async () => {
      process.env.TYPESAFE_API_KEY = "key";
      mocks.askJev.mockRejectedValue(new Error("not called with real answers"));
      await cmdMigrate(repo, { plan: "true" }).catch(() => undefined);
      expect(mocks.warn).not.toHaveBeenCalled();
      expect(readPlan().header.passes.map((p: { name: string }) => p.name)).toContain("jev");
    });

    it("--rules-only runs no model pass", async () => {
      process.env.TYPESAFE_API_KEY = "key";
      await cmdMigrate(repo, { plan: "true", "rules-only": "true" });
      expect(readPlan().header.passes).toEqual([{ name: "rules" }]);
      expect(mocks.place).not.toHaveBeenCalled();
      expect(mocks.draft).not.toHaveBeenCalled();
      expect(mocks.warn).not.toHaveBeenCalled();
    });

    it("reports an incomplete pass, naming it and its error, and fails after writing the plan", async () => {
      mocks.draft.mockRejectedValueOnce(new Error("rate limited"));
      await expect(cmdMigrate(repo, { plan: "true" })).rejects.toThrow(/text pass stopped \(rate limited\)/);
      expect(readPlan().header.passes).toContainEqual({ name: "text", model: "text-model", incomplete: { error: "rate limited" } });
    });
  });

  it("proposes no area for an epic filed by an adversarial review; its children are changes", async () => {
    await cmdMigrate(repo, { plan: "true", "rules-only": "true" });
    const plan = readPlan();
    expect(plan.summary.areas.some((a: { id: string }) => a.id === "e2")).toBe(false);
    expect(plan.entries.e2.target).toBe("release");
    expect(plan.entries.f3).toMatchObject({ target: "change", applied: true });
    expect(plan.entries.t3.target).toBe("task");
  });
});

describe("cmdMigrate --apply", () => {
  let repo: string;
  let spies: Array<ReturnType<typeof vi.spyOn>>;
  const rexDir = () => join(repo, ".rex");

  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), "rex-migrate-apply-")));
    mkdirSync(rexDir());
    writeFileSync(join(rexDir(), "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
    await new FileStore(rexDir()).saveDocument({ schema: "rex/v1", title: "Shop", items: TREE });
    vi.clearAllMocks();
    spies = [vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    rmSync(repo, { recursive: true });
  });

  it("applies the plan at the default path, then is a no-op on the v2 tree", async () => {
    await cmdMigrate(repo, { plan: "true", "rules-only": "true" });
    await cmdMigrate(repo, { apply: "true" });
    expect(existsSync(join(rexDir(), "product", "index.md"))).toBe(true);
    expect(existsSync(join(rexDir(), "prd_tree"))).toBe(false);

    const before = snapshot(rexDir());
    await cmdMigrate(repo, { apply: "true" });
    rmSync(join(repo, ".ndx-migration"), { recursive: true });
    await cmdMigrate(repo, { apply: "true" });
    expect(snapshot(rexDir())).toEqual(before);
  });

  it("reads the plan from --plan=<path>", async () => {
    const out = join(repo, "elsewhere.json");
    await cmdMigrate(repo, { plan: "true", "rules-only": "true", out });
    await cmdMigrate(repo, { apply: "true", plan: out });
    expect(existsSync(join(rexDir(), "product", "index.md"))).toBe(true);
  });

  it("needs a plan on a v1 tree, and writes nothing without one", async () => {
    const before = snapshot(rexDir());
    await expect(cmdMigrate(repo, { apply: "true" })).rejects.toThrow(/No migration plan/);
    expect(snapshot(rexDir())).toEqual(before);
  });
});
