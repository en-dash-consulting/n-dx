import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRD_TREE_DIRNAME } from "@n-dx/rex";
import { LLM_VENDOR } from "../../src/prd/llm-gateway.js";
import {
  runAdversarialReviewPass,
  type ReviewPassContext,
} from "../../src/agent/lifecycle/cli-loop.js";
import type { RunRecord } from "../../src/schema/index.js";
import { cleanupProjectDir } from "../helpers/index.js";

/**
 * The reviewer is told where to look for an existing item before it files a
 * new one. On a v2 tree that is changes/; prd_tree/ does not exist there, so
 * the reviewer would never find the item and would file a duplicate. The unit
 * test of reviewDedupeDir cannot see the call inside runAdversarialReviewPass;
 * this drives the pass itself and reads the brief it hands the adapter.
 */

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");

const STOP = "brief captured";
const roots: string[] = [];

afterEach(async () => {
  for (const dir of roots.splice(0)) await cleanupProjectDir(dir);
});

/** Run the review pass up to the adapter and return the brief it was given. */
async function reviewBrief(projectDir: string): Promise<string> {
  let brief = "";
  const adapter = {
    vendor: LLM_VENDOR.CLAUDE,
    buildSpawnConfig: (envelope: { sections: Array<{ name: string; content: string }> }) => {
      brief = envelope.sections.find((section) => section.name === "brief")?.content ?? "";
      throw new Error(STOP);
    },
  };
  const ctx = {
    adapter,
    vendor: LLM_VENDOR.CLAUDE,
    cliBinary: "claude",
    cliEnv: {},
    policy: {},
    henchDir: join(projectDir, ".hench"),
    reviewModel: "",
    permissionMode: "acceptEdits",
    autonomous: true,
    testGateFollows: false,
    taskTitle: "Wire the button",
  } as unknown as ReviewPassContext;
  const run = { id: "run-1", taskId: "task-1" } as unknown as RunRecord;

  await expect(
    runAdversarialReviewPass(ctx, {
      run,
      taskId: "task-1",
      projectDir,
      startingHead: undefined,
      sessionId: undefined,
    }),
  ).rejects.toThrow(STOP);
  return brief;
}

async function project(layout: "v1" | "v2"): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), `hench-review-dedupe-${layout}-`));
  roots.push(projectDir);
  const rexDir = join(projectDir, ".rex");
  if (layout === "v2") await cp(FIXTURE, rexDir, { recursive: true });
  else await mkdir(join(rexDir, PRD_TREE_DIRNAME), { recursive: true });
  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }),
  );
  return projectDir;
}

describe("review brief's dedupe directory", () => {
  it("names changes/ and not prd_tree/ on a v2 tree", async () => {
    const brief = await reviewBrief(await project("v2"));
    expect(brief).toContain(".rex/changes/");
    expect(brief).not.toContain(PRD_TREE_DIRNAME);
  });

  it("also names changes/inbox/ on a v2 tree that holds an Inbox capture", async () => {
    const projectDir = await project("v2");
    const capture = join(projectDir, ".rex", "changes", "inbox", "retry-soft-declines-twice");
    await mkdir(capture, { recursive: true });
    await writeFile(join(capture, "index.md"), "# Retry soft declines twice\n");
    const brief = await reviewBrief(projectDir);
    expect(brief).toContain(".rex/changes/inbox/");
    expect(brief).toContain("where unplaced changes wait");
  });

  it("names prd_tree/ and not changes/ on a v1 tree", async () => {
    const brief = await reviewBrief(await project("v1"));
    expect(brief).toContain(`.rex/${PRD_TREE_DIRNAME}/`);
    expect(brief).not.toContain("changes/");
  });
});
