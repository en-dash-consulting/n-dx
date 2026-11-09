/**
 * `get_next_task` through the rex MCP server narrows selection to the current
 * branch's work set: only assigned units on a branch that has one, anything
 * with `any`, and unchanged on the default branch and on a branch with no
 * assignment.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRexMcpServer } from "../../src/cli/mcp.js";
import { openClaimsStore } from "../../src/store/index.js";
import { FIXTURE_CHANGE, FIXTURE_TASK, copyV2Fixture } from "../helpers/v2-fixture.js";

/** A second, low-priority task in the fixture change: picked only through a work set. */
const LOW_TASK = "c0000000-0000-4000-8000-0000000000a1";

let tmp: string;
let client: Client;
let close: () => Promise<void>;
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: tmp, encoding: "utf-8" }).trim();

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-mcp-next-work-set-"));
  await copyV2Fixture(join(tmp, ".rex"), "lf");
  await writeFile(
    join(tmp, ".rex", "changes", "add-apple-pay", "polish-the-sheet.md"),
    `---\nid: "${LOW_TASK}"\ntype: "task"\ntitle: "Polish the sheet"\nslug: "polish-the-sheet"\npriority: "low"\n---\n`,
  );
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const server = await createRexMcpServer(tmp);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "next-work-set", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  close = async () => {
    await client.close();
    await server.close();
  };
});
afterEach(async () => {
  await close();
  await rm(tmp, { recursive: true, force: true });
});

/** Make LOW_TASK wait on FIXTURE_TASK, which stays off the work set. */
async function blockLowTaskOnFixtureTask(root: string): Promise<void> {
  await writeFile(
    join(root, ".rex", "changes", "add-apple-pay", "polish-the-sheet.md"),
    `---\nid: "${LOW_TASK}"\ntype: "task"\ntitle: "Polish the sheet"\nslug: "polish-the-sheet"\npriority: "low"\nblockedBy:\n  - "${FIXTURE_TASK}"\n---\n`,
  );
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  expect(result.isError, result.content[0].text).toBeFalsy();
  return JSON.parse(result.content[0].text);
}

describe("get_next_task with a branch work set", () => {
  it("is unchanged on the default branch and on a branch with no assignment", async () => {
    const onMain = await call("get_next_task");
    expect(onMain.item.id).toBe(FIXTURE_TASK);
    expect(onMain.workSetBranch).toBeUndefined();

    git("checkout", "-q", "-b", "feat/polish");
    const unassigned = await call("get_next_task");
    expect(unassigned.item.id).toBe(FIXTURE_TASK);
    expect(unassigned.workSetBranch).toBeUndefined();
  });

  it("picks only from the set, picks outside it with any, and says when the set is spent", async () => {
    git("checkout", "-q", "-b", "feat/polish");
    await call("assign_to_branch", { ids: [LOW_TASK] });

    const inSet = await call("get_next_task");
    expect(inSet.item.id).toBe(LOW_TASK);
    expect(inSet.workSetBranch).toBe("feat/polish");

    const anyPick = await call("get_next_task", { any: true });
    expect(anyPick.item.id).toBe(FIXTURE_TASK);
    expect(anyPick.workSetBranch).toBeUndefined();

    await call("update_task_status", { id: LOW_TASK, status: "completed" });
    const spent = await call("get_next_task");
    expect(spent.next).toBeNull();
    expect(spent.message).toBe("This branch's work set is finished: all its tasks are done; selection stays narrowed to it, and any: true picks outside it");
    expect(spent.workSetBranch).toBe("feat/polish");
    expect((await call("get_next_task", { any: true })).item.id).toBe(FIXTURE_TASK);

    // The completed assignment still makes this a work-set branch; main is unaffected.
    git("checkout", "-q", "main");
    expect((await call("get_next_task")).item.id).toBe(FIXTURE_TASK);
  });

  it("picks the tasks a task-less change on the branch is later split into", async () => {
    // Make CH-1 task-less, as a change is before hench splits it.
    await call("update_task_status", { id: FIXTURE_TASK, status: "deleted" });
    await call("update_task_status", { id: LOW_TASK, status: "deleted" });
    git("checkout", "-q", "-b", "feat/split");
    const assigned = await call("assign_to_branch", { ids: [FIXTURE_CHANGE] });
    expect(assigned.assigned.map((u: { id: string }) => u.id)).toEqual([FIXTURE_CHANGE]);

    const split = (await call("add_item", { type: "task", title: "Show the sheet", parentId: FIXTURE_CHANGE })).id;
    const next = await call("get_next_task");
    expect(next.item.id).toBe(split);
    expect(next.workSetBranch).toBe("feat/split");

    // A split task moved to another branch gets its own delivery and leaves this set.
    git("checkout", "-q", "-b", "feat/other");
    await call("assign_to_branch", { ids: [split], move: true });
    git("checkout", "-q", "feat/split");
    const spent = await call("get_next_task");
    expect(spent.next).toBeNull();
    expect(spent.workSetBranch).toBe("feat/split");
  });

  it("a set whose task is blocked by one outside it names the blocker and is not finished", async () => {
    await blockLowTaskOnFixtureTask(tmp);
    git("checkout", "-q", "-b", "feat/polish");
    const assigned = await call("assign_to_branch", { ids: [LOW_TASK] });
    expect(assigned.assigned.map((u: { id: string }) => u.id)).toEqual([LOW_TASK]);
    expect(assigned.warnings).toEqual([
      `"Polish the sheet" (${LOW_TASK}) is blocked by "Wire the button" (${FIXTURE_TASK}) (pending), which is not in this branch's work set: it cannot be picked until that is done or assigned here`,
    ]);

    const blocked = await call("get_next_task");
    expect(blocked.next).toBeNull();
    expect(blocked.workSetBranch).toBe("feat/polish");
    expect(blocked.blocked).toEqual([
      expect.objectContaining({ id: LOW_TASK, reasons: [`blocked by "Wire the button" (${FIXTURE_TASK}) (pending, outside this branch's work set)`] }),
    ]);
    expect(blocked.message).toContain("Nothing in this branch's work set can be picked: its 1 open task is blocked; any: true picks outside it");
    expect(blocked.message).toContain(`"Polish the sheet" [pending]: blocked by "Wire the button"`);
    expect(blocked.message).not.toContain("finished");
  });

  it("a set whose only task another worktree holds names the holder", async () => {
    git("checkout", "-q", "-b", "feat/polish");
    await call("assign_to_branch", { ids: [LOW_TASK] });
    await openClaimsStore(tmp).claim(LOW_TASK, { worktreeRoot: "/elsewhere", pid: process.pid });

    const blocked = await call("get_next_task");
    expect(blocked.next).toBeNull();
    expect(blocked.blocked).toEqual([expect.objectContaining({ id: LOW_TASK, reasons: ["claimed by another worktree: /elsewhere"] })]);
    expect(blocked.skippedClaimed).toEqual([expect.objectContaining({ taskId: LOW_TASK, worktreeRoot: "/elsewhere" })]);
  });

  it("assign_to_branch refuses a change awaiting placement in the Inbox", async () => {
    const inbox = (await call("add_item", { type: "change", title: "Loose idea" })).id;
    git("checkout", "-q", "-b", "feat/loose");
    const refused = (await client.callTool({ name: "assign_to_branch", arguments: { ids: [inbox] } })) as { content: { text: string }[]; isError?: boolean };
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain(`is in the Inbox awaiting placement, and selection never picks it: place it first`);
    expect((await call("get_next_task")).workSetBranch).toBeUndefined();
  });

  it("a branch cut again under a merged branch's name has no work set, and names the earlier branch's tasks", async () => {
    git("checkout", "-q", "-b", "feat/x");
    await call("assign_to_branch", { ids: [LOW_TASK] });
    await call("update_task_status", { id: LOW_TASK, status: "completed" });
    git("add", "-A");
    git("commit", "-q", "-m", "finish");
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "-m", "merge feat/x", "feat/x");
    git("branch", "-q", "-D", "feat/x");
    git("checkout", "-q", "-b", "feat/x");

    const next = await call("get_next_task");
    expect(next.item.id).toBe(FIXTURE_TASK);
    expect(next.workSetBranch).toBeUndefined();
    expect(next.earlierUse).toEqual({
      branch: "feat/x",
      ids: [LOW_TASK],
      message: "1 task on feat/x comes from an earlier branch of this name; it is not in this branch's set",
    });
    expect((await call("get_next_task", { any: true })).earlierUse).toBeUndefined();
  });
});
