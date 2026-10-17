---
id: "069950b8-890f-4f18-8b20-bda87ddf1420"
level: "task"
title: "Pin and verify the WASM toolchain the grammar build downloads"
status: "pending"
priority: "high"
tags:
  - "review-fixes"
  - "security"
  - "supply-chain"
  - "lang-runtime"
  - "pr-20"
source: "review"
acceptanceCriteria:
  - "wasi-sdk and binaryen are fetched through fetchVerified with per-platform SHA-256 pins and handed to the CLI by env, so it downloads nothing itself"
  - "The main-module guard works through a symlinked script path"
  - "Header and changeset describe the verification accurately; build:grammars still builds every grammar"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block the network, so the agent cannot fetch the archives to compute their SHA-256s. If it cannot, write the code and tests with the digests left as clearly named constants the session fills in, and say so in the log; the session will fetch the pinned archives, compute and insert the digests, and run build:grammars to confirm. Do not invent digests."}
description: "Stack review (#760, packages/lang-runtime/scripts/build-grammars.mjs, around line 208 at the stack top). `tree-sitter build --wasm` downloads two toolchains with `curl -f -L` and checks neither digest:\n- wasi-sdk 34.0 (clang);\n- binaryen version_132 (wasm-opt).\n\nSee tree-sitter v0.27.0 crates/loader/src/loader.rs (ensure_wasi_sdk_exists, ensure_binaryen_exists, download_tool). Both are extracted into ~/.cache/tree-sitter, executed, and produce the .wasm that ships in the published @n-dx/lang-* packs, and CI caches ~/.cache/tree-sitter across runs. The header says every download is pinned and checked against its SHA-256, which is false for these two; binaryen is not mentioned at all.\n\nFix:\n- fetch both archives through the script's fetchVerified, with per-platform SHA-256 pins next to TREE_SITTER_CLI;\n- extract them under the package's build/cache;\n- pass TREE_SITTER_WASI_SDK_PATH and TREE_SITTER_BINARYEN_PATH in the spawnSync env, so the CLI (get_existing_tool) never downloads anything;\n- correct the header and the changeset.\n\nAlso fix the main-module guard (around line 242): Node resolves the ESM main module to its real path but argv[1] is only path.resolve'd. Run through a symlinked path (macOS /tmp → /private/tmp, a symlinked workspace) and the guard is false: main() never runs, nothing prints, the exit code is 0 and no grammar is built. Use `pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url`.\n\nTests: the pins table covers every platform the CLI pins, the env carries both paths, and the guard is true through a symlinked path."
lastModified: "2026-10-17T09:21:38.285Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
