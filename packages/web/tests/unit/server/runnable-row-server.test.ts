/**
 * The server's two callers of the runnable-row wording: `describeRunnable`
 * (the Sidecar work card's `rowText`) and `readQueuePlan` (the run-plan card's
 * track rows and Live's Ready next). The viewer and `withPlannedRowText` tests
 * hand `rowText` over directly, so these are what fail when a server call is
 * dropped and the cards fall back to bare titles.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));
vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return { ...actual, exec: execMock };
});

import { describeRunnable, readQueuePlan } from "../../../src/server/routes-hench.js";
import type { ServerContext } from "../../../src/server/types.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

let root: string;
let ctx: ServerContext;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "runnable-row-server-"));
  mkdirSync(join(root, ".rex", ".cache"), { recursive: true });
  writeFileSync(join(root, ".rex", ".cache", "prd.json"), JSON.stringify({
    schema: "rex/v1",
    title: "v2 fixture",
    items: [
      {
        id: "change-a", type: "change", title: "Add Apple Pay", status: "pending",
        children: [{ id: "task-a", type: "task", title: "Wire the SDK", status: "pending" }],
      },
      { id: "change-b", type: "change", title: "Refund flow", status: "pending" },
    ],
  }));
  ctx = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
});

afterEach(async () => {
  execMock.mockReset();
  await removeTestDir(root);
});

describe("describeRunnable", () => {
  it("names the change a task sits in", () => {
    expect(describeRunnable(ctx, "task-a")).toBe("Wire the SDK · in Add Apple Pay");
  });

  it("says a task-less change runs as one task", () => {
    expect(describeRunnable(ctx, "change-b")).toBe("Refund flow · runs as one task");
  });

  it("returns null for an id the PRD does not know", () => {
    expect(describeRunnable(ctx, "nope")).toBeNull();
  });
});

describe("readQueuePlan", () => {
  it("fills each planned task's rowText from its lane's change", async () => {
    const plan = {
      lanes: [
        {
          command: "ndx work --task=task-a --auto .",
          changeId: "change-a",
          changeTitle: "Add Apple Pay",
          tasks: [{ id: "task-a", title: "Wire the SDK", reason: "ready" }],
        },
        {
          command: "ndx work --task=change-b --auto .",
          changeId: "change-b",
          changeTitle: "Refund flow",
          tasks: [{ id: "change-b", title: "Refund flow", reason: "ready" }],
        },
      ],
      excluded: [],
      activeRuns: 0,
      runLimit: 3,
      summary: "2 lanes.",
    };
    execMock.mockResolvedValue({ launched: true, exitCode: 0, stdout: `note\n${JSON.stringify(plan)}`, stderr: "" });

    const read = await readQueuePlan(ctx);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.plan.lanes[0].tasks[0].rowText).toBe("Wire the SDK · in Add Apple Pay");
    expect(read.plan.lanes[1].tasks[0].rowText).toBe("Refund flow · runs as one task");
  });
});
