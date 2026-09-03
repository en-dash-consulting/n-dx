import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");
const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/small-ts-project");

function run(args: string[], cwd?: string): string {
  return execFileSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 60_000,
    cwd,
  });
}

function runExpectingFailure(args: string[]): { status: number; output: string } {
  try {
    const output = run(args);
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

describe("sourcevision iso (e2e)", { timeout: 180_000 }, () => {
  let tmpDir: string;
  let svDir: string;
  let html: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-iso-e2e-"));
    await cp(FIXTURE_DIR, tmpDir, { recursive: true });
    run(["analyze", tmpDir, "--fast"]);
    svDir = join(tmpDir, ".sourcevision");
    run(["iso", tmpDir]);
    html = readFileSync(join(svDir, "iso-map.html"), "utf-8");
  });

  afterAll(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes iso-map.html into .sourcevision/", () => {
    expect(existsSync(join(svDir, "iso-map.html"))).toBe(true);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("is fully self-contained — no external runtime dependencies", () => {
    // Any of these would make the file depend on the network or a sibling file.
    expect(html).not.toMatch(/<script[^>]+\ssrc=/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/@import\s+url/i);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("embeds the model as parseable JSON without breaking the script block", () => {
    const match = html.match(/var MODEL = (\{[\s\S]*?\});\n/);
    expect(match).not.toBeNull();
    const model = JSON.parse(
      match![1].replace(/\\u003c/g, "<").replace(/\\u003e/g, ">"),
    );
    expect(Array.isArray(model.nodes)).toBe(true);
    expect(model.nodes.length).toBeGreaterThan(0);
    // The raw JSON must never contain a literal closing script tag.
    expect(match![1]).not.toContain("</script");
  });

  it("draws a block and a legend entry for every node kind present", () => {
    const match = html.match(/var MODEL = (\{[\s\S]*?\});\n/)!;
    const model = JSON.parse(
      match[1].replace(/\\u003c/g, "<").replace(/\\u003e/g, ">"),
    );
    const legendKinds = [...html.matchAll(/data-kind="([^"]+)"/g)].map((m) => m[1]);
    for (const node of model.nodes) {
      expect(legendKinds).toContain(node.kind);
    }
  });

  it("states the analysis gaps in the rendered page", () => {
    expect(html).toContain("What this map does and does not show");
    expect(html).toMatch(/runtime data flow|runtime call counts/);
  });

  it("honours --max-nodes", () => {
    run(["iso", tmpDir, "--max-nodes=1", "-o=" + join(tmpDir, "one.html")]);
    const one = readFileSync(join(tmpDir, "one.html"), "utf-8");
    const match = one.match(/var MODEL = (\{[\s\S]*?\});\n/)!;
    const model = JSON.parse(
      match[1].replace(/\\u003c/g, "<").replace(/\\u003e/g, ">"),
    );
    const zoneNodes = model.nodes.filter((n: { kind: string }) => n.kind !== "external");
    expect(zoneNodes).toHaveLength(1);
  });

  it("honours --no-externals", () => {
    run(["iso", tmpDir, "--no-externals", "-o=" + join(tmpDir, "bare.html")]);
    const bare = readFileSync(join(tmpDir, "bare.html"), "utf-8");
    const match = bare.match(/var MODEL = (\{[\s\S]*?\});\n/)!;
    const model = JSON.parse(
      match[1].replace(/\\u003c/g, "<").replace(/\\u003e/g, ">"),
    );
    expect(model.nodes.some((n: { kind: string }) => n.kind === "external")).toBe(false);
  });

  it("rejects a non-numeric --max-nodes", () => {
    const { status, output } = runExpectingFailure(["iso", tmpDir, "--max-nodes=lots"]);
    expect(status).not.toBe(0);
    expect(output).toContain("--max-nodes");
  });

  it("fails with guidance when the output directory does not exist", () => {
    const { status, output } = runExpectingFailure([
      "iso",
      tmpDir,
      "-o=" + join(tmpDir, "nope", "map.html"),
    ]);
    expect(status).not.toBe(0);
    expect(output).toContain("Output directory does not exist");
  });

  it("fails with guidance when analysis has not been run", async () => {
    const empty = await mkdtemp(join(tmpdir(), "sv-iso-empty-"));
    mkdirSync(join(empty, ".sourcevision"));
    const { status, output } = runExpectingFailure(["iso", empty]);
    expect(status).not.toBe(0);
    expect(output).toMatch(/manifest\.json is missing|No analysis data/);
    await rm(empty, { recursive: true, force: true });
  });

  it("is not produced by analyze on its own", async () => {
    const fresh = await mkdtemp(join(tmpdir(), "sv-iso-analyze-"));
    await cp(FIXTURE_DIR, fresh, { recursive: true });
    run(["analyze", fresh, "--fast"]);
    expect(existsSync(join(fresh, ".sourcevision", "iso-map.html"))).toBe(false);
    await rm(fresh, { recursive: true, force: true });
  });

  it("appears in CLI help", () => {
    expect(run(["--help"])).toContain("sourcevision iso");
    expect(run(["iso", "--help"])).toContain("--max-nodes");
  });

  it("regenerates byte-identical output for unchanged analysis data", () => {
    run(["iso", tmpDir, "-o=" + join(tmpDir, "a.html")]);
    run(["iso", tmpDir, "-o=" + join(tmpDir, "b.html")]);
    expect(readFileSync(join(tmpDir, "a.html"), "utf-8")).toBe(
      readFileSync(join(tmpDir, "b.html"), "utf-8"),
    );
  });

  it("scans the file tree when asked, without touching the analysis", () => {
    const out = join(tmpDir, "scan.html");
    run(["iso", tmpDir, "--source=scan", "-o=" + out, "--analyzed-at=2026-01-01T00:00:00.000Z"]);
    const scanned = readFileSync(out, "utf-8");
    expect(scanned).toContain("direct scan");
    expect(scanned).toContain("inferred from directory structure");
  });

  it("scans a project that was never analyzed", async () => {
    const bare = await mkdtemp(join(tmpdir(), "sv-iso-bare-"));
    await cp(FIXTURE_DIR, bare, { recursive: true });
    const out = join(bare, "map.html");
    run(["iso", bare, "--source=scan", "-o=" + out]);
    expect(existsSync(out)).toBe(true);
    await rm(bare, { recursive: true, force: true });
  });

  it("stamps a caller-supplied timestamp for reproducible output", () => {
    const out = join(tmpDir, "stamped.html");
    run(["iso", tmpDir, "-o=" + out, "--analyzed-at=2020-05-05T05:05:05.000Z"]);
    expect(readFileSync(out, "utf-8")).toContain("2020-05-05T05:05:05.000Z");
  });

  it("links key files when given a link base", () => {
    const out = join(tmpDir, "linked.html");
    run(["iso", tmpDir, "-o=" + out, "--link-base=https://example.com/blob/main"]);
    expect(readFileSync(out, "utf-8")).toContain("https://example.com/blob/main/");
  });

  it("rejects an unknown --source", () => {
    const { status, output } = runExpectingFailure(["iso", tmpDir, "--source=nonsense"]);
    expect(status).not.toBe(0);
    expect(output).toContain("--source");
  });

  it("follows the reader's colour scheme and reduced-motion preference", () => {
    expect(html).toContain("prefers-color-scheme: light");
    expect(html).toContain("prefers-reduced-motion");
  });
});
