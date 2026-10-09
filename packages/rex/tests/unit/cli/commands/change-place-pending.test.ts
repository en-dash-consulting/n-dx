/**
 * `rex change place` tells the user, at placement, that apply will refuse
 * until the open changes in the way close. The core placement is stubbed to
 * report a pending problem: real placement only meets one when a new
 * amendment adds a problem the change did not already have.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../../../src/core/change-place.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/core/change-place.js")>();
  return {
    ...real,
    recordPlacement: (...args: Parameters<typeof real.recordPlacement>) => ({
      ...real.recordPlacement(...args),
      warnings: ["Open change CH-9 stands in the way, so apply_change refuses until it is applied or closed: it is blocked"],
      pending: ["it is blocked"],
      blockedBy: ["CH-9"],
    }),
  };
});

const { cmdChange } = await import("../../../../src/cli/commands/change.js");
const { cmdAddChange } = await import("../../../../src/cli/commands/add-change.js");
const { pendingPlacementWarnings } = await import("../../../../src/cli/commands/v2-cli.js");
const { copyV2Fixture } = await import("../../../helpers/v2-fixture.js");

let tmp: string;
let out: string[];
let err: string[];

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-place-pending-"));
  const rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "t", adapter: "file" }));
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

async function addInbox(): Promise<string> {
  await cmdAddChange(tmp, undefined, { title: "Wallets", format: "json" });
  const id = JSON.parse(out.join("\n")).id as string;
  out.length = 0;
  return id;
}

const place = { target: "A1.1", relation: "amends", proposed: "Pay and refund by card" };

describe("pendingPlacementWarnings", () => {
  it("names the blocking changes and rex change apply, and no MCP tool", () => {
    const [w] = pendingPlacementWarnings(["a", "b"], ["CH-1", "CH-2"]);
    expect(w).toBe("Open change CH-1, CH-2 stands in the way, so rex change apply refuses until it is applied or closed: a; b");
    expect(w).not.toMatch(/apply_change/);
  });

  it("says nothing when nothing is pending, and names no change when none is known", () => {
    expect(pendingPlacementWarnings([], [])).toEqual([]);
    expect(pendingPlacementWarnings(["a"], [])[0]).toMatch(/^Another open change stands in the way, so rex change apply refuses/);
  });
});

describe("rex change place with a pending placement", () => {
  it("warns on stderr, naming the blocking change and rex change apply, not the core MCP string", async () => {
    const id = await addInbox();
    await cmdChange(tmp, "place", id, place);
    expect(out.join("\n")).toMatch(/^Placed /);
    expect(err).toEqual(["Open change CH-9 stands in the way, so rex change apply refuses until it is applied or closed: it is blocked"]);
    expect(err.join()).not.toMatch(/apply_change|_item|get_|place_change/);
  });

  it("includes the warnings in --format=json", async () => {
    const id = await addInbox();
    await cmdChange(tmp, "place", id, { ...place, format: "json" });
    const body = JSON.parse(out.join("\n"));
    expect(body).toMatchObject({ change: expect.any(String), target: expect.any(String), relation: "amends" });
    expect(body.warnings).toEqual(["Open change CH-9 stands in the way, so rex change apply refuses until it is applied or closed: it is blocked"]);
    expect(err).toEqual([]);
  });
});
