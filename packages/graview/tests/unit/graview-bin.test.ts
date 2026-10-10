import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveLayout } from "../../src/llm-gateway.js";
import { resolveGraviewCommand, readGraviewConfig, GRAVIEW_BIN_ENV } from "../../src/graview-bin.js";
import { GRAVIEW_VERSION } from "../../src/document.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "graview-bin-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const noPath = { PATH: "" };

describe("resolveGraviewCommand", () => {
  it("falls back to npx pinned to the checked release when nothing is configured or on PATH", () => {
    const command = resolveGraviewCommand(resolveLayout(root), { env: noPath, platform: "linux" });
    expect(command).toMatchObject({ cmd: "npx", prefix: ["-y", `graview@${GRAVIEW_VERSION}`], source: "npx" });
    expect(resolveGraviewCommand(resolveLayout(root), { env: noPath, platform: "win32" }).cmd).toBe("npx.cmd");
  });

  it("prefers graview.bin from the project config, and runs a .js entry under the current Node", () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { bin: "../graview/packages/graview/dist/cli.js" } }));
    const command = resolveGraviewCommand(resolveLayout(root), { env: noPath, platform: "linux" });
    expect(command.source).toBe("config");
    expect(command.cmd).toBe(process.execPath);
    expect(command.prefix).toEqual([join(root, "..", "graview", "packages", "graview", "dist", "cli.js")]);
  });

  it("lets the machine-local config override the shared one, and reads includeFiles", () => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ graview: { bin: "graview", includeFiles: false } }));
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ graview: { bin: "/opt/graview/bin/graview", includeFiles: true, mainRef: " upstream/main " } }));
    const layout = resolveLayout(root);
    expect(readGraviewConfig(layout)).toEqual({ bin: "/opt/graview/bin/graview", includeFiles: true, mainRef: "upstream/main" });
    const command = resolveGraviewCommand(layout, { env: noPath, platform: "linux" });
    expect(command).toMatchObject({ cmd: "/opt/graview/bin/graview", prefix: [], source: "config" });
  });

  it("reads the .ndx layout's config.json", () => {
    mkdirSync(join(root, ".ndx"));
    writeFileSync(join(root, ".ndx", "config.json"), JSON.stringify({ graview: { bin: "gv" } }));
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
