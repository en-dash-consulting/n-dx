import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectConfigStrict } from "../../packages/core/config.js";

describe("loadProjectConfigStrict", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ndx-strict-config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty config and no errors when no config file exists", async () => {
    expect(await loadProjectConfigStrict(dir)).toEqual({ config: {}, errors: [] });
  });

  it("merges the local file over the shared one", async () => {
    await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ ci: { a: 1, b: 1 } }));
    await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({ ci: { b: 2 } }));
    expect(await loadProjectConfigStrict(dir)).toEqual({ config: { ci: { a: 1, b: 2 } }, errors: [] });
  });

  it("names a local file that does not parse", async () => {
    await writeFile(join(dir, ".n-dx.local.json"), "{ \"ci\": {}, }");
    const { errors } = await loadProjectConfigStrict(dir);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^\.n-dx\.local\.json: /);
  });

  // Valid JSON that is not an object (`null`, `[]`, `"x"`) used to crash the
  // merge with a TypeError, aborting `ndx ci` instead of reporting the file.
  it.each(["null", "[]", "\"x\"", "3"])("reports a %s config as an error rather than throwing", async (raw) => {
    await writeFile(join(dir, ".n-dx.json"), raw);
    const { config, errors } = await loadProjectConfigStrict(dir);
    expect(config).toEqual({});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^\.n-dx\.json: .*JSON object/);
  });
});
