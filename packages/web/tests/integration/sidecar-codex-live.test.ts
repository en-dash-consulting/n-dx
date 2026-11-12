/**
 * Opt-in, real Codex CLI + production Sidecar HTTP/cards on a disposable v2 PRD.
 * Run outside a nested sandbox with NDX_LIVE_CODEX_SIDECAR=1 and an explicit
 * NDX_LIVE_CODEX_SIDECAR_BINARY. Auth/binary/bind failures FAIL when opted in.
 * NDX_LIVE_CODEX_SIDECAR_MODEL defaults to gpt-6-luna; REPORT names a sanitized
 * JSON artifact. No browser is driven: HTTP requests act as the operator.
 * Five model turns verify cards, header hiding and Stop/continue. A separately
 * identified native CLI sandbox command verifies OS write denial.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { VendorSessionOptions } from "@n-dx/llm-client";
import { expect, it } from "vitest";
import { resolveStore, type PRDItem } from "../../src/server/rex-gateway.js";
import { handleRequestSecurity, isPublicOnlyRequest, refusePublicOnly } from "../../src/server/request-security.js";
import { createAnnouncingBroker, handleSidecarRoute, sidecarBrokerEndpoint } from "../../src/server/routes-sidecar.js";
import { isSidecarBrokerRequest } from "../../src/server/sidecar/broker-credential.js";
import { BROKER_SCOPE_TOOLS } from "../../src/server/sidecar/broker-policy.js";
import { SidecarSessionRegistry, sidecarSessionConnect, worktreeSidecarDir } from "../../src/server/sidecar/session-registry.js";
import type { ServerContext } from "../../src/server/types.js";
import { closeRouteTestServer, removeTestDir } from "../helpers/server-route-test-support.js";
import { checkSidecarCodexInventory } from "../helpers/sidecar-codex-inventory.js";
import { HEADER_COMMAND, WRITE_PROBE, nativeSandboxArgs, nativeSandboxEvidence, shellCommandEvidence } from "../helpers/sidecar-codex-shell.js";

const TASK = "c0000000-0000-4000-8000-000000000002";
const NAMED_VERSIONS = ["0.164.0-alpha.11.1", "0.166.0"];
const REPO = resolve(import.meta.dirname, "../../../..");
const TOOLS = BROKER_SCOPE_TOOLS.worktree.map((name) => `mcp__ndx-sidecar__${name}`).sort();
interface SpawnEvidence {
  binary: string;
  version: string;
  resumed: boolean;
  policyVerified: boolean;
  escalationRequested: boolean;
  foreignMcp: boolean;
  exitCode?: number | null;
  signal?: string | null;
  commandStarts: number;
  agentMessages: number;
  commands: ReturnType<typeof shellCommandEvidence>[];
}

/** A readiness notification, with a hang guardrail; never a sleep as proof. */
function observe(bus: EventEmitter, label: string, ready: () => boolean): Promise<void> {
  return new Promise((resolveWait, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      bus.off("change", check);
      if (error) reject(error); else resolveWait();
    };
    const check = () => { if (ready()) finish(); };
    const timer = setTimeout(() => finish(new Error(`Live Sidecar smoke timed out: ${label}`)), 60_000);
    bus.on("change", check);
    check();
  });
}

async function taskStatus(rexDir: string): Promise<string> {
  const stack: PRDItem[] = [...(await (await resolveStore(rexDir)).loadDocument()).items];
  while (stack.length) {
    const item = stack.pop()!;
    if (item.id === TASK) return item.status;
    stack.push(...(item.children ?? []));
  }
  throw new Error("Live smoke scratch task missing");
}

it.skipIf(process.env.NDX_LIVE_CODEX_SIDECAR !== "1")("real Codex reaches broker cards fresh/resumed while shell stays read-only", async () => {
  const binary = process.env.NDX_LIVE_CODEX_SIDECAR_BINARY;
  const model = process.env.NDX_LIVE_CODEX_SIDECAR_MODEL ?? "gpt-6-luna";
  const reportPath = process.env.NDX_LIVE_CODEX_SIDECAR_REPORT;
  const spawns: SpawnEvidence[] = [];
  const outcomes: Record<string, unknown> = {};
  const report = { kind: "real-cli-scripted-http-operator", binary, version: undefined as string | undefined, model, spawns, outcomes,
    namedVersions: NAMED_VERSIONS.map((version) => ({ version, tested: false, availability: "not established" })),
    passed: false, stage: "setup" };
  let root: string | undefined;
  let registry: SidecarSessionRegistry | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  let client: Client | undefined;
  const childCloses: Promise<void>[] = [];
  // Kept in memory only; never report raw argv (it includes the prompt).
  let shellResumeArgs: string[] | undefined;
  try {
    if (!binary) throw new Error("NDX_LIVE_CODEX_SIDECAR_BINARY is required when live mode is enabled");
    const inventoryPath = join(REPO, ".run-logs", "cli-version-inventory.json");
    if (existsSync(inventoryPath)) {
      const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as { namedVersionsNotFound?: string[] };
      for (const named of report.namedVersions) {
        if (inventory.namedVersionsNotFound?.includes(named.version)) named.availability = "unavailable (coordinator CLI inventory)";
      }
    }
    root = mkdtempSync(join(tmpdir(), "sidecar-codex-live-"));
    const scratch = root;
    execFileSync("git", ["init", scratch], { stdio: "pipe", windowsHide: true });
    const rexDir = join(scratch, ".rex");
    cpSync(resolve(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree"), rexDir, { recursive: true });
    // Finding 8's production resolver must select this untracked operator setting.
    writeFileSync(join(scratch, ".n-dx.local.json"), JSON.stringify({ llm: { vendor: "codex", autoFailover: false, codex: { cli_path: binary } } }));
    mkdirSync(join(scratch, ".codex"));
    writeFileSync(join(scratch, ".codex", "config.toml"), '[mcp_servers.unwanted]\ncommand = "must-not-be-spawned"\n');
    const dir = worktreeSidecarDir(scratch);
    const ctx: ServerContext = { projectDir: scratch, rexDir, svDir: join(scratch, ".sourcevision"), workspace: "main", dev: false };
    const bus = new EventEmitter();
    // The production route announces completion just before persisting lastTurn.
    // Observe after that synchronous update, without waiting on elapsed time.
    const announce = () => { queueMicrotask(() => bus.emit("change")); };
    const broker = createAnnouncingBroker(dir, announce);
    const connect = sidecarSessionConnect(dir, (id) => sidecarBrokerEndpoint(ctx, id));
    const versions = new Map<string, string>();
    const realSpawn: NonNullable<VendorSessionOptions["spawn"]> = (selected, args, options) => {
      // Assert booleans so an unexpected argv/env never gets printed by a matcher.
      expect(selected === binary, "production resolver must select the configured binary").toBe(true);
      let version = versions.get(selected);
      if (!version) {
        const output = execFileSync(selected, ["--version"], { env: options.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 10_000 });
        version = output.match(/codex-cli\s+(\d+\.\d+\.\d+(?:-[\w.-]+)?)/)?.[1];
        if (!version) throw new Error("Selected CLI did not report a codex-cli version");
        versions.set(selected, version);
      }
      report.version = version;
      const resumed = args[1] === "resume";
      const config = args.filter((_arg, i) => args[i - 1] === "-c");
      const policyVerified = config.includes('mcp_servers.ndx-sidecar.default_tools_approval_mode="approve"')
        && config.filter((arg) => arg.includes("approval_mode")).length === 1
        && config.includes("features.apps=false") && config.includes("features.shell_snapshot=false")
        && config.includes("mcp_servers.unwanted.enabled=false") && args.includes("--ignore-user-config")
        && (resumed ? config.includes('sandbox_mode="read-only"') && config.includes('approval_policy="never"')
          : args[args.indexOf("--sandbox") + 1] === "read-only" && config.includes("approval_policy=never"))
        && !args.includes("--dangerously-bypass-approvals-and-sandbox");
      expect(policyVerified, "fresh/resume policy at the real spawn").toBe(true);
      for (const name of ["NDX_SIDECAR_HEADER_X_NDX_SIDECAR_KEY", "NDX_SIDECAR_HEADER_X_NDX_WORKSPACE"]) {
        const value = options.env?.[name];
        expect(!!value, "both broker headers must actually reach the CLI environment").toBe(true);
        expect(args.some((arg) => arg.includes(value!)), "header values must not reach argv").toBe(false);
        expect(config.includes(`shell_environment_policy.set.${name}=''`)).toBe(true);
      }
      if (report.stage === "resumed shell isolation") shellResumeArgs = [...args];
      const evidence: SpawnEvidence = { binary: selected, version, resumed, policyVerified, escalationRequested: false, foreignMcp: false, commandStarts: 0, agentMessages: 0, commands: [] };
      spawns.push(evidence);
      // Forward the real production spawn without changing args, environment or sandbox.
      const child = spawn(selected, args, options);
      childCloses.push(new Promise<void>((done) => child.once("close", (code, signal) => {
        evidence.exitCode = code;
        evidence.signal = signal;
        done();
        announce();
      })));
      let pending = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        pending += chunk.toString();
        let end: number;
        while ((end = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          let event: { type?: string; item?: Record<string, unknown> };
          try { event = JSON.parse(line) as typeof event; }
          catch { outcomes.invalidCliJson = true; continue; }
          if (/"sandbox_permissions"\s*:\s*"require_escalated"/.test(line)
            || /approval.*request|request.*approval/i.test(event.type ?? "")) evidence.escalationRequested = true;
          const item = event.item;
          if (item?.type === "mcp_tool_call" && item.server !== "ndx-sidecar") evidence.foreignMcp = true;
          if (event.type === "item.started" && item?.type === "command_execution") evidence.commandStarts++;
          if (event.type === "item.completed" && item?.type === "agent_message") evidence.agentMessages++;
          if (event.type === "item.completed" && item?.type === "command_execution") {
            evidence.commands.push(shellCommandEvidence(item));
          }
        }
      });
      return child;
    };
    registry = new SidecarSessionRegistry({ dir, connect: async (record) => ({ ...await connect(record), spawn: realSpawn }) });
    const reg = registry;
    const token = "live-smoke-disposable-dashboard-token";
    server = createServer(async (req, res) => {
      if (handleRequestSecurity(req, res, { token, scopedCredential: isSidecarBrokerRequest })) return;
      if (isPublicOnlyRequest(req)) { refusePublicOnly(req, res); return; }
      try {
        if (await handleSidecarRoute(req, res, ctx, announce, { registryFor: () => reg, brokerFor: () => broker })) return;
        res.writeHead(404).end();
      } catch {
        // Never expose request headers or raw provider errors in the smoke report.
        outcomes.routeFailure = true;
        res.writeHead(500).end("Live smoke route failed");
        announce();
      }
    });
    await new Promise<void>((ready, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", ready);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Live smoke has no TCP listener");
    ctx.port = address.port;
    const base = `http://127.0.0.1:${address.port}/api/sidecar/sessions`;
    async function post(path: string, body: unknown, status = 200): Promise<Record<string, unknown>> {
      const response = await fetch(`${base}${path}`, { method: "POST", headers: { "X-Ndx-Token": token, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
      expect(response.status, `operator POST ${path}`).toBe(status);
      return await response.json() as Record<string, unknown>;
    }
    const created = await post("", { vendor: "codex", model }, 201);
    const id = (created.session as { id: string }).id;
    const start = (prompt: string) => post(`/${id}/turns`, { prompt }, 202);
    function turnOutcome(): string {
      const last = reg.get(id)?.lastTurn;
      // Do not copy raw CLI errors (which may contain environment details).
      const reason = /auth|sign.?in|log.?in|401/i.test(last?.error ?? "") ? "authentication failure"
        : /requires approval|approval policy/i.test(last?.error ?? "") ? "CLI approval refusal"
          : last?.error ? "CLI/configuration failure" : last?.status ?? "running";
      outcomes.lastTurn = reason;
      return reason;
    }
    const finish = async () => {
      await observe(bus, "turn completion", () => !reg.isRunning(id) && reg.get(id)?.lastTurn !== undefined);
      expect(reg.get(id)?.lastTurn?.status, `live turn ${spawns.length}: ${turnOutcome()}`).toBe("completed");
    };
    async function card(tool: string) {
      await observe(bus, `${tool} card or failed turn`, () => broker.cards(id).some((c) => c.tool === tool && c.status === "pending") || reg.get(id)?.lastTurn !== undefined);
      const waiting = broker.cards(id).find((c) => c.tool === tool && c.status === "pending");
      expect(waiting !== undefined, `${tool} must reach an operator card; turn: ${turnOutcome()}`).toBe(true);
      expect(reg.isRunning(id), "card must hold the turn open").toBe(true);
      expect(waiting!.allowListKey).toBeNull();
      return waiting!;
    }
    const choose = 'Call ndx-sidecar ask_choice with question "Live smoke choice?" and options [{"label":"Continue"},{"label":"Cancel"}]. Wait for its result.';
    report.stage = "fresh choice and tool inventory";
    await start(`${choose} After the answer, list EVERY MCP tool available to you across ALL servers (not built-ins) as one JSON line: {"mcpTools":["mcp__server__tool",...]}. Use fully qualified names. Do not call other tools.`);
    const choice = await card("ask_choice");
    const endpoint = sidecarBrokerEndpoint(ctx, id)!;
    client = new Client({ name: "live-smoke-inventory", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: endpoint.headers } }));
    const brokerTools = (await client.listTools()).tools.map((tool) => `mcp__ndx-sidecar__${tool.name}`).sort();
    outcomes.toolNames = brokerTools;
    expect(brokerTools).toEqual(TOOLS);
    await client.close();
    client = undefined;
    // The round trip to list tools gives another observable barrier while the card waits.
    expect(broker.cards(id).find((c) => c.id === choice.id)?.status).toBe("pending");
    expect(reg.isRunning(id)).toBe(true);
    outcomes.freshCardWaited = true;
    await post(`/${id}/cards/${choice.id}`, { decision: "approve", answer: { selected: ["Continue"] } });
    await finish();
    const texts = reg.readFrames(id).flatMap((frame) => frame.type === "event" && frame.event.type === "assistant" ? [frame.event.text ?? ""] : []);
    const inventoryText = texts.join("\n").match(/\{\s*"mcpTools"\s*:\s*\[[\s\S]*?\]\s*\}/)?.[0];
    expect(!!inventoryText, "real CLI must enumerate its MCP tool catalog").toBe(true);
    const inventory = checkSidecarCodexInventory((JSON.parse(inventoryText!) as { mcpTools: unknown }).mcpTools, TOOLS);
    // Save only validated tool NAME arrays, before asserting so failures remain
    // diagnosable. Never save the assistant text, raw frames or tool arguments.
    outcomes.cliToolInventory = inventory;
    expect(inventory.matches, "CLI inventory must contain exactly the broker's worktree tools (only ndx_sidecar aliases ndx-sidecar)").toBe(true);
    outcomes.cliToolInventoryMatched = true;
    const resumeId = reg.get(id)?.resumeId;
    expect(!!resumeId, "fresh CLI must supply a resumable thread id").toBe(true);

    report.stage = "resumed status approval";
    expect(await taskStatus(rexDir)).toBe("pending");
    await start(`Call only ndx-sidecar propose_status with id "${TASK}" and status "deferred". Wait for the operator card. After the result, say STATUS_DONE and stop.`);
    const status = await card("propose_status");
    expect(status.statusChange).toMatchObject({ itemId: TASK, from: "pending", to: "deferred" });
    expect(await taskStatus(rexDir)).toBe("pending");
    expect(broker.cards(id).find((c) => c.id === status.id)?.status).toBe("pending");
    expect(reg.isRunning(id)).toBe(true);
    outcomes.resumedWriteWaited = true;
    await post(`/${id}/cards/${status.id}`, { decision: "approve" });
    await finish();
    expect(await taskStatus(rexDir)).toBe("deferred");
    expect(broker.cards(id).find((c) => c.id === status.id)?.carriedOut?.ok).toBe(true);
    outcomes.approvedWrite = "deferred";

    report.stage = "resumed shell isolation";
    // The deliberate write prompt elicited prose refusals, even without MCP.
    // This turn measures actual shell header hiding; the separate native probe
    // below measures OS write enforcement without depending on model willingness.
    await start(`Run this read-only command once using your built-in shell, then say CHECK_DONE: ${HEADER_COMMAND}\nIt prints only whether two variables are empty; never print their values. Use the normal sandbox, without escalation or a broker tool.`);
    await finish();
    const shell = spawns.at(-1)!;
    const probe = shell.commands.find((command) => command.headerCheckAttempted);
    outcomes.resumedShell = { kind: "model-issued-safe-read", commandObserved: !!probe, headersHidden: probe?.headersHidden === true,
      commandStarts: shell.commandStarts, commandCompletions: shell.commands.length, agentMessages: shell.agentMessages };
    expect(!!probe, "resumed safe-read command must execute; prose/refusal is not header-isolation evidence (see sanitized counters)").toBe(true);
    expect(probe!.headersHidden, "actual child shell must see both header variables empty").toBe(true);
    expect(probe!.exitCode, "header check must complete successfully").toBe(0);
    expect(shell.escalationRequested, "resumed shell must not request escalation").toBe(false);
    outcomes.headersHidden = true;

    report.stage = "Stop withdrawal";
    await start(choose);
    const stopped = await card("ask_choice");
    await post(`/${id}/interrupt`, {});
    await observe(bus, "stopped turn", () => !reg.isRunning(id) && reg.get(id)?.lastTurn !== undefined);
    expect(broker.cards(id).find((c) => c.id === stopped.id)?.status).toBe("withdrawn");
    expect(reg.get(id)?.lastTurn?.status).toBe("interrupted");
    outcomes.stopWithdrewCard = true;
    report.stage = "same-session continuation";
    await start(`${choose} After the answer say CONTINUED and stop.`);
    const continued = await card("ask_choice");
    await post(`/${id}/cards/${continued.id}`, { decision: "approve", answer: { selected: ["Continue"] } });
    await finish();
    expect(reg.get(id)?.resumeId).toBe(resumeId);
    expect(spawns.map((call) => call.resumed)).toEqual([false, true, true, true, true]);
    expect(spawns.some((call) => call.escalationRequested || call.foreignMcp)).toBe(false);
    expect(outcomes.invalidCliJson).toBeUndefined();
    expect(outcomes.routeFailure).toBeUndefined();
    outcomes.sameSessionContinued = true;
    outcomes.noShellEscalation = true;

    report.stage = "supplemental native sandbox write denial";
    expect(!!shellResumeArgs, "native probe must replay an observed resumed spawn").toBe(true);
    // Host permissions must allow this exact write, otherwise a denial would
    // not establish sandbox enforcement. Remove the control before the probe.
    const probePath = join(scratch, WRITE_PROBE);
    writeFileSync(probePath, "host control");
    expect(readFileSync(probePath, "utf8")).toBe("host control");
    unlinkSync(probePath);
    const nativeHome = join(scratch, "native-codex-home");
    mkdirSync(nativeHome);
    const native = spawnSync(binary, nativeSandboxArgs(shellResumeArgs!, scratch, process.execPath), {
      cwd: scratch, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 10_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: nativeHome },
    });
    const nativeEvidence = nativeSandboxEvidence(native, existsSync(probePath));
    outcomes.nativeSandbox = { kind: "supplemental-native-cli-command", modelIssued: false,
      binary, version: report.version, policySource: "observed-resumed-spawn", hostWriteControlPassed: true, ...nativeEvidence };
    expect(nativeEvidence.writeSucceeded, "native sandbox allowed a write under the resumed policy").toBe(false);
    expect(nativeEvidence.osDenied, "selected CLI sandbox must execute the probe and deny its write; setup failure/timeout is not OS denial (see nativeSandbox report)").toBe(true);
    outcomes.readonly = "OS write denial verified separately by selected CLI native sandbox; resumed model command verified safe-read/header isolation";
    for (const named of report.namedVersions) {
      if (spawns.some((call) => call.version === named.version)) { named.tested = true; named.availability = "tested"; }
    }
    report.passed = true;
    report.stage = "complete";
  } finally {
    // Drain the real children and in-flight broker requests before deleting scratch data.
    try {
      await registry?.interruptAll();
      await registry?.whenIdle();
      await Promise.all(childCloses);
      await client?.close();
      if (server) await closeRouteTestServer(server);
      if (root) await removeTestDir(root);
      expect(spawns.every((child) => child.exitCode !== undefined), "all CLI children must close before cleanup completes").toBe(true);
      expect(server?.listening ?? false, "live server must close").toBe(false);
      expect(root ? existsSync(root) : false, "scratch fixture must be removed").toBe(false);
      outcomes.cleanupCompleted = true;
    } catch (error) {
      report.passed = false;
      report.stage = "cleanup failed";
      throw error;
    } finally {
      if (reportPath) {
        mkdirSync(dirname(reportPath), { recursive: true });
        writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
      }
    }
  }
// A hang guardrail for five real LLM turns; each readiness wait fails after 60s.
}, 360_000);
