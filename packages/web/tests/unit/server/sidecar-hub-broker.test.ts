/**
 * The hub session's broker: it drafts and never acts. Every GitHub write is a
 * draft card naming its project and target; a side-session prompt, restack
 * plan or release checklist is saved only on Approve, at the path the card
 * shows; run_command accepts a fixed read-only set per project; and the tools
 * that act (work, edits, PRD writes, placements, migration decisions) are not
 * offered at all.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecResult } from "@n-dx/llm-client";
import { HUB_PID_FILE } from "../../../src/hub/index.js";
import { createBrokerMcpServer } from "../../../src/server/sidecar/broker-mcp.js";
import { allowListKey, BROKER_SCOPE_TOOLS, hubCommandRefusal, type BrokerScope } from "../../../src/server/sidecar/broker-policy.js";
import { BrokerDecisionError, SidecarBroker, type SidecarCard } from "../../../src/server/sidecar/broker.js";
import type { SidecarActions } from "../../../src/server/sidecar/carry-out.js";
import { createHubActions } from "../../../src/server/sidecar/hub-actions.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

let root: string;
let dir: string;
let drafts: string;
let raised: SidecarCard[];
let broker: SidecarBroker;
let clients: Client[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sidecar-hub-broker-"));
  dir = join(root, "hub", "sidecar");
  drafts = join(root, "hub", "drafts");
  mkdirSync(dir, { recursive: true });
  raised = [];
  clients = [];
  broker = new SidecarBroker({ dir, draftsDir: drafts, onCard: (card) => { if (card.status === "pending") raised.push(card); } });
});

afterEach(async () => {
  for (const client of clients) await client.close();
  await removeTestDir(root);
});

/** An MCP client on the broker, as the vendor CLI would be. */
async function connect(actions: SidecarActions | undefined, scope: BrokerScope = "hub"): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createBrokerMcpServer(broker, "s1", actions, scope).connect(serverSide);
  const client = new Client({ name: "test-cli", version: "0" });
  await client.connect(clientSide);
  clients.push(client);
  return client;
}

/** Actions that record what ran; `app` is the only project the hub knows. */
function spyActions(): SidecarActions & { ran: Array<{ argv: string[]; project?: string }>; posted: unknown[] } {
  const refused = { ok: false, text: "no" };
  const ran: Array<{ argv: string[]; project?: string }> = [];
  const posted: unknown[] = [];
  return {
    ran,
    posted,
    previewWork: async () => "",
    runCommand: (argv, _signal, project) => { ran.push({ argv, project }); return { ok: true, text: "ran" }; },
    startWork: async () => refused,
    reviewChangeSet: async () => "no",
    writeChangeSet: async () => refused,
    checkPlacement: async () => "no",
    writePlacement: async () => refused,
    readRunPlan: async () => "no",
    githubReadsAllowed: () => false,
    githubRead: async () => refused,
    postGithub: async (draft) => { posted.push(draft); return { ok: true, text: "posted" }; },
    projectRepoRoot: async (project) => (project === "app" ? { ok: true, repoRoot: "/r/app" } : { ok: false, error: `the hub has no project "${project}"` }),
    saveDraft: (path, content) => {
      writeFileSync(path, content);
      return { ok: true, text: `Saved ${path}.` };
    },
  };
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>): string => (result.content as Array<{ text: string }>)[0]!.text;

/** Decide the card the held call raised, then return the call's result. */
async function decideFirst(call: Promise<Awaited<ReturnType<Client["callTool"]>>>, decision: Parameters<SidecarBroker["decide"]>[2]) {
  await vi.waitFor(() => expect(raised).toHaveLength(1));
  broker.decide("s1", raised[0]!.id, decision);
  return call;
}

describe("what the hub session is offered", () => {
  it("offers a fixed set: no start_work, propose_edit, propose_prd_change, place_change_card, migration_decision, run plan or github_read", async () => {
    const { tools } = await (await connect(spyActions())).listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["draft_github_post", "ledger_append", "run_command", "save_draft"]);
    expect(names).toEqual([...BROKER_SCOPE_TOOLS.hub].sort());
    for (const withheld of ["start_work", "propose_edit", "propose_prd_change", "place_change_card", "migration_decision"]) {
      expect(names).not.toContain(withheld);
    }
  });

  it("keeps a worktree session's tools as they were, without save_draft", async () => {
    const { tools } = await (await connect(spyActions(), "worktree")).listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("start_work");
    expect(names).not.toContain("save_draft");
    expect(names).toHaveLength(10);
  });

  it("refuses a withheld tool called by name", async () => {
    const client = await connect(spyActions());
    await expect(client.callTool({ name: "start_work", arguments: { taskId: "t1" } })).resolves.toMatchObject({ isError: true });
    expect(raised).toEqual([]);
  });
});

describe("hub run_command", () => {
  const REFUSED: string[][] = [
    ["git", "merge", "main"],
    ["git", "rebase", "main"],
    ["git", "push"],
    ["git", "push", "--force"],
    ["ndx", "work", "."],
    ["ndx", "work", "--task=abc"],
    ["ndx", "restack"],
    ["git", "restack"],
    ["git", "worktree", "remove", "../x"],
    ["ndx", "status", "--fix"],
    ["sh", "-c", "git push"],
  ];

  it.each(REFUSED)("refuses %s with no card and runs nothing", async (...argv) => {
    const actions = spyActions();
    const result = await (await connect(actions)).callTool({ name: "run_command", arguments: { project: "app", argv } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^No card was raised: the hub session runs only these read-only commands/);
    expect(raised).toEqual([]);
    expect(actions.ran).toEqual([]);
  });

  it("refuses a project the hub does not name, with no card", async () => {
    const actions = spyActions();
    const result = await (await connect(actions)).callTool({ name: "run_command", arguments: { project: "nope", argv: ["ndx", "status"] } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(`the hub has no project "nope"`);
    expect(raised).toEqual([]);
  });

  it.each([["ndx", "status"], ["git", "worktree", "list"], ["git", "worktree", "list", "--porcelain"], ["git", "status", "--short", "--branch"]])(
    "raises a command card for %s that names its project, and runs it in that project only on Approve",
    async (...argv) => {
      const actions = spyActions();
      const call = (await connect(actions)).callTool({ name: "run_command", arguments: { project: "app", argv } });
      await vi.waitFor(() => expect(raised).toHaveLength(1));
      expect(raised[0]).toMatchObject({ kind: "command", input: { project: "app", argv } });
      expect(actions.ran).toEqual([]);
      const result = await decideFirst(call, { approve: true });
      expect(actions.ran).toEqual([{ argv, project: "app" }]);
      expect(textOf(result)).toContain("ran");
    },
  );

  it("is allow-listable per project: the rule covers that project's command and no other", async () => {
    const actions = spyActions();
    const client = await connect(actions);
    const first = client.callTool({ name: "run_command", arguments: { project: "app", argv: ["ndx", "status"] } });
    await decideFirst(first, { approve: true, remember: true });
    expect(raised[0]!.allowListKey).toBe(JSON.stringify({ project: "app", argv: ["ndx", "status"] }));

    const again = await client.callTool({ name: "run_command", arguments: { project: "app", argv: ["ndx", "status"] } });
    expect(textOf(again)).toContain("Allowed by the Sidecar allow-list");
    expect(raised).toHaveLength(1);

    const other = { ...spyActions(), projectRepoRoot: async () => ({ ok: true as const, repoRoot: "/r/other" }) };
    const call = (await connect(other)).callTool({ name: "run_command", arguments: { project: "other", argv: ["ndx", "status"] } });
    await vi.waitFor(() => expect(raised).toHaveLength(2));
    broker.decide("s1", raised[1]!.id, { approve: false });
    await call;
  });

  it("ignores a hand-edited allow-list rule for a command outside the fixed set", () => {
    const key = JSON.stringify({ project: "app", argv: ["git", "merge", "main"] });
    writeFileSync(join(dir, "allow-list.json"), JSON.stringify({
      schema: "ndx/sidecar-allow-list/v1",
      rules: [{ tool: "run_command", key }, { tool: "run_command", key: JSON.stringify({ project: "app", argv: ["ndx", "status"] }) }],
    }));
    expect(broker.allowList().map((r) => r.key)).toEqual([JSON.stringify({ project: "app", argv: ["ndx", "status"] })]);
  });

  it("states the fixed set in one place", () => {
    expect(hubCommandRefusal(["ndx", "status"])).toBeNull();
    expect(hubCommandRefusal(["ndx", "status", "extra"])).toContain("read-only");
    expect(allowListKey("run_command", { project: "app", argv: ["git", "push"] })).toBeNull();
    expect(allowListKey("run_command", { project: "", argv: ["ndx", "status"] })).toBeNull();
  });
});

describe("hub draft_github_post", () => {
  it("raises a draft card naming its project and target, and posts nothing until Approve", async () => {
    const actions = spyActions();
    const call = (await connect(actions)).callTool({
      name: "draft_github_post",
      arguments: { project: "app", kind: "comment", target: "42", body: "Restack onto main first." },
    });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    expect(raised[0]).toMatchObject({ kind: "draft-post", allowListKey: null, input: { project: "app", target: "42" } });
    expect(actions.posted).toEqual([]);

    const result = await decideFirst(call, { approve: true });
    expect(actions.posted).toEqual([{ project: "app", kind: "comment", target: "42", body: "Restack onto main first." }]);
    expect(textOf(result)).toContain("posted");
  });

  it("posts nothing on Discard", async () => {
    const actions = spyActions();
    const call = (await connect(actions)).callTool({ name: "draft_github_post", arguments: { project: "app", kind: "review", target: "42", body: "x" } });
    const result = await decideFirst(call, { approve: false });
    expect(actions.posted).toEqual([]);
    expect(textOf(result)).toContain("Nothing was posted");
  });

  it("raises no card for an unknown project or a target gh would read as a flag", async () => {
    const actions = spyActions();
    const client = await connect(actions);
    expect((await client.callTool({ name: "draft_github_post", arguments: { project: "nope", kind: "comment", target: "1", body: "x" } })).isError).toBe(true);
    expect((await client.callTool({ name: "draft_github_post", arguments: { project: "app", kind: "comment", target: "--repo=a/b", body: "x" } })).isError).toBe(true);
    expect(raised).toEqual([]);
  });

  it("is never allow-listable", () => {
    expect(allowListKey("draft_github_post", { project: "app", kind: "comment", target: "1", body: "x" })).toBeNull();
  });
});

describe("hub actions", () => {
  const execResult = (over: Partial<ExecResult> = {}): ExecResult => ({ stdout: "", stderr: "", exitCode: 0, error: null, launched: true, ...over } as ExecResult);
  let hubHome: string;
  const hostNdx = (): { bin: string; args: string[] } => ({ bin: "node", args: ["/host/core/cli.js"] });

  beforeEach(() => {
    hubHome = join(root, "home");
    mkdirSync(hubHome, { recursive: true });
    writeFileSync(join(hubHome, HUB_PID_FILE), JSON.stringify({ pid: 1, port: 3999, startedAt: "" }));
  });

  const overview = (async (url: string) => {
    if (!String(url).endsWith("/api/hub/overview")) return new Response("nope", { status: 404 });
    return new Response(JSON.stringify({ projects: [{ id: "app", repoRoot: "/r/app" }, { id: "lib", repoRoot: "/r/lib" }] }), { status: 200 });
  }) as typeof fetch;

  it("posts with gh under the operator's login, with cwd at the named project's repository root", async () => {
    const exec = vi.fn(async () => execResult({ stdout: "https://github.com/o/r/pull/42#issuecomment-1\n" }));
    const actions = createHubActions({ homeDir: hubHome, fetch: overview, exec, ndx: hostNdx });
    const result = await actions.postGithub({ project: "lib", kind: "comment", target: "42", body: "hello" });
    expect(result.ok).toBe(true);
    expect(exec).toHaveBeenCalledWith("gh", ["pr", "comment", "42", "--body-file", "-"], expect.objectContaining({ cwd: "/r/lib", input: "hello" }));
  });

  it("posts nothing for a draft without a project or with one the hub does not name", async () => {
    const exec = vi.fn(async () => execResult());
    const actions = createHubActions({ homeDir: hubHome, fetch: overview, exec, ndx: hostNdx });
    expect((await actions.postGithub({ kind: "comment", target: "1", body: "x" })).ok).toBe(false);
    expect((await actions.postGithub({ project: "ghost", kind: "comment", target: "1", body: "x" })).ok).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it("runs a command with cwd at the project's repository root and reports its output", async () => {
    const exec = vi.fn(async () => execResult({ stdout: "/r/app  abc [main]\n" }));
    const actions = createHubActions({ homeDir: hubHome, fetch: overview, exec, ndx: hostNdx });
    const result = await actions.runCommand(["git", "worktree", "list"], undefined, "app");
    expect(exec).toHaveBeenCalledWith("git", ["worktree", "list"], expect.objectContaining({ cwd: "/r/app" }));
    expect(result).toMatchObject({ ok: true });
    expect(result.text).toContain("/r/app  abc [main]");
  });

  it("starts ndx as the host's own CLI, never a bare ndx from PATH", async () => {
    const exec = vi.fn(async () => execResult({ stdout: "ok\n" }));
    const actions = createHubActions({ homeDir: hubHome, fetch: overview, exec, ndx: () => ({ bin: "node", args: ["/host/core/cli.js"] }) });
    expect((await actions.runCommand(["ndx", "status"], undefined, "lib")).ok).toBe(true);
    expect(exec).toHaveBeenCalledWith("node", ["/host/core/cli.js", "status"], expect.objectContaining({ cwd: "/r/lib" }));
  });

  it("refuses work, edits and PRD writes outright", async () => {
    const actions = createHubActions({ homeDir: hubHome, fetch: overview, exec: vi.fn(), ndx: hostNdx });
    expect((await actions.startWork("t1", undefined)).ok).toBe(false);
    expect((await actions.writeChangeSet({ items: [] } as never, "s1")).ok).toBe(false);
    expect((await actions.writePlacement({} as never, "s1")).ok).toBe(false);
    expect(actions.githubReadsAllowed()).toBe(false);
  });
});

describe("hub save_draft", () => {
  const call = async (client: Client, args: Record<string, unknown>) =>
    client.callTool({ name: "save_draft", arguments: { kind: "prompt", content: "# Side session\nrestack #12", ...args } });

  it("is never allow-listable, however the operator answers", async () => {
    const client = await connect(spyActions());
    const held = call(client, { path: "restack.md" });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    expect(raised[0]!.allowListKey).toBeNull();
    expect(() => broker.decide("s1", raised[0]!.id, { approve: true, remember: true })).toThrow(BrokerDecisionError);
    broker.decide("s1", raised[0]!.id, { approve: false });
    await held;
  });

  it("writes nothing before Approve, then saves at the path the card showed, under the drafts directory for a relative one", async () => {
    const actions = spyActions();
    mkdirSync(drafts, { recursive: true });
    const held = call(await connect(actions), { path: "restack.md" });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    expect(raised[0]).toMatchObject({ kind: "draft-file", input: { kind: "prompt", path: join(drafts, "restack.md") } });
    expect(existsSync(join(drafts, "restack.md"))).toBe(false);

    const result = await decideFirst(held, { approve: true });
    expect(readFileSync(join(drafts, "restack.md"), "utf-8")).toContain("restack #12");
    expect(textOf(result)).toContain("Saved");
  });

  it("saves at the path the operator edited on the card, and says so", async () => {
    const actions = spyActions();
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    const held = call(await connect(actions), { path: "restack.md" });
    const result = await decideFirst(held, { approve: true, path: join(elsewhere, "plan.md") });
    expect(existsSync(join(elsewhere, "plan.md"))).toBe(true);
    expect(existsSync(join(drafts, "restack.md"))).toBe(false);
    expect(textOf(result)).toContain("changed the path");
    expect(raised[0]!.edited).toBe(true);
  });

  it("saves nothing on Deny", async () => {
    const held = call(await connect(spyActions()), { path: "restack.md" });
    const result = await decideFirst(held, { approve: false, reason: "no" });
    expect(textOf(result)).toContain("Nothing was saved");
    expect(existsSync(join(drafts, "restack.md"))).toBe(false);
  });

  it("raises no card for a path outside the drafts directory that is relative, or inside .git", async () => {
    const client = await connect(spyActions());
    expect((await call(client, { path: "../escape.md" })).isError).toBe(true);
    expect((await call(client, { path: join(root, "repo", ".git", "hooks", "pre-commit") })).isError).toBe(true);
    expect(raised).toEqual([]);
  });

  it("refuses an edited path that would be refused up front, and a path on a card that is not a draft file", async () => {
    const held = call(await connect(spyActions()), { path: "restack.md" });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    expect(() => broker.decide("s1", raised[0]!.id, { approve: true, path: "../x.md" })).toThrow(BrokerDecisionError);
    expect(() => broker.decide("s1", raised[0]!.id, { approve: false, path: "ok.md" })).toThrow(BrokerDecisionError);
    broker.decide("s1", raised[0]!.id, { approve: false });
    await held;

    const command = (await connect(spyActions())).callTool({ name: "run_command", arguments: { project: "app", argv: ["ndx", "status"] } });
    await vi.waitFor(() => expect(raised).toHaveLength(2));
    expect(() => broker.decide("s1", raised[1]!.id, { approve: true, path: "x.md" })).toThrow(BrokerDecisionError);
    broker.decide("s1", raised[1]!.id, { approve: false });
    await command;
  });
});
