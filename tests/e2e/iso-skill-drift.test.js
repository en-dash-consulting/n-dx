/**
 * Iso-map skill drift regression.
 *
 * `.claude/skills/iso-map/scripts/iso-map.mjs` is a build artifact, bundled
 * from `packages/sourcevision/src/export/` by `scripts/build-iso-skill.mjs`.
 * It has to be a committed, dependency-free single file so the skill can be
 * published and run in any repository — but that means the same layout,
 * routing and rendering logic exists in two places on disk, and nothing stops
 * them diverging.
 *
 * They did diverge once: a hand-maintained copy of the skill disagreed with the
 * package on two zone colours because it counted archetypes before mapping them
 * to kinds instead of after. Nobody would have noticed without comparing two
 * maps of the same repository side by side.
 *
 * This test closes that: edit the TypeScript and forget to rebuild, or
 * hand-edit the generated file, and it fails.
 *
 * If it fails, run:  node scripts/build-iso-skill.mjs
 *
 * @see tests/e2e/assistant-body-drift.test.js — the same pattern for CLAUDE.md
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildIsoSkill } from "../../scripts/build-iso-skill.mjs";

const ROOT = join(import.meta.dirname, "../..");
const SKILL_DIR = join(ROOT, ".claude/skills/iso-map");
const SCRIPT = join(SKILL_DIR, "scripts/iso-map.mjs");
const BUILDER = join(ROOT, "scripts/build-iso-skill.mjs");

describe("iso-map skill", { timeout: 120_000 }, () => {
  it("the committed bundle matches what the generator produces", async () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const committed = readFileSync(SCRIPT, "utf-8");
    const generated = await buildIsoSkill();
    expect(
      committed === generated,
      "The committed iso-map skill script is out of date with " +
        "packages/sourcevision/src/export/. Run: node scripts/build-iso-skill.mjs",
    ).toBe(true);
  });

  it("is marked as generated so nobody hand-edits it", () => {
    const head = readFileSync(SCRIPT, "utf-8").slice(0, 600);
    expect(head).toContain("GENERATED FILE");
    expect(head).toContain("scripts/build-iso-skill.mjs");
  });

  it("declares no runtime dependencies beyond node builtins", () => {
    const source = readFileSync(SCRIPT, "utf-8");
    const imports = [...source.matchAll(/^import .*? from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec.startsWith("node:"), `unexpected runtime dependency: ${spec}`).toBe(true);
    }
  });

  // The suite otherwise imports buildIsoSkill() directly, so the CLI path was
  // never executed. That let an entrypoint guard comparing import.meta.url to
  // `file://${argv[1]}` ship: it never matched on Windows, so the script exited
  // 0 having done nothing, while CLAUDE.md, the generated banner and this
  // test's own failure message all told you to run it.
  it("runs as a spawned script rather than exiting silently", () => {
    const out = execFileSync(process.execPath, [BUILDER, "--check"], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 120_000,
    });
    expect(out).toContain("iso-skill: up to date.");
  });

  // Reached through a path containing a space, so this fails on POSIX too and
  // not only on Windows: the old guard concatenated `file://` + argv[1], which
  // leaves the space unencoded, while import.meta.url percent-encodes it.
  it("runs when invoked through a path containing a space", () => {
    const box = mkdtempSync(join(tmpdir(), "iso skill "));
    const linked = join(box, "repo");
    try {
      symlinkSync(ROOT, linked, "dir");
    } catch {
      rmSync(box, { recursive: true, force: true });
      return; // no symlink permission (some CI sandboxes) — nothing to assert
    }
    try {
      const out = execFileSync(
        process.execPath,
        [join(linked, "scripts/build-iso-skill.mjs"), "--check"],
        { cwd: ROOT, encoding: "utf-8", timeout: 120_000 },
      );
      expect(out).toContain("iso-skill: up to date.");
    } finally {
      rmSync(box, { recursive: true, force: true });
    }
  });

  it("reports staleness through the CLI, not just the imported function", async () => {
    const original = readFileSync(SCRIPT, "utf-8");
    writeFileSync(SCRIPT, `${original}\n// drift\n`, "utf-8");
    try {
      let status = 0;
      let output = "";
      try {
        execFileSync(process.execPath, [BUILDER, "--check"], {
          cwd: ROOT,
          encoding: "utf-8",
          timeout: 120_000,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        status = err.status ?? 1;
        output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      }
      expect(status).not.toBe(0);
      expect(output).toContain("out of date");
    } finally {
      writeFileSync(SCRIPT, original, "utf-8");
    }
  });

  it("ships a SKILL.md that points at the script", () => {
    const skill = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");
    expect(skill.startsWith("---")).toBe(true);
    expect(skill).toContain("scripts/iso-map.mjs");
  });
});

// ── The bundle actually runs ────────────────────────────────────────────────

/**
 * Executes the committed artifact rather than the TypeScript it came from.
 * The unit tests cover the logic; these cover the thing that ships.
 */
describe("iso-map skill execution", { timeout: 120_000 }, () => {
  let dir;

  function run(args) {
    return execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf-8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  function runFailing(args) {
    try {
      run(args);
      return { status: 0, output: "" };
    } catch (err) {
      return { status: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "iso-skill-"));
    const files = {
      "src/api/handler.ts": `import { work } from "../core/service";\nexport const h = work;\n`,
      "src/api/router.ts": `import { h } from "./handler";\nexport const r = h;\n`,
      "src/api/mw.ts": "export const mw = 1;\n",
      "src/core/service.ts": `import { save } from "../store/db";\nexport const work = save;\n`,
      "src/core/rules.ts": "export const rules = 1;\n",
      "src/core/calc.ts": "export const calc = 1;\n",
      "src/store/db.ts": "export const save = 1;\n",
      "src/store/model.ts": "export const model = 1;\n",
      "src/store/seed.ts": "export const seed = 1;\n",
    };
    for (const [path, content] of Object.entries(files)) {
      const full = join(dir, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content, "utf-8");
    }
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("scans a project with no analysis and writes a standalone page", () => {
    const out = join(dir, "map.html");
    run([dir, `--out=${out}`, "--analyzed-at=2026-01-01T00:00:00.000Z"]);
    const html = readFileSync(out, "utf-8");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("direct scan");
    // Self-contained: nothing is fetched at runtime.
    expect(html).not.toMatch(/<script[^>]+\ssrc=/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("derives zones and dependency edges from the file tree", () => {
    const model = JSON.parse(
      run([dir, `--out=${join(dir, "m.html")}`, "--json", "--analyzed-at=2026-01-01T00:00:00.000Z"]),
    );
    const names = model.nodes.map((n) => n.name).sort();
    expect(names).toEqual(["Api", "Core", "Store"]);
    const edge = model.edges.find((e) => e.from === "src/api" && e.to === "src/core");
    expect(edge).toBeDefined();
    expect(model.meta.origin).toBe("scan");
  });

  it("produces byte-identical output for an unchanged project", () => {
    const a = join(dir, "a.html");
    const b = join(dir, "b.html");
    const stamp = "--analyzed-at=2026-01-01T00:00:00.000Z";
    run([dir, `--out=${a}`, stamp]);
    run([dir, `--out=${b}`, stamp]);
    expect(readFileSync(a, "utf-8")).toBe(readFileSync(b, "utf-8"));
  });

  it("honours --max-nodes and --no-externals", () => {
    const model = JSON.parse(
      run([dir, `--out=${join(dir, "c.html")}`, "--json", "--max-nodes=1", "--no-externals"]),
    );
    expect(model.nodes.filter((n) => n.kind !== "external")).toHaveLength(1);
    expect(model.nodes.some((n) => n.kind === "external")).toBe(false);
  });

  it("links key files when given a link base", () => {
    const model = JSON.parse(
      run([dir, `--out=${join(dir, "d.html")}`, "--json", "--link-base=https://example.com/blob/x"]),
    );
    const withFiles = model.nodes.find((n) => n.keyFiles.length > 0);
    expect(withFiles.keyFiles[0].url).toMatch(/^https:\/\/example\.com\/blob\/x\//);
  });

  it("prints help and reports bad usage clearly", () => {
    expect(run(["--help"])).toContain("--max-nodes");
    expect(runFailing([dir, "--max-nodes=lots"]).output).toContain("--max-nodes");
    expect(runFailing([dir, "--source=nonsense"]).output).toContain("--source");
    expect(runFailing(["/definitely/not/here"]).output).toContain("Directory not found");
    expect(runFailing([dir, "--source=sourcevision"]).output).toContain("--source=scan");
  });

  it("reports an empty directory instead of writing an empty map", () => {
    const empty = mkdtempSync(join(tmpdir(), "iso-empty-"));
    const { status, output } = runFailing([empty]);
    expect(status).not.toBe(0);
    expect(output).toContain("No source files found");
    rmSync(empty, { recursive: true, force: true });
  });
});
