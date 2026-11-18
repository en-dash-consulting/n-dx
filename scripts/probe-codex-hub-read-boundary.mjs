// Diagnostic only. This never grants hub admission or invokes a model.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSyncCli } from "../packages/core/win-spawn.js";

export function readBoundaryVerdict(result, canary) {
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.error || result.signal || result.status !== 0 ||
      !stdout.split("\n").includes("PROBE_STARTED")) return "unavailable";
  if (!stdout.split("\n").includes("DISPOSABLE_SNAPSHOT") ||
      !stdout.split("\n").includes("positive=0")) return "invalid-positive-control";
  if (stdout.includes("DISPOSABLE_REPOSITORY_CANARY") ||
      stdout.split("\n").includes("negative=0")) return "repository-readable";
  const diagnostics = stderr.split("\n");
  const denied = ["Permission denied", "Operation not permitted"].some(
    (message) => diagnostics.includes(`cat: ${canary}: ${message}`),
  );
  return /^negative=[1-9]\d*$/m.test(stdout) && denied
    ? "native-read-denied" : "inconclusive";
}

export function probe(binary, outputDir) {
  if (!isAbsolute(binary)) throw new Error("Pass an absolute selected Codex binary path");
  if (process.platform !== "darwin") throw new Error("This native probe supports macOS only");
  mkdirSync(outputDir, { recursive: true });
  const root = mkdtempSync(join(resolve(outputDir), "fixture-"));
  const hub = join(root, "hub");
  const repo = join(root, "repository");
  const home = join(root, "home");
  const codexHome = join(home, ".codex");
  const temp = join(root, "tmp");
  for (const dir of [hub, repo, codexHome, temp]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(hub, "snapshot"), "DISPOSABLE_SNAPSHOT\n");
  const canary = join(repo, "canary");
  writeFileSync(canary, "DISPOSABLE_REPOSITORY_CANARY\n");
  const profile = `default_permissions = "hub-probe"
approval_policy = "never"
[permissions.hub-probe.filesystem]
":root" = "deny"
":minimal" = "read"
":tmpdir" = "deny"
":slash_tmp" = "deny"
${JSON.stringify(repo)} = "deny"
${JSON.stringify(hub)} = "read"
[permissions.hub-probe.network]
enabled = false
`;
  writeFileSync(join(codexHome, "config.toml"), profile);
  const options = {
    cwd: hub,
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, CODEX_HOME: codexHome, TMPDIR: temp },
    encoding: "utf8", timeout: 20000, windowsHide: true,
  };
  const version = spawnSyncCli(binary, ["--version"], options);
  const args = ["sandbox", "--permission-profile", "hub-probe", "--", "/bin/sh", "-c",
    'printf "PROBE_STARTED\\n"; /bin/cat "$1"; printf "\\npositive=%s\\n" "$?"; /bin/cat "$2"; printf "\\nnegative=%s\\n" "$?"',
    "probe", join(hub, "snapshot"), canary];
  const result = spawnSyncCli(binary, args, options);
  const record = {
    checkedAt: new Date().toISOString(), binary, root, profile, args,
    version: { stdout: version.stdout, stderr: version.stderr, exit: version.status, error: version.error?.message },
    exit: result.status, signal: result.signal, error: result.error?.message,
    stdout: result.stdout, stderr: result.stderr, verdict: readBoundaryVerdict(result, canary),
    hubAdmission: false,
    scope: "Native command only; no broker, model, continuation, cancellation, recovery or browser evidence.",
  };
  writeFileSync(join(root, "result.json"), JSON.stringify(record, null, 2) + "\n");
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [binary, outputDir] = process.argv.slice(2);
  if (!binary || !outputDir) throw new Error("Usage: node scripts/probe-codex-hub-read-boundary.mjs <absolute-binary> <disposable-output-directory>");
  const record = probe(binary, outputDir);
  console.log(JSON.stringify(record, null, 2));
  process.exitCode = record.verdict === "native-read-denied" ? 0 : 1;
}
