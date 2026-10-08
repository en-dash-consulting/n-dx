import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIError } from "../../../../src/cli/errors.js";
import { cmdCodeOwners } from "../../../../src/cli/commands/codeowners.js";

const FIXTURE = join(import.meta.dirname, "../../../fixtures/v2-tree");

describe("cmdCodeOwners", () => {
  let repo: string;
  let spies: Array<ReturnType<typeof vi.spyOn>>;

  const writeConfig = (extra: Record<string, unknown>) =>
    writeFileSync(
      join(repo, ".rex", "config.json"),
      JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file", ...extra }),
    );

  beforeEach(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), "rex-codeowners-")));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    mkdirSync(join(repo, ".rex"));
    cpSync(join(FIXTURE, "product"), join(repo, ".rex", "product"), { recursive: true });
    cpSync(join(FIXTURE, "changes"), join(repo, ".rex", "changes"), { recursive: true });
    spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    rmSync(repo, { recursive: true });
  });

  it("generates nothing unless the project opts in", async () => {
    writeConfig({});
    await cmdCodeOwners(repo, {});
    expect(existsSync(join(repo, "CODEOWNERS"))).toBe(false);
    expect(existsSync(join(repo, ".bitbucket", "CODEOWNERS"))).toBe(false);

    writeConfig({ codeOwners: false });
    await cmdCodeOwners(repo, {});
    expect(existsSync(join(repo, "CODEOWNERS"))).toBe(false);
  });

  it("writes both files from the root stewards, GitHub handle in the GitHub file only", async () => {
    writeConfig({ codeOwners: true });
    await cmdCodeOwners(repo, {});

    expect(readFileSync(join(repo, "CODEOWNERS"), "utf-8")).toContain("/.rex/product/checkout/ @shop/core\n");
    const bitbucket = readFileSync(join(repo, ".bitbucket", "CODEOWNERS"), "utf-8");
    expect(bitbucket).not.toContain("@shop/core");
    expect(bitbucket).not.toContain("/.rex/product/checkout/");
  });

  it("regenerates when the stewards change, and --check reports a stale file", async () => {
    writeConfig({ codeOwners: true });
    await cmdCodeOwners(repo, {});
    await cmdCodeOwners(repo, { check: "true" });

    const root = join(repo, ".rex", "product", "index.md");
    writeFileSync(root, readFileSync(root, "utf-8").replace('  - "@shop/core"', '  - "@shop/core"\n  - "ann@example.com"'));
    await expect(cmdCodeOwners(repo, { check: "true" })).rejects.toThrow(CLIError);

    await cmdCodeOwners(repo, {});
    const bitbucket = readFileSync(join(repo, ".bitbucket", "CODEOWNERS"), "utf-8");
    expect(bitbucket).toContain("/.rex/product/checkout/ ann@example.com\n");
    await cmdCodeOwners(repo, { check: "true" });
  });
});
