/** Ask the installed hench CLI for the shared trust classifier; core never imports its library. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSyncCli } from "./win-spawn.js";

const require = createRequire(import.meta.url);

/**
 * Fail closed when classification cannot answer. Paths are git's spelling,
 * including case variants and symlink targets, never the configured binary.
 * @param {string} root
 * @returns {{ tracked: boolean, paths: string[], unanswered: boolean, nestedIn: string|null }}
 */
export function localConfigStatus(root) {
  try {
    let cli;
    try { cli = require.resolve("@n-dx/hench/dist/cli/index.js"); }
    catch { cli = fileURLToPath(new URL("../hench/dist/cli/index.js", import.meta.url)); }
    const output = execFileSyncCli(process.execPath, [cli, "trust", "status", "--format=json", root], {
      encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000,
    });
    const config = JSON.parse(String(output))?.config;
    if (typeof config?.localConfigTracked !== "boolean") throw new Error("missing classification");
    return {
      tracked: config.localConfigTracked,
      paths: Array.isArray(config.localConfigTrackedPaths) ? config.localConfigTrackedPaths.filter((p) => typeof p === "string") : [],
      unanswered: Boolean(config.localConfigUnanswered),
      nestedIn: typeof config.localConfigNestedIn === "string" ? config.localConfigNestedIn : null,
    };
  } catch { return { tracked: true, paths: [], unanswered: true, nestedIn: null }; }
}
