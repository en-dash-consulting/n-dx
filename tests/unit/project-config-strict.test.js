import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectConfig, loadProjectConfigStrict } from "../../packages/core/config.js";

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

  // JSON.parse makes a literal "__proto__" key an own property, and the merge
  // used to assign it — which on a fresh `{ ...target }` sets the result's
  // prototype rather than a key. Both load paths must skip the three
  // prototype-chain names and still merge the ordinary keys beside them.
  it("skips __proto__, constructor and prototype keys from either file", async () => {
    await writeFile(
      join(dir, ".n-dx.json"),
      '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"ci":{"a":1,"b":1}}',
    );
    await writeFile(join(dir, ".n-dx.local.json"), '{"__proto__":{"polluted":2},"ci":{"b":2}}');

    const { config, errors } = await loadProjectConfigStrict(dir);
    expect(errors).toEqual([]);
    expect(Object.getPrototypeOf(config)).toBe(Object.prototype);
    expect(Object.hasOwn(config, "__proto__")).toBe(false);
    expect(Object.hasOwn(config, "constructor")).toBe(false);
    expect("polluted" in config).toBe(false);
    expect(config.ci).toEqual({ a: 1, b: 2 });

    const merged = await loadProjectConfig(dir);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.hasOwn(merged, "__proto__")).toBe(false);
    expect("polluted" in merged).toBe(false);
    expect(merged.ci).toEqual({ a: 1, b: 2 });

    expect({}.polluted).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
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
