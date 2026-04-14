import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repairProjectConfig } from "../../packages/core/config.js";

describe("repairProjectConfig", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ndx-repair-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeConfig(obj) {
    await writeFile(join(dir, ".n-dx.json"), JSON.stringify(obj, null, 2));
  }

  async function readConfig() {
    return JSON.parse(await readFile(join(dir, ".n-dx.json"), "utf-8"));
  }

  it("returns empty repairs when .n-dx.json is missing", async () => {
    const { repairs } = await repairProjectConfig(dir);
    expect(repairs).toEqual([]);
  });

  it("coerces cli.timeouts.<command> stored as a string to a number", async () => {
    await writeConfig({ cli: { timeouts: { work: "14400000" } } });
    const { repairs } = await repairProjectConfig(dir);

    expect(repairs).toEqual([
      { path: "cli.timeouts.work", from: "14400000", to: 14400000 },
    ]);
    const after = await readConfig();
    expect(after.cli.timeouts.work).toBe(14400000);
    expect(typeof after.cli.timeouts.work).toBe("number");
  });

  it("coerces cli.timeoutMs stored as a string", async () => {
    await writeConfig({ cli: { timeoutMs: "60000" } });
    const { repairs } = await repairProjectConfig(dir);

    expect(repairs).toEqual([
      { path: "cli.timeoutMs", from: "60000", to: 60000 },
    ]);
    expect((await readConfig()).cli.timeoutMs).toBe(60000);
  });

  it("repairs multiple entries under cli.timeouts", async () => {
    await writeConfig({
      cli: { timeouts: { work: "14400000", analyze: "60000", plan: 30000 } },
    });
    const { repairs } = await repairProjectConfig(dir);

    expect(repairs.map((r) => r.path).sort()).toEqual([
      "cli.timeouts.analyze",
      "cli.timeouts.work",
    ]);
    const after = await readConfig();
    expect(after.cli.timeouts.work).toBe(14400000);
    expect(after.cli.timeouts.analyze).toBe(60000);
    expect(after.cli.timeouts.plan).toBe(30000); // unchanged
  });

  it("leaves numeric values alone", async () => {
    await writeConfig({ cli: { timeouts: { work: 14400000 } } });
    const { repairs } = await repairProjectConfig(dir);
    expect(repairs).toEqual([]);
  });

  it("leaves non-numeric strings alone (e.g. version-like)", async () => {
    await writeConfig({ _initVersion: "0.2.2", cli: { timeouts: {} } });
    const { repairs } = await repairProjectConfig(dir);
    expect(repairs).toEqual([]);
    expect((await readConfig())._initVersion).toBe("0.2.2");
  });

  it("does not rewrite the file when no repairs are needed", async () => {
    const original = { cli: { timeouts: { work: 14400000 } } };
    await writeConfig(original);
    const before = await readFile(join(dir, ".n-dx.json"), "utf-8");
    await repairProjectConfig(dir);
    const after = await readFile(join(dir, ".n-dx.json"), "utf-8");
    // Byte-for-byte identical — we didn't touch the file.
    expect(after).toBe(before);
  });
});
