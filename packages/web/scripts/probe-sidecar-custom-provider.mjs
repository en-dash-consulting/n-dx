// Standalone coordinator-run host acceptance. Real selected CLI + production
// hub admission/registry/broker; local scripted Responses service, no paid model.
// node packages/web/scripts/probe-sidecar-custom-provider.mjs <absolute-binary> <output-dir>
import { shellCheckPassed, threadContinued, advertisedTools, shellCall, responseEvents } from "./sidecar-provider-probe-checks.mjs";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createHubSidecarRegistry } from "../dist/server/sidecar/session-registry.js";
import { writeHubCodexSnapshot } from "../dist/server/sidecar/hub-codex.js";
import { SidecarBroker } from "../dist/server/sidecar/broker.js";
import { handleBrokerMcpRequest } from "../dist/server/sidecar/broker-mcp.js";
import { handleRequestSecurity } from "../dist/server/request-security.js";

const [binary, output] = process.argv.slice(2);
if (!binary || !isAbsolute(binary) || !output) throw new Error("Pass the audited absolute Codex binary and a disposable output directory");
mkdirSync(output, { recursive: true });
const root = mkdtempSync(join(resolve(output), "custom-provider-"));
const home = join(root, "codex-home"); const repo = join(root, "repository"); const dir = join(root, "hub");
for (const path of [home, repo, dir]) mkdirSync(path);
const key = randomUUID(); const header = randomUUID(); const brokerKey = randomUUID();
// Only disposable credentials. Do not inherit an operator's Codex login/config.
process.env.CODEX_HOME = home;
process.env.PR9_PROVIDER_PASSWORD = key;
process.env.PR9_HEADER_PASSWORD = header;
const savedModel = "gpt-6-astra";
writeFileSync(join(repo, ".n-dx.local.json"), JSON.stringify({ llm: { vendor: "codex", autoFailover: false, codex: { cli_path: binary, model: savedModel } } }));
const report = { kind: "real-cli-production-hub-local-scripted-responses", paidProvider: "not attempted", browser: "not attempted", phases: [], passed: false };
let registry; let id; let phase; let issuedCall; let phaseError;
let unrelated = 0; let providerRequests = 0; let brokerRequests = 0;
let shellHidden = false;
const broker = new SidecarBroker({ dir, draftsDir: join(root, "drafts") });
const server = createServer((req, res) => {
  if (handleRequestSecurity(req, res)) return;
  if (req.url === "/unrelated") { unrelated++; res.writeHead(500); res.end(); return; }
  if (req.url === "/mcp") {
    brokerRequests++;
    if (req.headers.authorization || req.headers["x-fixture"] || req.headers["x-ndx-sidecar-key"] !== brokerKey) {
      phaseError = "Broker credential isolation failed"; res.writeHead(403); res.end(); return;
    }
    void handleBrokerMcpRequest(req, res, broker, id, {}, "hub").catch(() => { phaseError = "Broker fixture failed"; if (!res.headersSent) res.writeHead(500); res.end(); });
    return;
  }
  if (req.url !== "/v1/responses" || req.method !== "POST") { res.writeHead(404); res.end(); return; }
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", () => {
    providerRequests++;
    try {
      const request = JSON.parse(body);
      if (req.headers.authorization !== `Bearer ${key}` || req.headers["x-fixture"] !== header || req.headers["x-ndx-sidecar-key"]) throw new Error("Provider credential isolation failed");
      if (request.model !== phase.model) throw new Error("Effective model pin was not delivered to the provider");
      if ([key, header, brokerKey].some(secret => body.includes(secret))) throw new Error("Credential reached model request body");
      if (phase.name === "rejected-auth" || phase.name === "connection-failure") {
        res.writeHead(phase.name === "rejected-auth" ? 401 : 503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: phase.name === "rejected-auth" ? "Unauthorized" : "Service unavailable" } }));
        return;
      }
      if (advertisedTools(request).some(tool => /unrelated/.test(tool.qualifiedName))) throw new Error("Unrelated tool loaded");
      if (shellCheckPassed(request.input, issuedCall)) shellHidden = true;
      let item;
      if (!issuedCall) {
        const script = join(dir, `${id}.hub-context.txt`);
        const command = `/bin/sh '${script.replaceAll("'", "'\\''")}'`;
        item = shellCall(request, command, `call_${randomUUID()}`);
        issuedCall = item.call_id;
      } else item = { id: `msg_${randomUUID()}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Disposable provider probe complete.", annotations: [] }] };
      const response = { id: `resp_${randomUUID()}`, object: "response", model: request.model, status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      for (const event of responseEvents(response)) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    } catch (error) { phaseError = error.message; res.writeHead(500); res.end("Disposable protocol fixture failed"); }
  });
});

function scan(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) scan(file);
    else if (entry.isFile() && [key, header, brokerKey].some(secret => readFileSync(file).includes(Buffer.from(secret)))) throw new Error("A disposable credential was persisted in fixture artifacts");
  }
}
try {
  await new Promise((ready, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", ready); });
  const base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(home, "config.toml"), [
    'profile="fixture"', 'model_provider="unrelated"',
    '[profiles.fixture]', 'model_provider="selected"', 'model="gpt-6.2-sol"',
    '[model_providers.selected]', 'name="disposable"', `base_url=${JSON.stringify(`${base}/v1`)}`,
    'wire_api="responses"', 'env_key="PR9_PROVIDER_PASSWORD"',
    'env_http_headers={"X-Fixture"="PR9_HEADER_PASSWORD"}',
    'request_max_retries=0', 'stream_max_retries=0', 'supports_websockets=false',
    '[mcp_servers.unrelated]', `url=${JSON.stringify(`${base}/unrelated`)}`,
    '[features]', 'apps=true', 'shell_snapshot=true',
  ].join("\n"));
  const open = () => createHubSidecarRegistry({ dir, hostProjectDir: repo,
    broker: () => ({ url: `${base}/mcp`, headers: { "x-ndx-sidecar-key": brokerKey } }) });
  registry = open();
  id = registry.create({ scope: "hub", worktree: dir, vendor: "codex" }).id;
  // This is the single file the unchanged hub sandbox grants read access.
  writeHubCodexSnapshot(dir, id, [
    'test -z "$NDX_SIDECAR_PROVIDER_0" && test -z "$NDX_SIDECAR_PROVIDER_1"',
    'test -z "$PR9_PROVIDER_PASSWORD" && test -z "$PR9_HEADER_PASSWORD"',
    'test -z "$NDX_SIDECAR_HEADER_X_NDX_SIDECAR_KEY"',
    'if [ "$?" -eq 0 ]; then printf PR9_PROVIDER_HEADERS_HIDDEN; else exit 1; fi',
  ].join(" &&\n"));
  let thread;
  for (const name of ["fresh", "resume", "restart", "explicit-model"]) {
    if (name === "restart") registry = open();
    if (name === "explicit-model") {
      const previous = id;
      id = registry.create({ scope: "hub", worktree: dir, vendor: "codex", model: "gpt-6.2-astra" }).id;
      writeHubCodexSnapshot(dir, id, readFileSync(join(dir, `${previous}.hub-context.txt`), "utf8"));
    }
    phase = { name, model: name === "explicit-model" ? "gpt-6.2-astra" : savedModel };
    issuedCall = undefined; shellHidden = false; phaseError = undefined;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void registry.interruptAll(); }, 60_000);
    try {
      const result = await registry.sendTurn(id, "Run the disposable provider probe.");
      const continuity = threadContinued(result.sessionId, name === "fresh" || name === "explicit-model" ? undefined : thread);
      report.phases.push({ ...phase, status: result.status, continuity, shellHidden, timedOut });
      if (phaseError || timedOut || result.status !== "completed" || !continuity || !shellHidden) throw new Error(phaseError ?? "CLI phase evidence incomplete");
      thread = result.sessionId;
    } finally { clearTimeout(timer); }
  }
  for (const name of ["rejected-auth", "connection-failure"]) {
    phase = { name, model: "gpt-6.2-astra" };
    phaseError = undefined;
    const timer = setTimeout(() => { void registry.interruptAll(); }, 60_000);
    try {
      const result = await registry.sendTurn(id, "Exercise the disposable failure response.");
      const distinct = result.status === "failed" && (name === "rejected-auth" ? /missing auth/ : /connection failure/).test(result.error ?? "");
      report.phases.push({ ...phase, status: result.status, distinct });
      if (phaseError || !distinct) throw new Error("Distinct provider error evidence incomplete");
    } finally { clearTimeout(timer); }
  }
  const before = providerRequests;
  delete process.env.PR9_PROVIDER_PASSWORD;
  let refused = false;
  try { await registry.sendTurn(id, "Missing disposable credential must refuse before spawning."); }
  catch (error) { refused = /missing auth/.test(error.message); }
  process.env.PR9_PROVIDER_PASSWORD = key;
  report.phases.push({ name: "missing-auth", refused, noRequest: before === providerRequests });
  if (!refused || before !== providerRequests) throw new Error("Missing-auth evidence incomplete");
  scan(root);
  if (!providerRequests || !brokerRequests || unrelated) throw new Error("Provider/broker positive control or integration isolation failed");
  report.passed = true;
} catch (error) {
  // Fixed probe errors plus OS codes only; never vendor stdout/stderr or env.
  report.failure = error.code ?? "Host probe failed; inspect phase booleans (no raw credential-bearing output retained)";
  process.exitCode = 1;
} finally {
  if (registry) await registry.interruptAll();
  server.closeAllConnections();
  if (server.listening) await new Promise(done => server.close(done));
  Object.assign(report, { providerRequests, brokerRequests, unrelated });
  writeFileSync(join(root, "result.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(join(root, "result.json"));
}
