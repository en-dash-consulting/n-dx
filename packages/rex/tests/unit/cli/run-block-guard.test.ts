/**
 * A `run` block is not saved from inside an agent run.
 *
 * `ndx work` marks the agent session with NDX_AGENT_RUN and the rex MCP
 * server it talks to inherits it, so `add_item` and `edit_item` carrying
 * `run` from there are the agent writing its own next run's settings.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AGENT_RUN_ENV, runBlockRefusalInsideAgentRun } from "../../../src/cli/run-block-guard.js";
import { handleAddItem, handleEditItem } from "../../../src/cli/mcp-tools/index.js";
import { FileStore, createStore, ensureRexDir } from "../../../src/store/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { SCHEMA_VERSION } from "../../../src/schema/v1.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/v1.js";
import { copyV2Fixture } from "../../helpers/v2-fixture.js";

const text = (r: { content: { text: string }[] }) => r.content[0].text;

describe("runBlockRefusalInsideAgentRun", () => {
  it("names the variable it reads", () => {
    expect(AGENT_RUN_ENV).toBe("NDX_AGENT_RUN");
  });

  it("refuses a block only inside an agent run, and never a removal", () => {
    expect(runBlockRefusalInsideAgentRun({ tier: "light" }, {})).toBeUndefined();
    expect(runBlockRefusalInsideAgentRun({ tier: "light" }, { NDX_AGENT_RUN: "1" })).toMatch(/cannot be saved from inside an agent run/);
    expect(runBlockRefusalInsideAgentRun(undefined, { NDX_AGENT_RUN: "1" })).toBeUndefined();
    expect(runBlockRefusalInsideAgentRun(null, { NDX_AGENT_RUN: "1" })).toBeUndefined();
  });
});

describe("add_item inside an agent run", () => {
  let tmp: string;
  let rexDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "rex-run-guard-add-"));
    rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
    vi.stubEnv("NDX_AGENT_RUN", "1");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tmp, { recursive: true, force: true });
  });

  it("refuses a run block with a clear error and writes nothing", async () => {
    const res = await handleAddItem(createStore("file", rexDir), tmp, rexDir, { title: "Widen me", run: { tier: "light" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("NDX_AGENT_RUN");
    expect(text(res)).toContain("cannot be saved from inside an agent run");
  });

  it("still adds an item that carries no run block", async () => {
    const res = await handleAddItem(createStore("file", rexDir), tmp, rexDir, { title: "Plain" });
    expect(res.isError).toBeFalsy();
  });
});

describe("edit_item inside an agent run", () => {
  let tmpDir: string;
  let rexDir: string;
  let store: FileStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-run-guard-edit-"));
    rexDir = join(tmpDir, ".rex");
    await ensureRexDir(rexDir);
    const task: PRDItem = { id: "task-1", title: "Task", status: "pending", level: "task", run: { tier: "heavy" } };
    const feature: PRDItem = { id: "feature-1", title: "Feature", status: "pending", level: "feature", children: [task] };
    const epic: PRDItem = { id: "epic-1", title: "Epic", status: "pending", level: "epic", children: [feature] };
    const doc: PRDDocument = { schema: SCHEMA_VERSION, title: "Guard", items: [epic] };
    await writeFile(join(rexDir, "prd.json"), toCanonicalJSON(doc), "utf-8");
    await writeFile(join(rexDir, "config.json"), toCanonicalJSON({ schema: SCHEMA_VERSION, project: "test", adapter: "file" }), "utf-8");
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Test Workflow", "utf-8");
    store = new FileStore(rexDir);
    vi.stubEnv("NDX_AGENT_RUN", "1");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("refuses a replacement run block", async () => {
    const res = await handleEditItem(store, tmpDir, { id: "task-1", run: { tier: "light", skipTestGate: true } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("NDX_AGENT_RUN");
  });

  it("still allows removing the block and editing other fields", async () => {
    const removed = await handleEditItem(store, tmpDir, { id: "task-1", run: null });
    expect(removed.isError).toBeFalsy();
    const titled = await handleEditItem(store, tmpDir, { id: "task-1", title: "Renamed" });
    expect(titled.isError).toBeFalsy();
  });
});
