/** A stale release plan reaches `rex validate` and the MCP `health` tool as a warning. */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdValidate } from "../../../../src/cli/commands/validate.js";
import { handleHealth } from "../../../../src/cli/mcp-tools/health.js";
import { resolveStore } from "../../../../src/store/index.js";
import { copyV2Fixture, FIXTURE_CHANGE } from "../../../helpers/v2-fixture.js";

const SHIPPED = "c0000000-0000-4000-8000-0000000000aa";

let tmp: string;
let rexDir: string;
let out: string[];

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-stale-release-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "t", adapter: "file" }));
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
});
afterEach(async () => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

/** An applied change that shipped in `release`. The fixture's open CH-1 is planned for 1.2.0. */
async function shipChange(release: string): Promise<void> {
  const dir = join(rexDir, "changes", "shipped-wallets");
  await mkdir(dir);
  await writeFile(
    join(dir, "index.md"),
    `---\nid: "${SHIPPED}"\ntype: "change"\ntitle: "Shipped wallets"\nslug: "shipped-wallets"\ntouches: ["a0000000-0000-4000-8000-000000000002"]\n---\n`,
  );
  await writeFile(
    join(dir, "state.yaml"),
    `schema: "rex/v2"\nitems:\n  "${SHIPPED}":\n    status: "completed"\n    completedAt: "2026-10-01T00:00:00.000Z"\n    appliedAt: "2026-10-01T00:00:00.000Z"\n    shippedIn: "${release}"\n`,
  );
}

async function validateJson(): Promise<{ ok: boolean; checks: { name: string; pass: boolean; severity?: string; errors: string[] }[] }> {
  await cmdValidate(tmp, { format: "json" });
  return JSON.parse(out.join("\n"));
}

describe("stale release plans on a v2 tree", () => {
  it("rex validate warns for an open change planned for a shipped release, without failing", async () => {
    await shipChange("1.2.0");
    const report = await validateJson();
    const check = report.checks.find((c) => c.name === "release plans");
    expect(check).toMatchObject({ pass: false, severity: "warn" });
    expect(check!.errors).toHaveLength(1);
    expect(check!.errors[0]).toContain(FIXTURE_CHANGE);
    expect(check!.errors[0]).toContain("1.2.0");
    expect(report.ok).toBe(true);
  });

  it("rex validate passes the check when no plan is stale", async () => {
    await shipChange("1.1.0");
    const report = await validateJson();
    expect(report.checks.find((c) => c.name === "release plans")).toMatchObject({ pass: true, errors: [] });
  });

  it("the MCP health tool reports a plan older than the newest shipped release as a warning", async () => {
    await shipChange("1.3.0");
    const store = await resolveStore(rexDir);
    const res = await handleHealth(store, tmp, rexDir);
    const body = JSON.parse(res.content[0].text);
    const stale = body.v2.treeRules.filter((f: { rule: string }) => f.rule === "stale-release-plan");
    expect(stale).toEqual([expect.objectContaining({ nodeId: FIXTURE_CHANGE, severity: "warning" })]);
    expect(stale[0].message).toContain("older than 1.3.0");
  });
});
