/** Admission for the exact host-audited Codex hub profile. Never project-configurable. */
import { constants, accessSync, closeSync, createReadStream, fstatSync, ftruncateSync, lstatSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSyncCli, resolveVendorCliEnv } from "@n-dx/llm-client";
import { resolveSidecarSessionEnv } from "./session-env.js";
import { readSidecarCodexProvider } from "./codex-provider.js";
import { CODEX_HUB_BINARY, CODEX_HUB_SHA256, CODEX_HUB_VERSION, CODEX_HUB_REQUIREMENT, codexUserProviderRefusal } from "./spawn-policy.js";
export { CODEX_HUB_VERSION } from "./spawn-policy.js";

/** Resolve with the same filtered PATH the child receives, retaining the original alias. */
function executablePath(binary: string, env: NodeJS.ProcessEnv): string {
  const paths = isAbsolute(binary) ? [binary] : binary.includes("/") ? []
    : (env.PATH ?? "").split(delimiter).filter(isAbsolute).map((dir) => join(dir, binary));
  for (const path of paths) {
    try { accessSync(path, constants.X_OK); } catch { continue; }
    if (lstatSync(realpathSync(path)).isFile()) return path;
  }
  throw new Error(`Codex hub executable is unavailable. ${CODEX_HUB_REQUIREMENT}`);
}

let verifiedStamp: string | undefined;

export async function admitCodexHub(projectDir: string) {
  if (process.platform !== "darwin") throw new Error(CODEX_HUB_REQUIREMENT);
  const settings = await resolveSidecarSessionEnv(projectDir);
  const selectedProvider = readSidecarCodexProvider(process.env, settings.envPolicy);
  const env = resolveVendorCliEnv({ ...settings.llmConfig, vendor: "codex",
    ...(selectedProvider.provider !== "openai" && { codex: { ...settings.llmConfig.codex, auth: "cli" as const } }),
  }, settings.envPolicy);
  for (const name of Object.keys(env)) {
    if (selectedProvider.sourceNames.includes(name) || Object.values(selectedProvider.env).includes(env[name] ?? "")) delete env[name];
  }
  const provider = readSidecarCodexProvider(env, settings.envPolicy);
  const refusal = codexUserProviderRefusal(env);
  if (refusal) throw new Error(refusal);
  const selected = settings.llmConfig.codex?.cli_path ?? "codex";
  const original = executablePath(selected, env);
  const binary = realpathSync(original);
  if (binary !== CODEX_HUB_BINARY) {
    throw new Error(`Codex hub executable identity differs from the audited installation. Select ${CODEX_HUB_BINARY}.`);
  }
  const stat = lstatSync(binary);
  const stamp = JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
  if (verifiedStamp !== stamp) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(binary)) hash.update(chunk);
    if (hash.digest("hex") !== CODEX_HUB_SHA256) throw new Error(CODEX_HUB_REQUIREMENT);
    verifiedStamp = stamp;
  }
  const identity = createHash("sha256").update(JSON.stringify([selected, original, binary, stamp])).digest("hex");
  const check = (): void => {
    const current = lstatSync(binary);
    if (realpathSync(original) !== binary || JSON.stringify([current.dev, current.ino, current.size, current.mtimeMs, current.ctimeMs]) !== stamp) {
      throw new Error("Codex hub executable identity changed; refusing the turn");
    }
    const refusal = codexUserProviderRefusal(env);
    if (refusal) throw new Error(refusal);
    if (readSidecarCodexProvider(env, settings.envPolicy).identity !== provider.identity) {
      throw new Error("Codex Sidecar provider settings/auth changed during turn preparation; retry the turn");
    }
    const version = execFileSyncCli(binary, ["--version"], { env, cwd: projectDir, timeout: 5_000, encoding: "utf-8" }).toString().trim();
    if (version !== `codex-cli ${CODEX_HUB_VERSION}`) throw new Error(CODEX_HUB_REQUIREMENT);
  };
  check();
  return { ...settings, env, binary, identity, version: CODEX_HUB_VERSION, check };
}

export function hubCodexSnapshotPath(dir: string, id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error("Invalid hub session id");
  return join(dir, `${id}.hub-context.txt`);
}

/** Only the bounded packet, never the ledger, transcript or broker headers. */
export function writeHubCodexSnapshot(dir: string, id: string, packet: string): void {
  const file = hubCodexSnapshotPath(dir, id);
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || realpathSync(file) !== resolve(realpathSync(dir), `${id}.hub-context.txt`)) {
      throw new Error("Codex hub snapshot must be a regular single-link file");
    }
    // Validate before truncation so an alias cannot truncate another file.
    ftruncateSync(fd, 0);
    writeFileSync(fd, packet, "utf-8");
  } finally { closeSync(fd); }
}
