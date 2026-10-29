import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { installToolchain, TOOLCHAIN_PLATFORM, WASM_TOOLCHAIN } from "../../scripts/build-grammars.mjs";

const roots: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("uses a matching extracted marker without fetching or hashing its obsolete archive", async () => {
  const root = mkdtempSync(join(tmpdir(), "toolchain-cache-")); roots.push(root);
  const key = "linux-x64";
  const platform = TOOLCHAIN_PLATFORM[key]!;
  const tool = WASM_TOOLCHAIN.binaryen;
  const base = `binaryen-${tool.version}-${platform}`;
  const dir = join(root, base); mkdirSync(dir);
  writeFileSync(join(dir, ".n-dx-sha256"), tool.sha256[platform]);
  writeFileSync(join(root, `${base}.tar.gz`), "an obsolete archive that cannot match the checksum");
  const fetch = vi.fn(() => { throw new Error("unexpected download"); }); vi.stubGlobal("fetch", fetch);
  expect(await installToolchain("binaryen", key, root)).toBe(dir);
  expect(fetch).not.toHaveBeenCalled();
  expect(existsSync(join(root, `${base}.tar.gz`))).toBe(false);
});

it.each([undefined, "mismatched"])("downloads and extracts when the marker is %s, then removes the archive", async (marker) => {
  const root = mkdtempSync(join(tmpdir(), "toolchain-cache-")); roots.push(root);
  const source = join(root, "source"); mkdirSync(join(source, "tool/bin"), { recursive: true });
  writeFileSync(join(source, "tool/bin/tool"), "verified tool");
  const fixture = join(root, "fixture.tar.gz");
  expect(spawnSync("tar", ["-czf", fixture, "-C", source, "tool"]).status).toBe(0);
  const bytes = readFileSync(fixture);
  const expected = createHash("sha256").update(bytes).digest("hex");
  const key = "linux-x64"; const platform = TOOLCHAIN_PLATFORM[key]!; const tool = WASM_TOOLCHAIN.binaryen;
  const old = tool.sha256[platform]; tool.sha256[platform] = expected;
  const base = `binaryen-${tool.version}-${platform}`; const dir = join(root, base);
  if (marker) { mkdirSync(dir); writeFileSync(join(dir, ".n-dx-sha256"), marker); }
  const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes })); vi.stubGlobal("fetch", fetch);
  try {
    expect(await installToolchain("binaryen", key, root)).toBe(dir);
    expect(readFileSync(join(dir, "bin/tool"), "utf8")).toBe("verified tool");
    expect(readFileSync(join(dir, ".n-dx-sha256"), "utf8")).toBe(expected);
    expect(existsSync(join(root, `${base}.tar.gz`))).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    await installToolchain("binaryen", key, root);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { tool.sha256[platform] = old; }
});
