/** Wiring contracts with a mocked CLI probe; native confinement is host evidence. */
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { IncomingMessage, type ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { VendorSessionOptions } from "@n-dx/llm-client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { admitCodexHub, CODEX_HUB_VERSION, hubCodexSnapshotPath, writeHubCodexSnapshot } from "../../src/server/sidecar/hub-codex.js";
import { createHubSidecarRegistry, sidecarSessionConnect, type SidecarSessionRecord } from "../../src/server/sidecar/session-registry.js";
import { handleSidecarRoute, hubSidecarContextOptions } from "../../src/server/routes-sidecar.js";
import type { ServerContext } from "../../src/server/types.js";

const fixture = vi.hoisted(() => ({ binary: "", installedBinary: "", version: "codex-cli 0.167.0-alpha.3.2", probe: vi.fn(), spawn: vi.fn() }));
vi.mock("../../src/server/sidecar/spawn-policy.js", async (original) => ({
  ...await original<typeof import("../../src/server/sidecar/spawn-policy.js")>(),
  get CODEX_HUB_BINARY() { return fixture.installedBinary; },
  CODEX_HUB_SHA256: "7165e60b6463d4bea38f00a56eea90e96bfcc590aaa3d2b88c53208f54869348",
}));
vi.mock("../../src/server/sidecar/session-env.js", () => ({
  resolveSidecarSessionEnv: async () => ({ llmConfig: { codex: { cli_path: fixture.binary, model: "gpt-6-astra" } } }),
}));
vi.mock("@n-dx/llm-client", async (original) => {
  const actual = await original<typeof import("@n-dx/llm-client")>();
  return {
  ...actual,
  startVendorSession: (opts: VendorSessionOptions) => actual.startVendorSession({ ...opts, spawn: fixture.spawn }),
  resumeVendorSession: (id: string, opts: VendorSessionOptions) => actual.resumeVendorSession(id, { ...opts, spawn: fixture.spawn }),
  resolveVendorCliEnv: () => ({ PATH: "", CODEX_HOME: join(fixture.binary, "..", "codex-home") }),
  execFileSyncCli: (...args: unknown[]) => { fixture.probe(...args); return fixture.version; },
}; });

let root: string;
let dir: string;
let repo: string;
let record: SidecarSessionRecord;
const endpoint = { url: "http://127.0.0.1:3117/mcp", headers: { "x-ndx-sidecar-key": "fixture-secret" } };
beforeEach(() => {
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  root = realpathSync(mkdtempSync(join(tmpdir(), "hub-admission-")));
  dir = join(root, "hub"); repo = join(root, "repo");
  mkdirSync(dir); mkdirSync(repo);
  fixture.binary = join(root, "codex");
  fixture.installedBinary = fixture.binary;
  writeFileSync(fixture.binary, "fixture executable, never executed"); chmodSync(fixture.binary, 0o700);
  fixture.version = `codex-cli ${CODEX_HUB_VERSION}`; fixture.probe.mockClear(); fixture.spawn.mockReset();
  const at = new Date().toISOString();
  record = { id: "fixture", scope: "hub", worktree: dir, vendor: "codex", name: "fixture",
    cursor: 0, turns: 0, tokens: { input: 0, output: 0 }, createdAt: at, lastActivityAt: at };
  writeHubCodexSnapshot(dir, record.id, "bounded hub snapshot");
});
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

it("admits the selected exact executable and wires production broker confinement on reconnect", async () => {
  const connect = sidecarSessionConnect(dir, () => endpoint, repo);
  for (let i = 0; i < 3; i++) {
    const result = await connect(record);
    expect(result.binary).toBe(fixture.binary);
    expect(result.model).toBe("gpt-6-astra");
    expect(result.codex?.policyFlags).toEqual(result.codex?.resumePolicyFlags);
    expect(result.codex?.policyFlags?.join(" ")).toContain('":root"="deny"');
    expect(result.codex?.configFlags?.join(" ")).toContain('mcp_servers.ndx-sidecar.required=true');
    expect(JSON.stringify(result.codex)).not.toContain("fixture-secret");
    expect(result.extraEnv).toEqual({ NDX_SIDECAR_HEADER_X_NDX_SIDECAR_KEY: "fixture-secret" });
    result.codex?.turnConfigFlags?.();
  }
  expect(fixture.probe).toHaveBeenCalledWith(fixture.binary, ["--version"], expect.objectContaining({ cwd: repo }));
});

it.each(["codex-cli 0.166.0", "codex-cli 0.167.0-alpha.3.3", "codex-cli 0.168.0", "unknown"])("refuses unaudited version %s", async (version) => {
  fixture.version = version;
  await expect(admitCodexHub(repo)).rejects.toThrow(/unverified/);
});

it("refuses unavailable binaries and unaudited platforms before probing", async () => {
  rmSync(fixture.binary);
  await expect(admitCodexHub(repo)).rejects.toThrow(/unavailable/);
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  await expect(admitCodexHub(repo)).rejects.toThrow(/macOS/);
  expect(fixture.probe).not.toHaveBeenCalled();
});

it("refuses unaudited executable contents before invoking the version probe", async () => {
  writeFileSync(fixture.binary, "different build with the same version label");
  await expect(admitCodexHub(repo)).rejects.toThrow(/unverified/);
  expect(fixture.probe).not.toHaveBeenCalled();
});

it("rechecks version and binary identity immediately before a turn", async () => {
  const connected = await sidecarSessionConnect(dir, () => endpoint, repo)(record);
  fixture.version = "codex-cli 0.168.0";
  expect(() => connected.codex?.turnConfigFlags?.()).toThrow(/unverified/);
  fixture.version = `codex-cli ${CODEX_HUB_VERSION}`;
  writeFileSync(fixture.binary, "replaced binary");
  expect(() => connected.codex?.turnConfigFlags?.()).toThrow(/identity changed/);
});

it("rejects a changed selected binary and a replaced workspace alias on reconnect", async () => {
  const connect = sidecarSessionConnect(dir, () => endpoint, repo);
  await connect(record);
  const original = fixture.binary;
  fixture.binary = join(root, "other-codex");
  writeFileSync(fixture.binary, "other"); chmodSync(fixture.binary, 0o700);
  await expect(connect(record)).rejects.toThrow(/audited installation/);
  fixture.binary = original;
  rmSync(dir, { recursive: true }); symlinkSync(repo, dir);
  await expect(connect(record)).rejects.toThrow(/identity changed/);
});

it("updates only the snapshot, truncates old content, and rejects symlink/hardlink substitution before writing", () => {
  const snapshot = hubCodexSnapshotPath(dir, record.id);
  writeHubCodexSnapshot(dir, record.id, "short");
  expect(readFileSync(snapshot, "utf8")).toBe("short");
  const canary = join(repo, "secret"); writeFileSync(canary, "unchanged");
  rmSync(snapshot); symlinkSync(canary, snapshot);
  expect(() => writeHubCodexSnapshot(dir, record.id, "leak")).toThrow();
  rmSync(snapshot); linkSync(canary, snapshot);
  expect(() => writeHubCodexSnapshot(dir, record.id, "leak")).toThrow(/single-link/);
  expect(readFileSync(canary, "utf8")).toBe("unchanged");
});

it.skipIf(process.platform === "win32")("refuses a FIFO snapshot without waiting for a reader", () => {
  const file = hubCodexSnapshotPath(dir, record.id);
  rmSync(file);
  execFileSync("mkfifo", [file]);
  // Bound a regression: a blocking writer would wait for this reader, then fail fstat.
  const reader = spawn(process.execPath, ["-e", 'setTimeout(() => require("fs").openSync(process.argv[1], "r"), 1000)', file]);
  try {
    expect(() => writeHubCodexSnapshot(dir, record.id, "packet")).toThrow(expect.objectContaining({ code: "ENXIO" }));
  } finally { reader.kill(); }
});

it("refuses missing broker, host, snapshot and edited workspace", async () => {
  await expect(sidecarSessionConnect(dir)(record)).rejects.toThrow(/requires/);
  await expect(sidecarSessionConnect(dir, () => endpoint, repo)({ ...record, worktree: repo })).rejects.toThrow(/requires/);
  rmSync(hubCodexSnapshotPath(dir, record.id));
  await expect(sidecarSessionConnect(dir, () => endpoint, repo)(record)).rejects.toThrow();
});

async function route(path: string, method: string, body?: unknown) {
  const req = Object.assign(new IncomingMessage(new Socket()), { url: `/api/sidecar/hub/${path}`, method, headers: {} });
  let status = 0;
  let data: { vendors?: unknown; session?: unknown } = {};
  const res = { writeHead: (code: number) => { status = code; }, end: (text: string) => { data = JSON.parse(text); } };
  const ctx: ServerContext = { projectDir: repo, rexDir: join(repo, ".rex"), svDir: join(repo, ".sourcevision"), dev: false, port: 3999 };
  const handling = handleSidecarRoute(req, res as unknown as ServerResponse, ctx, () => {}, { hub: { homeDir: root } });
  if (body !== undefined) req.push(JSON.stringify(body));
  req.push(null);
  await handling;
  return { status, data };
}

it("keeps GET lens read-only, probes on POST, and enforces admission independently at create", async () => {
  expect((await route("lens", "GET")).status).toBe(200);
  expect(fixture.probe).not.toHaveBeenCalled();
  const capability = await route("lens", "POST");
  expect(capability.data.vendors).toContainEqual({ vendor: "codex", available: true });
  fixture.version = "codex-cli 0.168.0";
  expect((await route("sessions", "POST", { vendor: "codex" })).status).toBe(400);
  fixture.version = `codex-cli ${CODEX_HUB_VERSION}`;
  const created = await route("sessions", "POST", { vendor: "codex" });
  expect(created.status).toBe(201);
  expect(created.data.session).toMatchObject({ vendor: "codex", scope: "hub", lens: "hub" });
  expect((await route("sessions", "POST", { vendor: "claude" })).status).toBe(409);
  expect((await route("sessions", "POST", { vendor: "codex" })).data.session).toEqual(created.data.session);
  expect((await route("sessions", "POST", { vendor: "codex", lens: "general" })).status).toBe(400);
});

it("refuses an unavailable hub snapshot before replacing the last packet", async () => {
  writeFileSync(join(repo, ".n-dx.json"), JSON.stringify({ features: { web: { sidecar: true } } }));
  const ctx: ServerContext = { projectDir: repo, rexDir: join(repo, ".rex"), svDir: join(repo, ".sourcevision"), dev: false, port: 3999 };
  const context = hubSidecarContextOptions(ctx, dir, { homeDir: root });
  const signal = new AbortController().signal;
  expect(await context.packet!({ ...record, vendor: "claude" }, signal)).toContain("no hub is running");
  await expect(context.packet!(record, signal)).rejects.toThrow(/snapshot is unavailable/);
  expect(readFileSync(hubCodexSnapshotPath(dir, record.id), "utf8")).toBe("bounded hub snapshot");
});

it("uses production registry admission across fresh/resume/restart and refuses a changed version before spawning", async () => {
  fixture.spawn.mockImplementation(() => {
    const child = new EventEmitter();
    const stdin = new PassThrough(); const stdout = new PassThrough();
    Object.assign(child, { stdin, stdout, stderr: new PassThrough(), pid: undefined });
    stdin.on("end", () => {
      stdout.end(JSON.stringify({ type: "thread.started", thread_id: "stable-thread" }) + "\n"
        + JSON.stringify({ type: "turn.completed", usage: { input_tokens: 20, output_tokens: 5 } }) + "\n");
      setImmediate(() => child.emit("close", 0));
    });
    stdin.resume();
    return child as ChildProcess;
  });
  const open = () => createHubSidecarRegistry({ dir, hostProjectDir: repo, broker: () => endpoint,
    context: { ceiling: () => 10_000, ledger: () => [], packetEveryTurn: true,
      packet: async (r) => { writeHubCodexSnapshot(dir, r.id, "bounded packet"); return "bounded packet"; } },
  });
  let registry = open();
  const { id } = registry.create({ scope: "hub", worktree: dir, vendor: "codex" });
  for (const phase of ["fresh", "resume", "restart"]) {
    if (phase === "restart") registry = open();
    expect((await registry.sendTurn(id, phase)).status).toBe("completed");
    expect(registry.get(id)?.resumeId).toBe("stable-thread");
  }
  expect(fixture.spawn).toHaveBeenCalledTimes(3);
  for (const [, args] of fixture.spawn.mock.calls) {
    expect(args.join(" ")).toContain('default_permissions="ndx-hub-candidate"');
    expect(args).not.toContain("--sandbox");
    expect(args[args.indexOf("-m") + 1]).toBe("gpt-6-astra");
  }
  expect(fixture.spawn.mock.calls[1][1]).toContain("resume");
  expect(fixture.spawn.mock.calls[2][1]).toContain("stable-thread");
  fixture.version = "codex-cli 0.168.0";
  await expect(registry.sendTurn(id, "must refuse")).rejects.toThrow(/unverified/);
  expect(fixture.spawn).toHaveBeenCalledTimes(3);
});
