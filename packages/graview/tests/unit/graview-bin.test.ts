import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateRepoTrust, recordRepoTrust } from "@n-dx/llm-client";
import { resolveLayout } from "../../src/llm-gateway.js";
import { resolveGraviewCommand, readGraviewConfig, GRAVIEW_BIN_ENV } from "../../src/graview-bin.js";
import { GRAVIEW_VERSION } from "../../src/document.js";

let root: string;
let home: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "graview-bin-"));
  // The trust store is per user; a throwaway one keeps the real one untouched.
  home = mkdtempSync(join(tmpdir(), "graview-bin-home-"));
  vi.stubEnv("NDX_HOME", home);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const noPath = { PATH: "" };

function git(...args: string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root, stdio: "ignore" });
}

describe("resolveGraviewCommand", () => {
  it("falls back to npx pinned to the checked release when nothing is configured or on PATH", () => {
    const command = resolveGraviewCommand(resolveLayout(root), { env: noPath, platform: "linux" });
    expect(command).toMatchObject({ cmd: "npx", prefix: ["-y", `graview@${GRAVIEW_VERSION}`], source: "npx" });
    expect(resolveGraviewCommand(resolveLayout(root), { env: noPath, platform: "win32" }).cmd).toBe("npx.cmd");
  });

  it("prefers graview.bin from a trusted project config, and runs a .js entry under the current Node", () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { bin: "../graview/packages/graview/dist/cli.js" } }));
    recordRepoTrust(root);
    const command = resolveGraviewCommand(resolveLayout(root), { env: noPath, platform: "linux" });
    expect(command.source).toBe("config");
    expect(command.cmd).toBe(process.execPath);
    expect(command.prefix).toEqual([join(root, "..", "graview", "packages", "graview", "dist", "cli.js")]);
  });

  it("lets the machine-local config override the shared one, and reads includeFiles", () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { bin: "graview", includeFiles: false } }));
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ graview: { bin: "/opt/graview/bin/graview", includeFiles: true, mainRef: " upstream/main ", proposeProductLayer: false } }));
    const layout = resolveLayout(root);
    expect(readGraviewConfig(layout)).toEqual({ bin: "/opt/graview/bin/graview", includeFiles: true, mainRef: "upstream/main", proposeProductLayer: false });
    const command = resolveGraviewCommand(layout, { env: noPath, platform: "linux" });
    expect(command).toMatchObject({ cmd: "/opt/graview/bin/graview", prefix: [], source: "config" });
  });

  it("reads the .ndx layout's config.json", () => {
    mkdirSync(join(root, ".ndx"));
    writeFileSync(join(root, ".ndx", "config.json"), JSON.stringify({ graview: { bin: "gv" } }));
    recordRepoTrust(root);
    expect(resolveGraviewCommand(resolveLayout(root), { env: noPath, platform: "linux" })).toMatchObject({ cmd: "gv", source: "config" });
  });

  it("takes NDX_GRAVIEW_BIN before PATH", () => {
    const bin = mkdtempSync(join(tmpdir(), "graview-path-"));
    writeFileSync(join(bin, "graview"), "#!/bin/sh\n");
    try {
      const env = { PATH: bin, [GRAVIEW_BIN_ENV]: "/elsewhere/graview" };
      expect(resolveGraviewCommand(resolveLayout(root), { env, platform: "linux" })).toMatchObject({ cmd: "/elsewhere/graview", source: "env" });
      expect(resolveGraviewCommand(resolveLayout(root), { env: { PATH: bin }, platform: "linux" })).toMatchObject({ cmd: join(bin, "graview"), source: "path" });
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it("takes the product face's own graview before npx, and never before PATH", () => {
    const face = join(root, "face");
    mkdirSync(join(face, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(face, "node_modules", ".bin", "graview"), "#!/bin/sh\n");
    const layout = resolveLayout(root);
    expect(resolveGraviewCommand(layout, { env: noPath, platform: "linux", face })).toMatchObject({ cmd: join(face, "node_modules", ".bin", "graview"), source: "face" });
    expect(resolveGraviewCommand(layout, { env: noPath, platform: "linux", face: join(root, "nowhere") }).source).toBe("npx");
    const bin = mkdtempSync(join(tmpdir(), "graview-path-"));
    writeFileSync(join(bin, "graview"), "#!/bin/sh\n");
    try {
      expect(resolveGraviewCommand(layout, { env: { PATH: bin }, platform: "linux", face }).source).toBe("path");
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it("resolves graview.app against the project root", () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { app: "../my-face" } }));
    expect(readGraviewConfig(resolveLayout(root)).app).toBe(join(root, "..", "my-face"));
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { app: "/opt/face" } }));
    expect(readGraviewConfig(resolveLayout(root)).app).toBe("/opt/face");
  });

  it("ignores a malformed config file", () => {
    writeFileSync(join(root, ".n-dx.json"), "{ not json");
    expect(readGraviewConfig(resolveLayout(root))).toEqual({});
  });
});

describe("a repository's graview.bin waits for trust (#635 follow-up)", () => {
  const env = { PATH: "", [GRAVIEW_BIN_ENV]: "/user/graview" };

  it("is a vendor-cli-path finding in the digest, and the shared value is not used while untrusted", () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { bin: "./tools/graview", includeFiles: false } }));
    const ev = evaluateRepoTrust(root);
    expect(ev.state).toBe("untrusted");
    expect(ev.findings.find((f) => f.code === "vendor-cli-path")?.values).toEqual(["graview.bin = ./tools/graview"]);
    expect(ev.config.vendorCliPaths).toEqual(["graview.bin = ./tools/graview"]);

    // Only `bin` is gated; the rest of the section still applies.
    expect(readGraviewConfig(resolveLayout(root))).toEqual({ includeFiles: false });
    expect(resolveGraviewCommand(resolveLayout(root), { env, platform: "linux" })).toMatchObject({ cmd: "/user/graview", source: "env" });
  });

  it("applies once the checkout is trusted, and waits again when it changes", () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { bin: "./tools/graview" } }));
    const before = evaluateRepoTrust(root).config.digest;
    recordRepoTrust(root);
    expect(resolveGraviewCommand(resolveLayout(root), { env, platform: "linux" })).toMatchObject({ cmd: join(root, "tools", "graview"), source: "config" });

    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { bin: "./tools/other" } }));
    expect(evaluateRepoTrust(root).config.digest).not.toBe(before);
    expect(resolveGraviewCommand(resolveLayout(root), { env, platform: "linux" }).source).toBe("env");
  });

  it("gates a graview.bin in a git-tracked .n-dx.local.json until trusted", () => {
    git("init", "-q");
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ graview: { bin: "./tools/graview" } }));
    git("add", ".n-dx.local.json");
    git("commit", "-q", "-m", "ship local config");

    const ev = evaluateRepoTrust(root);
    expect(ev.state).toBe("untrusted");
    expect(ev.config.vendorCliPaths).toEqual(["graview.bin = ./tools/graview"]);
    expect(resolveGraviewCommand(resolveLayout(root), { env, platform: "linux" }).source).toBe("env");

    recordRepoTrust(root);
    expect(resolveGraviewCommand(resolveLayout(root), { env, platform: "linux" })).toMatchObject({ source: "config", cmd: join(root, "tools", "graview") });
  });

  it("keeps applying a graview.bin in an untracked .n-dx.local.json without trust", () => {
    git("init", "-q");
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ graview: { bin: "/opt/graview" } }));
    expect(evaluateRepoTrust(root).state).toBe("baseline");
    expect(resolveGraviewCommand(resolveLayout(root), { env, platform: "linux" })).toMatchObject({ cmd: "/opt/graview", source: "config" });
  });
});
