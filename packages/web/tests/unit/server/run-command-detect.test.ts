/**
 * Detection of a project's run and build commands.
 *
 * This list is also the allowlist the run route executes from, so what it
 * does and does not offer is a security property, not only a convenience:
 * nothing can be run that detection did not produce.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  detectCommands,
  detectPackageManager,
  findLocalUrl,
  stripAnsi,
} from "../../../src/server/run-command-detect.js";

describe("run command detection", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "run-cmd-detect-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const pkg = (scripts: Record<string, string>, extra: Record<string, unknown> = {}) =>
    writeFile(join(dir, "package.json"), JSON.stringify({ name: "x", scripts, ...extra }));

  describe("package manager", () => {
    it("prefers the lockfile, which is what the project installs with", async () => {
      await pkg({ dev: "vite" }, { packageManager: "npm@10.0.0" });
      await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
      expect(detectPackageManager(dir)).toBe("pnpm");
    });

    it("falls back to the packageManager field", async () => {
      await pkg({ dev: "vite" }, { packageManager: "yarn@4.1.0" });
      expect(detectPackageManager(dir)).toBe("yarn");
    });

    it("falls back to npm, which ships with node", async () => {
      await pkg({ dev: "vite" });
      expect(detectPackageManager(dir)).toBe("npm");
    });

    it("refuses a packageManager the repo invented, rather than spawning it", async () => {
      // package.json is untrusted repo content and is not covered by repo
      // trust, so an unrecognised name must never reach spawn.
      for (const declared of [
        "C:/Users/me/Downloads/evil.exe",
        "./node_modules/.bin/evil",
        "/bin/sh",
        "evil",
      ]) {
        await pkg({ dev: "vite" }, { packageManager: declared });
        expect(detectPackageManager(dir), declared).toBe("npm");
      }
    });

    it("still honours a real package manager declaration", async () => {
      for (const [declared, expected] of [
        ["pnpm@9.0.0", "pnpm"],
        ["yarn@4.1.0", "yarn"],
        ["bun@1.1.0", "bun"],
      ]) {
        await pkg({ dev: "vite" }, { packageManager: declared });
        expect(detectPackageManager(dir), declared).toBe(expected);
      }
    });
  });

  describe("npm scripts", () => {
    it("offers known run and build scripts, and ignores the rest", async () => {
      await pkg({ dev: "vite", build: "tsc", test: "vitest", lint: "eslint ." });
      const ids = detectCommands(dir).map((c) => c.id);
      expect(ids).toContain("npm:dev");
      expect(ids).toContain("npm:build");
      expect(ids).not.toContain("npm:test");
      expect(ids).not.toContain("npm:lint");
    });

    it("spawns through the detected package manager", async () => {
      await pkg({ dev: "vite" });
      await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
      const dev = detectCommands(dir).find((c) => c.id === "pnpm:dev")!;
      expect(dev.bin).toBe("pnpm");
      expect(dev.args).toEqual(["run", "dev"]);
      expect(dev.label).toBe("pnpm run dev");
      expect(dev.kind).toBe("run");
    });

    it("puts dev before start, so the default offer is the dev server", async () => {
      await pkg({ start: "node server.js", dev: "vite" });
      const runs = detectCommands(dir).filter((c) => c.kind === "run");
      expect(runs[0].id).toBe("npm:dev");
    });

    it("offers nothing for a manifest it cannot parse", async () => {
      await writeFile(join(dir, "package.json"), "{ not json");
      expect(detectCommands(dir)).toEqual([]);
    });

    it("offers nothing when there are no scripts at all", async () => {
      await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x" }));
      expect(detectCommands(dir)).toEqual([]);
    });
  });

  describe("other ecosystems", () => {
    it("detects a Rust project", async () => {
      await writeFile(join(dir, "Cargo.toml"), "[package]\nname = \"x\"\n");
      const ids = detectCommands(dir).map((c) => c.id);
      expect(ids).toEqual(["cargo:run", "cargo:build"]);
    });

    it("detects a Go project", async () => {
      await writeFile(join(dir, "go.mod"), "module x\n");
      const cmds = detectCommands(dir);
      expect(cmds.find((c) => c.id === "go:run")!.args).toEqual(["run", "."]);
    });

    it("detects a Python entry point, preferring the conventional one", async () => {
      await writeFile(join(dir, "pyproject.toml"), "[project]\nname = \"x\"\n");
      await writeFile(join(dir, "main.py"), "print(1)\n");
      const cmd = detectCommands(dir)[0];
      expect(cmd.args).toEqual(["main.py"]);
      expect(cmd.kind).toBe("run");
    });

    it("offers no Python command without a recognisable entry point", async () => {
      await writeFile(join(dir, "pyproject.toml"), "[project]\nname = \"x\"\n");
      expect(detectCommands(dir)).toEqual([]);
    });

    it("detects Makefile targets but not variable assignments", async () => {
      await writeFile(join(dir, "Makefile"), "build:\n\tgo build\n\nrun :=notatarget\n");
      const ids = detectCommands(dir).map((c) => c.id);
      expect(ids).toContain("make:build");
      expect(ids).not.toContain("make:run");
    });
  });

  it("never returns two commands with the same id", async () => {
    await pkg({ dev: "vite", build: "tsc" });
    await writeFile(join(dir, "Makefile"), "build:\n\tgo build\n");
    const ids = detectCommands(dir).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("findLocalUrl", () => {
  it("reads the port the process actually announced", () => {
    expect(findLocalUrl("  ➜  Local:   http://localhost:5174/\n")).toBe("http://localhost:5174/");
  });

  it("reports a wildcard bind as localhost, which is what opens", () => {
    expect(findLocalUrl("listening on http://0.0.0.0:8080")).toBe("http://localhost:8080");
  });

  it("handles 127.0.0.1 and https", () => {
    expect(findLocalUrl("https://127.0.0.1:443/app")).toBe("https://localhost:443/app");
  });

  it("returns null when nothing was announced", () => {
    expect(findLocalUrl("compiled successfully in 412ms")).toBeNull();
  });

  it("reads a port the dev server printed in bold (Vite)", () => {
    const vite = "  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\n";
    expect(findLocalUrl(vite)).toBe("http://localhost:5173/");
  });

  it("does not read a colour reset after the URL as part of its path", () => {
    expect(findLocalUrl("ready on \x1b[4mhttp://localhost:3000/app\x1b[24m\n")).toBe("http://localhost:3000/app");
  });

  it("ignores a remote URL", () => {
    expect(findLocalUrl("see https://example.com:8080/docs")).toBeNull();
  });
});

describe("stripAnsi", () => {
  it("removes colour, cursor and title sequences and keeps the text", () => {
    const text = "\x1b]0;vite\x07\x1b[2K\x1b[1G\x1b[31merror\x1b[0m done\x1bc";
    expect(stripAnsi(text)).toBe("error done");
  });
});
