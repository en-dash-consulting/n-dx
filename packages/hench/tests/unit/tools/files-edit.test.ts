/**
 * edit_file and the write_file shrink guard.
 *
 * API and local models had only a whole-file write_file, so a model changing
 * one line of a large file sent back a stub or an empty string and wiped it.
 * edit_file replaces an exact string; write_file refuses a write that drops
 * most of an existing file unless the call says `rewrite: true`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { ToolGuard } from "../../../src/tools/contracts.js";
import { toolEditFile, toolWriteFile } from "../../../src/tools/files.js";
import { dispatchTool } from "../../../src/tools/dispatch.js";
import { GuardRails } from "../../../src/guard/index.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import type { ToolContext } from "../../../src/tools/contracts.js";

function createToolGuard(
  projectDir: string,
  extra: Partial<Pick<ToolGuard, "writeShrinkRatio" | "writeShrinkMinBytes">> = {},
  log: { reads: string[]; writes: string[] } = { reads: [], writes: [] },
): ToolGuard {
  return {
    checkPath(filepath: string): string {
      const resolved = resolve(projectDir, filepath);
      if (!resolved.startsWith(projectDir) || filepath.startsWith(".git")) {
        const err = new Error(`Path blocked: ${filepath}`);
        err.name = "GuardError";
        throw err;
      }
      return resolved;
    },
    checkCommand(): void {},
    checkGitSubcommand(): void {},
    recordFileRead(p: string): void { log.reads.push(p); },
    recordFileWrite(p: string): void { log.writes.push(p); },
    maxFileSize: 1024 * 1024,
    commandTimeout: 30_000,
    ...extra,
  };
}

/** A file comfortably above the 1 KB exemption. */
function bigSource(eol = "\n"): string {
  const lines: string[] = [];
  for (let i = 0; i < 80; i++) lines.push(`export const value${i} = ${i}; // line ${i}`);
  lines.push("const pattern = /old-regex/;");
  return lines.join(eol) + eol;
}

describe("toolEditFile", () => {
  let projectDir: string;
  let guard: ToolGuard;
  let log: { reads: string[]; writes: string[] };

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-edit-"));
    log = { reads: [], writes: [] };
    guard = createToolGuard(projectDir, {}, log);
    await mkdir(join(projectDir, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("replaces exactly one match and reports its line", async () => {
    await writeFile(join(projectDir, "src/a.ts"), bigSource());
    const out = await toolEditFile(guard, {
      path: "src/a.ts",
      old_string: "/old-regex/",
      new_string: "/new-regex/",
    });
    expect(out).toMatch(/Edited src\/a\.ts: replaced 1 occurrence \(first at line 81\)/);
    const after = await readFile(join(projectDir, "src/a.ts"), "utf-8");
    expect(after).toBe(bigSource().replace("/old-regex/", "/new-regex/"));
    expect(log.reads).toEqual(["src/a.ts"]);
    expect(log.writes).toEqual(["src/a.ts"]);
  });

  it("refuses zero matches, naming the count, and leaves the file alone", async () => {
    await writeFile(join(projectDir, "src/a.ts"), bigSource());
    await expect(
      toolEditFile(guard, { path: "src/a.ts", old_string: "not here", new_string: "x" }),
    ).rejects.toThrow(/found 0 matches/);
    expect(await readFile(join(projectDir, "src/a.ts"), "utf-8")).toBe(bigSource());
    expect(log.writes).toEqual([]);
  });

  it("refuses several matches, naming the count", async () => {
    await writeFile(join(projectDir, "src/a.ts"), "foo();\nfoo();\nfoo();\n");
    await expect(
      toolEditFile(guard, { path: "src/a.ts", old_string: "foo()", new_string: "bar()" }),
    ).rejects.toThrow(/found 3 matches.*replace_all/);
    expect(await readFile(join(projectDir, "src/a.ts"), "utf-8")).toBe("foo();\nfoo();\nfoo();\n");
  });

  it("replaces every match with replace_all", async () => {
    await writeFile(join(projectDir, "src/a.ts"), "foo();\nfoo();\nfoo();\n");
    const out = await toolEditFile(guard, {
      path: "src/a.ts", old_string: "foo()", new_string: "bar()", replace_all: true,
    });
    expect(out).toMatch(/replaced 3 occurrences/);
    expect(await readFile(join(projectDir, "src/a.ts"), "utf-8")).toBe("bar();\nbar();\nbar();\n");
  });

  it("refuses an empty old_string and an unchanged replacement", async () => {
    await writeFile(join(projectDir, "src/a.ts"), "x\n");
    await expect(
      toolEditFile(guard, { path: "src/a.ts", old_string: "", new_string: "y" }),
    ).rejects.toThrow(/non-empty old_string/);
    await expect(
      toolEditFile(guard, { path: "src/a.ts", old_string: "x", new_string: "x" }),
    ).rejects.toThrow(/identical/);
  });

  it("refuses a missing file and points at write_file", async () => {
    await expect(
      toolEditFile(guard, { path: "src/nope.ts", old_string: "a", new_string: "b" }),
    ).rejects.toThrow(/not found.*write_file/);
  });

  it("matches an LF old_string against a CRLF file and keeps CRLF", async () => {
    const crlf = "line one\r\nline two\r\nline three\r\n";
    await writeFile(join(projectDir, "src/w.ts"), crlf);
    await toolEditFile(guard, {
      path: "src/w.ts",
      old_string: "line one\nline two",
      new_string: "line 1\nline 2\nline 2b",
    });
    const after = await readFile(join(projectDir, "src/w.ts"), "utf-8");
    expect(after).toBe("line 1\r\nline 2\r\nline 2b\r\nline three\r\n");
  });

  it("matches a CRLF old_string against an LF file and keeps LF", async () => {
    await writeFile(join(projectDir, "src/u.ts"), "a\nb\nc\n");
    await toolEditFile(guard, { path: "src/u.ts", old_string: "a\r\nb", new_string: "A\r\nB" });
    expect(await readFile(join(projectDir, "src/u.ts"), "utf-8")).toBe("A\nB\nc\n");
  });

  it("goes through the guard: a blocked path is refused before any read", async () => {
    await expect(
      toolEditFile(guard, { path: ".git/config", old_string: "a", new_string: "b" }),
    ).rejects.toThrow(/blocked/);
    expect(log.reads).toEqual([]);
  });

  it("is dispatched, and a GuardRails-blocked path comes back as [GUARD]", async () => {
    const config = DEFAULT_HENCH_CONFIG();
    const rails = new GuardRails(projectDir, config.guard);
    const ctx = { guard: rails, projectDir } as unknown as ToolContext;
    await writeFile(join(projectDir, "src/a.ts"), bigSource());

    const ok = await dispatchTool(ctx, "edit_file", {
      path: "src/a.ts", old_string: "/old-regex/", new_string: "/new-regex/",
    });
    expect(ok).toMatch(/^Edited src\/a\.ts/);

    const blocked = await dispatchTool(ctx, "edit_file", {
      path: ".git/config", old_string: "a", new_string: "b",
    });
    expect(blocked).toMatch(/^\[GUARD\]/);
  });
});

describe("toolWriteFile shrink guard", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-shrink-"));
    await mkdir(join(projectDir, "src"), { recursive: true });
    await writeFile(join(projectDir, "src/big.ts"), bigSource());
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("refuses to blank a large existing file and points at edit_file", async () => {
    const guard = createToolGuard(projectDir);
    for (const content of ["", "/* updated */"]) {
      await expect(
        toolWriteFile(guard, { path: "src/big.ts", content }),
      ).rejects.toThrow(/use edit_file.*rewrite: true/s);
    }
    expect(await readFile(join(projectDir, "src/big.ts"), "utf-8")).toBe(bigSource());
  });

  it("allows the write with rewrite: true", async () => {
    const guard = createToolGuard(projectDir);
    await toolWriteFile(guard, { path: "src/big.ts", content: "export {};\n", rewrite: true });
    expect(await readFile(join(projectDir, "src/big.ts"), "utf-8")).toBe("export {};\n");
  });

  it("allows a write that keeps at least the configured share", async () => {
    const guard = createToolGuard(projectDir);
    const content = bigSource().slice(0, Math.ceil(bigSource().length * 0.6));
    await toolWriteFile(guard, { path: "src/big.ts", content });
    expect(await readFile(join(projectDir, "src/big.ts"), "utf-8")).toBe(content);
  });

  it("allows shrinking a small file and creating a new one", async () => {
    const guard = createToolGuard(projectDir);
    await writeFile(join(projectDir, "src/small.ts"), "x".repeat(900));
    await toolWriteFile(guard, { path: "src/small.ts", content: "" });
    await toolWriteFile(guard, { path: "src/new.ts", content: "" });
    expect(await readFile(join(projectDir, "src/small.ts"), "utf-8")).toBe("");
  });

  it("is disabled by a ratio of 0", async () => {
    const guard = createToolGuard(projectDir, { writeShrinkRatio: 0 });
    await toolWriteFile(guard, { path: "src/big.ts", content: "" });
    expect(await readFile(join(projectDir, "src/big.ts"), "utf-8")).toBe("");
  });

  it("honours a configured ratio and minimum size", async () => {
    const strict = createToolGuard(projectDir, { writeShrinkRatio: 0.9 });
    const content = bigSource().slice(0, Math.ceil(bigSource().length * 0.6));
    await expect(toolWriteFile(strict, { path: "src/big.ts", content })).rejects.toThrow(/edit_file/);

    const lenient = createToolGuard(projectDir, { writeShrinkMinBytes: 1024 * 1024 });
    await toolWriteFile(lenient, { path: "src/big.ts", content: "" });
    expect(await readFile(join(projectDir, "src/big.ts"), "utf-8")).toBe("");
  });

  it("GuardRails carries the hench.guard settings to the tool", async () => {
    const config = DEFAULT_HENCH_CONFIG();
    const on = new GuardRails(projectDir, config.guard);
    const ctx = { guard: on, projectDir } as unknown as ToolContext;
    const refused = await dispatchTool(ctx, "write_file", { path: "src/big.ts", content: "" });
    expect(refused).toMatch(/^\[GUARD\] write_file refused/);

    const off = new GuardRails(projectDir, { ...config.guard, writeShrinkRatio: 0 });
    const ok = await dispatchTool({ guard: off, projectDir } as unknown as ToolContext, "write_file", {
      path: "src/big.ts", content: "",
    });
    expect(ok).toMatch(/^Wrote 0 bytes/);
  });
});
