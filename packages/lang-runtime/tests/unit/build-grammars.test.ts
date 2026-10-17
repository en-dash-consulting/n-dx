/** The grammar build script's options: where grammars land and which are built. */

import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  GRAMMARS,
  TOOLCHAIN_PLATFORM,
  TREE_SITTER_CLI,
  WASM_TOOLCHAIN,
  grammarWasmPath,
  isMainModule,
  parseBuildArgs,
  toolchainEnv,
} from "../../scripts/build-grammars.mjs";

const SCRIPT = fileURLToPath(new URL("../../scripts/build-grammars.mjs", import.meta.url));

describe("build-grammars WASM toolchain", () => {
  it("maps every platform the CLI is pinned for, and no other", () => {
    expect(Object.keys(TOOLCHAIN_PLATFORM).sort()).toEqual(Object.keys(TREE_SITTER_CLI.sha256).sort());
  });

  it("pins wasi-sdk and binaryen for every platform that builds WASM, and only those", () => {
    const platforms = Object.values(TOOLCHAIN_PLATFORM).filter((p) => p !== null).sort();
    expect(platforms).toEqual(["arm64-linux", "arm64-macos", "arm64-windows", "x86_64-linux", "x86_64-macos", "x86_64-windows"]);
    for (const toolchain of Object.values(WASM_TOOLCHAIN)) {
      expect(Object.keys(toolchain.sha256).sort()).toEqual(platforms);
      for (const pin of Object.values(toolchain.sha256)) expect(pin).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("fetches the archives the CLI would fetch", () => {
    const wasi = WASM_TOOLCHAIN["wasi-sdk"];
    const binaryen = WASM_TOOLCHAIN.binaryen;
    expect(wasi.url(wasi.version, "arm64-linux")).toBe(
      "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-arm64-linux.tar.gz",
    );
    expect(binaryen.url(binaryen.version, "arm64-linux")).toBe(
      "https://github.com/WebAssembly/binaryen/releases/download/version_132/binaryen-version_132-aarch64-linux.tar.gz",
    );
    expect(binaryen.url(binaryen.version, "x86_64-macos")).toMatch(/binaryen-version_132-x86_64-macos\.tar\.gz$/);
  });

  it("hands both toolchains to the CLI by env, so it downloads neither", () => {
    const env = toolchainEnv({ "wasi-sdk": "/cache/wasi", binaryen: "/cache/binaryen" }, { PATH: "/bin" });
    expect(env).toEqual({ PATH: "/bin", TREE_SITTER_WASI_SDK_PATH: "/cache/wasi", TREE_SITTER_BINARYEN_PATH: "/cache/binaryen" });
    expect(() => toolchainEnv({ "wasi-sdk": "/cache/wasi" }, {})).toThrow(/binaryen.*TREE_SITTER_BINARYEN_PATH/);
  });
});

describe("build-grammars main-module guard", () => {
  it("is true for the script's own path and false for another", () => {
    const url = pathToFileURL(realpathSync(SCRIPT)).href;
    expect(isMainModule(SCRIPT, url)).toBe(true);
    expect(isMainModule(join(dirname(SCRIPT), "update-pack-goldens.mjs"), url)).toBe(false);
    expect(isMainModule(undefined, url)).toBe(false);
  });

  it("runs main through a symlinked path", () => {
    const dir = mkdtempSync(join(tmpdir(), "build-grammars-"));
    try {
      const link = join(dir, "scripts");
      symlinkSync(dirname(SCRIPT), link, "junction");
      const linked = join(link, "build-grammars.mjs");
      expect(isMainModule(linked, pathToFileURL(realpathSync(SCRIPT)).href)).toBe(true);
      // Without --out, main fails before any download: proof it ran.
      const run = spawnSync(process.execPath, [linked], { encoding: "utf8" });
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/--out <dir> is required/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("build-grammars options", () => {
  it("builds into --out, resolved against the working directory", () => {
    expect(parseBuildArgs(["--out", "some/dir"]).outDir).toBe(resolve("some/dir"));
    expect(grammarWasmPath("tree-sitter-go", "/packs/go/build/grammars")).toBe(join("/packs/go/build/grammars", "tree-sitter-go.wasm"));
  });

  it("builds every grammar into --out when none is named", () => {
    expect(parseBuildArgs(["--out", "out"]).names).toEqual(Object.keys(GRAMMARS));
  });

  it("builds nothing without --out: each grammar belongs to one pack", () => {
    expect(() => parseBuildArgs([])).toThrow(/--out <dir> is required/);
    expect(() => parseBuildArgs(["tree-sitter-go"])).toThrow(/--out <dir> is required/);
  });

  it("builds only the grammars named", () => {
    expect(parseBuildArgs(["--out", "out", "tree-sitter-go", "tree-sitter-sql"]).names).toEqual(["tree-sitter-go", "tree-sitter-sql"]);
  });

  it("refuses an unknown grammar, naming the known ones", () => {
    expect(() => parseBuildArgs(["--out", "out", "tree-sitter-cobol"])).toThrow(/Unknown grammar tree-sitter-cobol; known: tree-sitter-java/);
  });
});
