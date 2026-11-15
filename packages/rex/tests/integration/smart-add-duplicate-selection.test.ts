/**
 * The interactive smart-add approval when the operator selects some proposals
 * by number (not `y`) and the selection carries a duplicate.
 *
 * smart-add-duplicate-outcomes.test.ts covers the accept-all path; this file
 * pins the selection path: the duplicate prompt's wording and order, what each
 * choice writes, and what happens to the proposals left unselected (saved for a
 * later `rex add --accept` unless the operator merged).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdInit } from "../../src/cli/commands/init.js";
import { cmdSmartAdd } from "../../src/cli/commands/smart-add.js";
import { resolveStore, resolveRexPaths } from "../../src/store/index.js";
import type { Proposal } from "../../src/analyze/index.js";
import type { PRDItem } from "../../src/schema/index.js";

const { prompts, promptAnswers, mockReasonFromDescriptions } = vi.hoisted(() => ({
  prompts: [] as string[],
  promptAnswers: [] as string[],
  mockReasonFromDescriptions: vi.fn(),
}));

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (prompt: string, cb: (answer: string) => void) => {
      prompts.push(prompt);
      cb(promptAnswers.shift() ?? "");
    },
    close: () => {},
  }),
}));

vi.mock("../../src/analyze/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/analyze/index.js")>(
    "../../src/analyze/index.js",
  );
  return {
    ...actual,
    reasonFromDescriptions: mockReasonFromDescriptions,
    validateProposalQuality: vi.fn(() => []),
    setLLMConfig: vi.fn(),
    setClaudeConfig: vi.fn(),
    getAuthMode: vi.fn(() => "api"),
    getLLMVendor: vi.fn(() => "claude"),
  };
});

const ACCEPT_PROMPT =
  "Accept proposals? (y=all / n=none / b#=break down / c#=consolidate / 1,2,...=select) ";
const DUPLICATE_PROMPT = "Duplicate action (c/m/p): ";
const PENDING_FILE = "pending-smart-proposals.json";

/** Proposal 1: its first task duplicates the seeded task. */
const duplicateProposal: Proposal = {
  epic: { title: "Security Hardening", source: "smart-add" },
  features: [
    {
      title: "OAuth Security",
      source: "smart-add",
      tasks: [
        {
          title: "Implement OAuth callback handler",
          source: "smart-add",
          sourceFile: "",
          description: "Implement callback handler with strict state validation.",
          acceptanceCriteria: ["Callback route exists", "State parameter is validated"],
          priority: "critical",
          tags: ["security"],
        },
        {
          title: "Rotate OAuth state secret monthly",
          source: "smart-add",
          sourceFile: "",
          description: "Set up key rotation job for OAuth state secret.",
          acceptanceCriteria: ["Rotation job runs monthly"],
          priority: "high",
          tags: ["security", "operations"],
        },
      ],
    },
  ],
};

/** Proposal 2: nothing in it resembles the seeded tree. */
const freshProposal: Proposal = {
  epic: { title: "Billing Statements", source: "smart-add" },
  features: [
    {
      title: "Monthly Invoices",
      source: "smart-add",
      tasks: [
        {
          title: "Render invoice PDF from ledger rows",
          source: "smart-add",
          sourceFile: "",
          description: "Produce a PDF invoice for each customer at month end.",
          acceptanceCriteria: ["One PDF per customer"],
          priority: "medium",
          tags: ["billing"],
        },
      ],
    },
  ],
};

function flatten(items: PRDItem[]): PRDItem[] {
  const out: PRDItem[] = [];
  for (const item of items) {
    out.push(item);
    if (item.children) out.push(...flatten(item.children));
  }
  return out;
}

async function seedExistingTree(dir: string): Promise<void> {
  const store = await resolveStore(resolveRexPaths(dir).rexDir);
  await store.addItem({ id: "epic-existing", title: "Identity Platform", level: "epic", status: "pending" });
  await store.addItem(
    { id: "feature-existing", title: "OAuth Core", level: "feature", status: "pending" },
    "epic-existing",
  );
  await store.addItem(
    {
      id: "task-existing",
      title: "Implement OAuth callback handler",
      level: "task",
      status: "pending",
      description: "Add callback route.",
      acceptanceCriteria: ["Callback route exists"],
      priority: "medium",
      tags: ["auth"],
    },
    "feature-existing",
  );
}

describe("cmdSmartAdd interactive selection with duplicates", () => {
  let tmpDir: string;
  let originalIsTTY: boolean | undefined;
  let stdout: string[];

  async function items(): Promise<PRDItem[]> {
    const store = await resolveStore(resolveRexPaths(tmpDir).rexDir);
    return flatten((await store.loadDocument()).items);
  }

  async function pendingEpicTitles(): Promise<string[] | null> {
    try {
      const raw = await readFile(join(resolveRexPaths(tmpDir).rexDir, PENDING_FILE), "utf-8");
      return (JSON.parse(raw) as { proposals: Proposal[] }).proposals.map((p) => p.epic.title);
    } catch {
      return null;
    }
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-smart-add-dup-select-"));
    await cmdInit(tmpDir, {});
    await seedExistingTree(tmpDir);

    mockReasonFromDescriptions.mockReset();
    mockReasonFromDescriptions.mockResolvedValue({ proposals: [duplicateProposal, freshProposal] });
    prompts.splice(0, prompts.length);
    promptAnswers.splice(0, promptAnswers.length);

    stdout = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.map(String).join(" "));
    });

    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("asks the duplicate question after the selection and cancel writes nothing", async () => {
    const before = await items();

    promptAnswers.push("1", "c");
    await cmdSmartAdd(tmpDir, "Improve OAuth security", {}, {});

    expect(prompts).toEqual([ACCEPT_PROMPT, DUPLICATE_PROMPT]);
    const accepting = stdout.indexOf("Accepting: Security Hardening");
    expect(accepting).toBeGreaterThanOrEqual(0);
    expect(stdout.slice(accepting + 1, accepting + 4)).toEqual([
      "Duplicate matches were detected in the selected proposals.",
      "Choose action: c=cancel / m=merge with existing / p=proceed anyway",
      "Cancelled. No items were created.",
    ]);

    expect(await items()).toEqual(before);
    // Cancel returns before the unselected proposals are handled, so the cache
    // written when the proposals were shown still holds both of them.
    expect(await pendingEpicTitles()).toEqual(["Security Hardening", "Billing Statements"]);
    expect(stdout.some((l) => l.includes("proposal(s) saved"))).toBe(false);
  });

  it("proceed adds the selection and saves the unselected proposal for later", async () => {
    const before = await items();

    promptAnswers.push("1", "p");
    await cmdSmartAdd(tmpDir, "Improve OAuth security", {}, {});

    expect(prompts).toEqual([ACCEPT_PROMPT, DUPLICATE_PROMPT]);
    const after = await items();
    const added = after.length - before.length;
    expect(added).toBeGreaterThan(0);
    expect(after.filter((i) => i.title === "Implement OAuth callback handler")).toHaveLength(2);
    expect(after.find((i) => i.title === "Render invoice PDF from ledger rows")).toBeUndefined();

    expect(stdout).toContain(`Added ${added} items to PRD.`);
    expect(stdout).toContain("1 proposal(s) saved. Run `rex add --accept` to accept later.");
    expect(stdout.indexOf(`Added ${added} items to PRD.`)).toBeLessThan(
      stdout.indexOf("1 proposal(s) saved. Run `rex add --accept` to accept later."),
    );
    expect(await pendingEpicTitles()).toEqual(["Billing Statements"]);
  });

  it("merge folds the duplicate in and drops the unselected proposal", async () => {
    const before = await items();

    promptAnswers.push("1", "m");
    await cmdSmartAdd(tmpDir, "Improve OAuth security", {}, {});

    expect(prompts).toEqual([ACCEPT_PROMPT, DUPLICATE_PROMPT]);
    const after = await items();
    const added = after.length - before.length;
    expect(after.find((i) => i.id === "task-existing")?.description).toBe(
      "Implement callback handler with strict state validation.",
    );
    expect(after.filter((i) => i.title === "Implement OAuth callback handler")).toHaveLength(1);
    expect(after.find((i) => i.title === "Render invoice PDF from ledger rows")).toBeUndefined();

    expect(stdout).toContain(`Merged 1 duplicate node(s) and added ${added} new item(s) to PRD.`);
    expect(stdout).toContain("1 unselected proposal(s) were cancelled and not written.");
    expect(stdout.some((l) => l.includes("proposal(s) saved"))).toBe(false);
    expect(await pendingEpicTitles()).toBeNull();
  });

  it("selecting only the duplicate-free proposal skips the duplicate question", async () => {
    const before = await items();

    promptAnswers.push("2");
    await cmdSmartAdd(tmpDir, "Improve OAuth security", {}, {});

    expect(prompts).toEqual([ACCEPT_PROMPT]);
    const after = await items();
    const added = after.length - before.length;
    expect(after.find((i) => i.title === "Render invoice PDF from ledger rows")).toBeDefined();
    expect(after.filter((i) => i.title === "Implement OAuth callback handler")).toHaveLength(1);
    expect(stdout).toContain(`Added ${added} items to PRD.`);
    expect(stdout).toContain("1 proposal(s) saved. Run `rex add --accept` to accept later.");
    expect(await pendingEpicTitles()).toEqual(["Security Hardening"]);
  });
});
