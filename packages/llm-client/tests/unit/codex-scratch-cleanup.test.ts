import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexCliClient, createCodexScratch } from "../../src/codex-cli-provider.js";
import { writeFakeCli } from "../helpers/fake-cli.js";

const mocks = vi.hoisted(() => ({ remove: vi.fn(), list: vi.fn() }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  mocks.remove.mockImplementation(actual.rmSync);
  mocks.list.mockImplementation(actual.readdirSync);
  return { ...actual, rmSync: mocks.remove, readdirSync: mocks.list };
});
afterEach(() => vi.restoreAllMocks());

describe("Codex scratch cleanup diagnostics", () => {
  it.skipIf(process.platform === "win32")("enumerates nested directories through stable identities", async () => {
    const scratch = createCodexScratch();
    try {
      await mkdir(join(scratch.dir, "build", "cache"), { recursive: true });
      await writeFile(join(scratch.dir, "build", "cache", "entry"), "data");
      mocks.list.mockClear();
      scratch.dispose();
      expect(existsSync(scratch.dir)).toBe(false);
      expect(mocks.list.mock.calls).toHaveLength(3);
      expect(mocks.list.mock.calls.map(([path]) => path)).not.toContain(join(scratch.dir, "build", "cache"));
    } finally {
      scratch.dispose();
      await rm(scratch.dir, { recursive: true, force: true });
    }
  });

  it.each([0, 7])("preserves child exit %s when cleanup is irrecoverable and reports once", async exit => {
    const dir = await mkdtemp(join(tmpdir(), "codex-cleanup-test-"));
    const capture = join(dir, "scratch");
    const warning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      const binary = writeFakeCli(dir, { name: "cleanup-cli", codexConfigRead: {}, script: `
        import fs from 'node:fs'; import path from 'node:path';
        const args = process.argv.slice(2), output = args[args.indexOf('-o') + 1];
        fs.writeFileSync(${JSON.stringify(capture)}, path.dirname(output));
        fs.writeFileSync(output, 'original success');
        if (${exit}) { process.stderr.write('original child failure'); process.exit(${exit}); }
      ` });
      mocks.remove.mockImplementationOnce(() => { throw new Error("untrusted cleanup payload"); });
      const result = createCodexCliClient({ codexConfig: { cli_path: binary }, maxRetries: 0 }).complete({ prompt: "test" });
      if (exit) await expect(result).rejects.toThrow("original child failure");
      else expect((await result).text).toBe("original success");
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls[0][1]).toEqual({ code: "NDX_CODEX_SCRATCH_CLEANUP" });
      expect(String(warning.mock.calls[0][0])).not.toContain("untrusted cleanup payload");
    } finally {
      if (existsSync(capture)) await rm(await readFile(capture, "utf8"), { recursive: true, force: true });
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each(["directory", "symlink"])("does not reclaim a root replaced by a %s", async kind => {
    const scratch = createCodexScratch();
    const moved = `${scratch.dir}-moved`;
    const warning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      await rename(scratch.dir, moved);
      if (kind === "symlink") await symlink(moved, scratch.dir, process.platform === "win32" ? "junction" : "dir");
      else await mkdir(scratch.dir);
      await writeFile(join(scratch.dir, "keep"), "another owner");
      scratch.dispose();
      scratch.dispose();
      expect(await readFile(join(scratch.dir, "keep"), "utf8")).toBe("another owner");
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      scratch.dispose();
      await rm(scratch.dir, { recursive: true, force: true });
      await rm(moved, { recursive: true, force: true });
    }
  });
});
