/**
 * `assign_to_branch` through the rex MCP server, on the v2 fixture tree in a
 * real git repository: assigns, moves, removes, and refuses on the default
 * branch, a detached HEAD and a refused workspace.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRexMcpServer } from "../../src/cli/mcp.js";
import { FIXTURE_TASK, copyV2Fixture } from "../helpers/v2-fixture.js";

let tmp: string;
let client: Client;
let close: () => Promise<void>;
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: tmp, encoding: "utf-8" }).trim();

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-mcp-assign-"));
  await copyV2Fixture(join(tmp, ".rex"), "lf");
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  const server = await createRexMcpServer(tmp);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "assign", version: "1.0.0" });
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

async function call(args: Record<string, unknown>) {
  const result = (await client.callTool({ name: "assign_to_branch", arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: result.content[0].text, isError: Boolean(result.isError) };
}

describe("assign_to_branch", () => {
  it("assigns a change's tasks, moves them from another branch, and removes them", async () => {
    git("checkout", "-q", "-b", "feat/one");
    const assigned = await call({ ids: ["CH-1"] });
    expect(assigned.isError, assigned.text).toBe(false);
    expect(JSON.parse(assigned.text)).toMatchObject({ branch: "feat/one", assigned: [{ id: FIXTURE_TASK, title: "Wire the button" }] });

    git("checkout", "-q", "-b", "feat/two");
    const refused = await call({ ids: [FIXTURE_TASK] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("feat/one");

    const moved = await call({ ids: [FIXTURE_TASK], move: true });
    expect(JSON.parse(moved.text).assigned[0]).toMatchObject({ id: FIXTURE_TASK, movedFrom: "feat/one" });

    const removed = await call({ ids: ["CH-1"], remove: true });
    expect(JSON.parse(removed.text)).toMatchObject({ branch: "feat/two", removed: [{ id: FIXTURE_TASK }] });
  });

  it("refuses on the default branch and on a detached HEAD", async () => {
    for (const setup of [() => undefined, () => git("checkout", "-q", "--detach")]) {
      setup();
      const out = await call({ ids: ["CH-1"] });
      expect(out.isError).toBe(true);
      expect(out.text).toContain("feature branch");
    }
  });

  it("refuses an empty ids list and remove with move", async () => {
    git("checkout", "-q", "-b", "feat/one");
    expect((await call({ ids: [] })).isError).toBe(true);
    expect((await call({ ids: ["CH-1"], remove: true, move: true })).isError).toBe(true);
  });
});

// A refused workspace is turned away for every tool whose access is "write"
// (mcp.ts); mcp-tools-access.test.ts pins assign_to_branch as one.
