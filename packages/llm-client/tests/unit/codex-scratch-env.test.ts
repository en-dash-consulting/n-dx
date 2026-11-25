import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { assertCodexScratchEnvironment, readCodexEffectiveConfig } from "../../src/codex-scratch-env.js";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), stop: vi.fn() }));
vi.mock("../../src/exec.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/exec.js")>(), spawnCli: mocks.spawn,
}));
vi.mock("../../src/process-tree.js", () => ({ terminateProcessTree: mocks.stop }));
afterEach(() => vi.restoreAllMocks());

function fixture(config: unknown, requirements: unknown = { requirements: null }) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
  });
  const messages: Array<{ method: string; params: unknown }> = [];
  child.stdin.on("data", chunk => {
    const message = JSON.parse(String(chunk));
    messages.push(message);
    if (message.id) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: message.id,
      result: message.method === "initialize" ? { userAgent: "fixture/0.167.0-alpha.3.2" }
        : message.method === "configRequirements/read" ? requirements : { config, layers: [] },
    }) + "\n"));
  });
  mocks.spawn.mockReset().mockReturnValue(child);
  mocks.stop.mockReset().mockResolvedValue(undefined);
  return { child, messages };
}

const temp = { TMPDIR: "/private/owned", TMP: "/private/owned", TEMP: "/private/owned" };
const options = { binary: "selected-codex", cwd: "/project", env: { PATH: "/trusted", ...temp },
  args: ["exec", "resume", "thread", "--strict-config", "--ignore-user-config", "-c", 'shell_environment_policy.set.TMPDIR="/private/owned"', "-"],
  scratchDir: temp.TMPDIR, timeoutMs: 100 };

describe("Codex effective scratch environment preflight", () => {
  it("reads actual requirements separately with layers enabled, never a model thread", async () => {
    const { messages } = fixture({ model: "fixture" });
    const result = await readCodexEffectiveConfig({ ...options, includeLayersAndRequirements: true });
    expect(result).toEqual({ config: { model: "fixture" }, layers: [], requirements: null, userAgent: "fixture/0.167.0-alpha.3.2" });
    expect(messages.map(m => [m.method, m.params])).toContainEqual(["config/read", { cwd: options.cwd, includeLayers: true }]);
    expect(messages.at(-1)).toMatchObject({ method: "configRequirements/read", params: {} });
  });

  it("does not normalize absent requirements to unmanaged", async () => {
    fixture({}, { supportsIndependentSpeedModes: true });
    await expect(readCodexEffectiveConfig({ ...options, includeLayersAndRequirements: true })).rejects.toThrow(/Cannot verify/);
  });

  it("returns no snapshot when cancelled between config/read and the requirements reply", async () => {
    const { child } = fixture({});
    child.stdin.removeAllListeners("data");
    const controller = new AbortController();
    const pending = readCodexEffectiveConfig({ ...options, includeLayersAndRequirements: true, signal: controller.signal });
    child.stdout.write('{"id":1,"result":{}}\n');
    child.stdout.write('{"id":2,"result":{"config":{},"layers":[]}}\n');
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it.each(["unsupported", "malformed", "exit"])("refuses a %s requirements RPC without exposing its diagnostic", async kind => {
    const { child } = fixture({});
    child.stdin.removeAllListeners("data");
    child.stdin.on("data", chunk => {
      const message = JSON.parse(String(chunk));
      if (!message.id) return;
      queueMicrotask(() => {
        if (message.id === 1) child.stdout.write('{"id":1,"result":{}}\n');
        if (message.id === 2) child.stdout.write('{"id":2,"result":{"config":{},"layers":[]}}\n');
        if (message.id === 3) {
          if (kind === "exit") child.emit("close", 1);
          else child.stdout.write(kind === "unsupported" ? '{"id":3,"error":{"message":"private-canary"}}\n' : 'private-canary\n');
        }
      });
    });
    await expect(readCodexEffectiveConfig({ ...options, includeLayersAndRequirements: true })).rejects.toThrow(UNVERIFIED_PATTERN);
  });
  it.each([undefined, [], ["PATH", "TMPDIR", "TMP", "TEMP"], ["*"]].map(include_only => ({ include_only })))("accepts usable temp with $include_only", async ({ include_only }) => {
    const config = { shell_environment_policy: { set: temp, include_only, exclude: ["PRIVATE_VALUE"] } };
    const before = JSON.stringify(config);
    const { messages } = fixture(config);
    await assertCodexScratchEnvironment(options);
    expect(JSON.stringify(config)).toBe(before);
    expect(messages.map(m => m.method)).toEqual(["initialize", "initialized", "config/read"]);
    expect(messages[2].params).toEqual({ cwd: "/project", includeLayers: false });
    expect(mocks.spawn.mock.calls[0][1]).toEqual(["app-server", "--strict-config", "--ignore-user-config", "-c", options.args[6]]);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it.each([["PATH"], ["TMPDIR"], ["PATH", "TMP", "TEMP"]].map(include_only => ({ include_only })))("refuses $include_only before starting a thread", async ({ include_only }) => {
    const { messages } = fixture({ shell_environment_policy: { set: temp, include_only } });
    await expect(assertCodexScratchEnvironment(options)).rejects.toThrow(/include_only.*TMPDIR.*TMP.*TEMP/);
    expect(messages.some(m => m.method.startsWith("thread/"))).toBe(false);
  });

  it.each([{}, { shell_environment_policy: {} }, { shell_environment_policy: { set: { ...temp, TMPDIR: "/tmp" } } },
    { shell_environment_policy: { set: temp, filters: { TMPDIR: "exclude" } } }])("fails closed on unverified effective config %j", async config => {
    fixture(config);
    await expect(assertCodexScratchEnvironment(options)).rejects.toThrow(/private temp/);
  });

  it("bounds a hung/unsupported client and does not publish its output", async () => {
    const { child } = fixture({});
    child.stdin.removeAllListeners("data");
    const pending = assertCodexScratchEnvironment({ ...options, timeoutMs: 10 });
    child.stderr.write("secret-value");
    await expect(pending).rejects.toThrow(/config\/read.*strict-config/);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("preserves profile and configuration overrides in order", async () => {
    fixture({ shell_environment_policy: { set: temp } });
    const flags = ["--profile", "private", "--config=shell_environment_policy.include_only=[]", "-cfoo=true", "--disable", "apps"];
    await assertCodexScratchEnvironment({ ...options, args: ["exec", ...flags, "-"] });
    expect(mocks.spawn.mock.calls[0][1]).toEqual(["app-server", "--strict-config", ...flags]);
  });

  it.each(["--ignore-user-config", "--profile", "-p"])("identifies native app-server rejection of %s", async flag => {
    const { child } = fixture({});
    child.stdin.removeAllListeners("data");
    const extra = flag === "--ignore-user-config" ? [flag] : [flag, "private"];
    const pending = assertCodexScratchEnvironment({ ...options, args: ["exec", ...extra, "-"] });
    child.stderr.write("confidential fixture text\nerror: unexpected argu");
    child.stderr.write("ment '" + flag + "' found\n");
    child.emit("close", 2);
    await expect(pending).rejects.toMatchObject({
      message: expect.stringContaining("app-server rejects " + flag),
      retryable: false,
    });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it.each(["--trust", "--cd=/other", "-C/other", "--worktree"])("refuses unverified config context %s", async flag => {
    fixture({ shell_environment_policy: { set: temp } });
    await expect(assertCodexScratchEnvironment({ ...options, args: ["exec", flag, "-"] })).rejects.toMatchObject({
      message: expect.stringMatching(/cwd\/trust/), retryable: false,
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("reads a private temp path split within a UTF-8 character", async () => {
    const scratchDir = "/private/café";
    const set = { TMPDIR: scratchDir, TMP: scratchDir, TEMP: scratchDir };
    const { child } = fixture({});
    child.stdin.removeAllListeners("data");
    const pending = assertCodexScratchEnvironment({ ...options, scratchDir });
    child.stdout.write('{"id":1,"result":{}}\n');
    const reply = Buffer.from(JSON.stringify({ id: 2, result: { config: { shell_environment_policy: { set } } } }) + "\n");
    const split = reply.indexOf(Buffer.from("é")) + 1;
    child.stdout.write(reply.subarray(0, split));
    child.stdout.write(reply.subarray(split));
    await pending;
  });

  it("cancels a pending config read without creating a model thread", async () => {
    const { child, messages } = fixture({});
    child.stdin.removeAllListeners("data");
    const controller = new AbortController();
    const pending = assertCodexScratchEnvironment({ ...options, signal: controller.signal });
    controller.abort("original cancellation");
    await pending;
    expect(messages).toEqual([]);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it.each(["malformed", "rejected", "exit", "oversized"])("fails closed on %s native config responses", async kind => {
    const { child } = fixture({});
    child.stdin.removeAllListeners("data");
    const pending = assertCodexScratchEnvironment(options);
    if (kind === "malformed") child.stdout.write("secret invalid JSON\n");
    if (kind === "rejected") child.stdout.write('{"id":1,"error":{"message":"secret config"}}\n');
    if (kind === "exit") child.emit("close", 2);
    if (kind === "oversized") child.stdout.write("x".repeat(1024 * 1024 + 1));
    await expect(pending).rejects.toThrow(UNVERIFIED_PATTERN);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });
});

const UNVERIFIED_PATTERN = /^Cannot verify Codex private temp environment before execution\./;
