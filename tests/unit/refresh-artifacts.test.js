import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { refreshSourcevisionDashboardArtifacts } from "../../refresh-artifacts.js";

describe("refreshSourcevisionDashboardArtifacts", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-refresh-artifacts-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes inspectable metadata with refresh timestamp", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
    await writeFile(join(svDir, "manifest.json"), JSON.stringify({ analyzedAt: new Date().toISOString() }), "utf-8");

    const result = refreshSourcevisionDashboardArtifacts(tmpDir);
    expect(result.artifactPath).toBe(join(svDir, "dashboard-artifacts.json"));

    const artifact = JSON.parse(await readFile(result.artifactPath, "utf-8"));
    expect(artifact.artifact).toBe("sourcevision-dashboard");
    expect(typeof artifact.refreshedAt).toBe("string");
    expect(new Date(artifact.refreshedAt).getTime()).not.toBeNaN();
    expect(artifact.sourcevision.presentInputCount).toBeGreaterThan(0);
  });
});
