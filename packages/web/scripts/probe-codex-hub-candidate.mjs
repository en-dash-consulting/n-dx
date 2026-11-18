// Opt-in host fixture. Uses built production policy, registry, broker and MCP
// transport; admission stays refused. Scripted decisions are NOT browser proof.
// Usage: node packages/web/scripts/probe-codex-hub-candidate.mjs <binary> <model> <output-dir>
import { boundaryObserved, boundaryScript, checkDraftPhase, checkThread, probeCommand } from "./codex-hub-probe-evidence.mjs";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { isAbsolute, join, resolve, sep } from "node:path";
import { spawnSyncCli } from "../../core/win-spawn.js";
import { candidateCodexHubSpawn } from "../dist/server/sidecar/spawn-policy.js";
import { SidecarSessionRegistry } from "../dist/server/sidecar/session-registry.js";
import { resolveSidecarSessionEnv } from "../dist/server/sidecar/session-env.js";
import { SidecarBroker } from "../dist/server/sidecar/broker.js";
import { handleBrokerMcpRequest } from "../dist/server/sidecar/broker-mcp.js";
import { handleRequestSecurity } from "../dist/server/request-security.js";

const [binary, model, output] = process.argv.slice(2);
if (!binary || !isAbsolute(binary) || !model || !output) throw new Error("Pass an absolute Codex binary, explicit model and disposable output directory");
mkdirSync(output, { recursive: true });
const root = mkdtempSync(join(resolve(output), "hub-candidate-"));
const cwd = join(root, "hub");
const repo = join(root, "repository");
const unregistered = join(root, "unregistered");
const state = join(root, "state");
const drafts = join(root, "drafts");
for (const path of [cwd, repo, unregistered, state, drafts]) mkdirSync(path);
const snapshot = join(cwd, "snapshot");
const marker = randomUUID();
const forbidden = join(cwd, "forbidden");
const readPaths = [join(repo, "canary"), join(unregistered, "canary"), join(cwd, "alias/canary")];
writeFileSync(snapshot, boundaryScript(readPaths, forbidden, marker));
for (const path of [repo, unregistered]) writeFileSync(join(path, "canary"), "DISPOSABLE_REPOSITORY_CANARY");
symlinkSync(repo, join(cwd, "alias"));
writeFileSync(join(repo, ".n-dx.local.json"), JSON.stringify({ llm: { vendor: "codex", autoFailover: false, codex: { cli_path: binary } } }));
const report = { kind: "real-cli-production-candidate-scripted-operator", hubAdmission: false,
  browser: "unverified", connectedTools: "unverified", versions: "only the selected executable is attempted",
  version: null, model, phases: [], passed: false };
const secret = randomUUID();
let mode = "deny";
let registry;
let id;
let endpoint;
let operatorError;
const broker = new SidecarBroker({ dir: state, draftsDir: drafts, onCard(card) {
  if (card.status !== "pending") return;
  queueMicrotask(() => {
    try {
      if (card.tool !== "save_draft") throw new Error("Unexpected fixture card");
      if (mode === "stop") {
        broker.withdraw(id, "fixture Stop");
        void registry.interrupt(id).catch((error) => { operatorError = error; });
      } else broker.decide(id, card.id, { approve: mode === "approve" });
    } catch (error) { operatorError = error; void registry.interrupt(id); }
  });
} });
// Only the save-draft action is implemented. Every other effect is unavailable.
const actions = { saveDraft(path, content) {
  if (!resolve(path).startsWith(`${drafts}${sep}`)) throw new Error("Fixture draft escaped its directory");
  writeFileSync(path, content, { flag: "wx" });
  return { ok: true, text: "Saved disposable draft" };
} };
const server = createServer((req, res) => {
  if (handleRequestSecurity(req, res)) return;
  if (req.url === "/positive") { res.end("DISPOSABLE_LISTENER"); return; }
  if (req.url !== "/mcp" || req.headers["x-ndx-sidecar-key"] !== secret) {
    res.writeHead(403); res.end(); return;
  }
  void handleBrokerMcpRequest(req, res, broker, id, actions, "hub").catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
let threadId;
function openRegistry() {
  return new SidecarSessionRegistry({ dir: state, connect: async () => {
    const spawn = candidateCodexHubSpawn(endpoint, 90_000, {
      cwd, snapshot, repositories: [repo], version: report.version, platform: process.platform,
    });
    return { ...await resolveSidecarSessionEnv(repo), binary, codex: spawn.codex, extraEnv: spawn.env };
  } });
}
async function turn(phase, prompt) {
  const events = [];
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; broker.withdraw(id, "fixture timeout"); void registry.interrupt(id); }, 90_000);
  try {
    const persisted = registry.get(id)?.resumeId;
    const result = await registry.sendTurn(id, prompt, (frame) => { if (frame.type === "event") events.push(frame.event); });
    if (operatorError) throw operatorError;
    const observed = boundaryObserved(events, marker, existsSync(forbidden));
    report.phases.push({ phase, status: result.status, timedOut, observed,
      cards: broker.cards(id).map(({ tool, status, carriedOut }) => ({ tool, status, carriedOut })) });
    if (timedOut || result.status !== (phase === "stop" ? "interrupted" : "completed")) throw new Error(`Fixture phase failed: ${phase}`);
    threadId = checkThread(phase, threadId, persisted, result.sessionId);
    return observed;
  } finally { clearTimeout(timer); }
}
try {
  const version = spawnSyncCli(binary, ["--version"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
  report.version = version.stdout?.match(/codex-cli\s+(\S+)/)?.[1] ?? null;
  if (version.error || version.status !== 0) throw new Error("Selected CLI version unavailable");
  await new Promise((ready, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", ready); });
  const base = `http://127.0.0.1:${server.address().port}`;
  if (await (await fetch(`${base}/positive`)).text() !== "DISPOSABLE_LISTENER") throw new Error("Host listener positive control failed");
  endpoint = { url: `${base}/mcp`, headers: { "x-ndx-sidecar-key": secret } };
  registry = openRegistry();
  id = registry.create({ scope: "hub", worktree: cwd, vendor: "codex", model }).id;
  const boundaryPrompt = `Run exactly this single command in the shell from the session working directory: ${probeCommand}. It checks disposable fixture files. Then reply checked.`;
  for (const phase of ["fresh", "resume", "restart"]) {
    if (phase === "restart") registry = openRegistry();
    const observed = await turn(phase, boundaryPrompt);
    if (!observed.snapshot || !observed.readsDenied || !observed.writeDenied || !observed.headersHidden) throw new Error(`Boundary evidence incomplete: ${phase}`);
  }
  for (mode of ["deny", "approve", "stop"]) {
    const path = join(drafts, `${mode}.md`);
    const previousCards = broker.cards(id).length;
    await turn(mode, `Call only the ndx-sidecar save_draft MCP tool once, kind prompt, path ${JSON.stringify(path)}, content DISPOSABLE_DRAFT. Wait for its result; do not use shell or other tools.`);
    checkDraftPhase(mode, broker.cards(id).slice(previousCards), path, existsSync(path) ? readFileSync(path, "utf8") : undefined);
  }
  const afterStop = await turn("after-stop", boundaryPrompt);
  if (!afterStop.snapshot || !afterStop.readsDenied || !afterStop.writeDenied || !afterStop.headersHidden) throw new Error("Boundary evidence incomplete after Stop");
  // Never means task acceptance: network/browser/connected tools remain unverified.
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message.replaceAll(secret, "[redacted]") : "Fixture failed";
  process.exitCode = 1;
} finally {
  if (registry) await registry.interruptAll();
  server.closeAllConnections();
  if (server.listening) await new Promise((done) => server.close(done));
  writeFileSync(join(root, "result.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(join(root, "result.json"));
}
