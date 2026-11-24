import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexCliClient } from "../../src/codex-cli-provider.js";
import { createOpenAiApiProvider } from "../../src/openai-api-provider.js";
import { resolveOpenAiEffort } from "../../src/codex-effort.js";
import { resolveTaskModel } from "../../src/config.js";
import { codexSessionDriver } from "../../src/vendor-session-driver.js";
import { writeFakeCli } from "../helpers/fake-cli.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Codex effort at completion boundaries", () => {
  it.each([undefined, "high", "ultra", "max", "bogus"])("CLI checks advertised efforts, preserving operator flags: %s", async (effort) => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = await mkdtemp(join(tmpdir(), "codex-effort-"));
    try {
      const binary = writeFakeCli(dir, { name: "codex", script: `
        import fs from 'node:fs';
        import readline from 'node:readline';
        const args = process.argv.slice(2);
        if (args[0] === 'app-server') {
          for await (const line of readline.createInterface({ input: process.stdin })) {
            const msg = JSON.parse(line);
            if (msg.method === 'initialize') console.log(JSON.stringify({ id: msg.id, result: {} }));
            if (msg.method === 'config/read') {
              const set = {};
              for (const arg of args) {
                const match = /^shell_environment_policy\\.set\\.(TMPDIR|TMP|TEMP)=(.*)$/.exec(arg);
                if (match) set[match[1]] = JSON.parse(match[2]);
              }
              console.log(JSON.stringify({id:msg.id,result:{config:{shell_environment_policy:{set}}}}));
            }
            if (msg.method === 'model/list') console.log(JSON.stringify({ id: msg.id, result: {
              data: [{ model: 'custom-model', supportedReasoningEfforts: [{reasoningEffort:'high'}, {reasoningEffort:'ultra'}] }], nextCursor: null
            } }));
          }
        } else {
          for await (const chunk of process.stdin) { /* drain prompt */ }
          fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(args));
        }
      ` });
      const client = createCodexCliClient({ codexConfig: { cli_path: binary }, maxRetries: 0 });
      const result = await client.complete({ model: "custom-model", prompt: "fixture", effort,
        cliFlags: ["-c", 'model_reasoning_effort="low"'] });
      const args = JSON.parse(result.text) as string[];
      const overrides = args.filter(x => x.startsWith("model_reasoning_effort="));
      const supported = effort === "high" || effort === "ultra";
      expect(overrides).toEqual(supported
        ? ['model_reasoning_effort="low"', `model_reasoning_effort="${effort}"`]
        : ['model_reasoning_effort="low"']);
      expect(warning).toHaveBeenCalledTimes(effort && !supported ? 1 : 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([undefined, "high", "max", "ultra", "none", "invalid"])("blocking and streaming APIs agree: %s", async (effort) => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] })))
      .mockResolvedValueOnce(new Response("data: [DONE]\n\n"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAiApiProvider({ codexConfig: { api_key: "fixture" }, maxRetries: 0 });
    const request = { model: "gpt-6.1-sol", prompt: "fixture", effort, taskClass: "agent.review" };
    await provider.complete(request);
    await Array.fromAsync(provider.stream!(request));
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(init.body);
      if (effort === "high" || effort === "max") expect(body.reasoning_effort).toBe(effort);
      else expect(body).not.toHaveProperty("reasoning_effort");
    }
    expect(warning).toHaveBeenCalledTimes(effort && !["high", "max"].includes(effort) ? 2 : 0);
  });

  it("does not infer API capabilities from unknown model prefixes", () => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(resolveOpenAiEffort("gpt-6-unverified", "high")).toBeUndefined();
    expect(resolveOpenAiEffort("gpt-4o", "low")).toBeUndefined();
    expect(resolveOpenAiEffort("constructor", "low")).toBeUndefined();
    expect(resolveOpenAiEffort("gpt-6-sol", "none")).toBe("none");
    expect(resolveOpenAiEffort("gpt-6.1-terra", "none")).toBe("none");
    expect(resolveOpenAiEffort("gpt-6-luna", "none")).toBe("none");
    expect(resolveOpenAiEffort("gpt-5", "minimal")).toBe("minimal");
    expect(resolveOpenAiEffort("o3-2025-04-16", "low")).toBe("low");
    expect(resolveOpenAiEffort("gpt-5", "max")).toBeUndefined();
    expect(warning).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["agent.execute", "low"],
    ["agent.review", "max"],
    ["prd.propose", undefined],
  ] as const)("carries configured effort precedence to both API paths for %s", async (taskClass, expected) => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] })))
      .mockResolvedValueOnce(new Response("data: [DONE]\n\n"));
    vi.stubGlobal("fetch", fetchMock);
    const resolution = resolveTaskModel(taskClass, {
      vendor: "codex",
      tiers: { codex: { heavy: "gpt-6.1-sol" } },
      routes: { "*": "heavy" },
      effort: { "agent.*": "low", "agent.review": "max" },
    });
    const provider = createOpenAiApiProvider({ codexConfig: { api_key: "fixture" }, maxRetries: 0 });
    const request = { prompt: "fixture", model: resolution.model, effort: resolution.effort, taskClass };
    await provider.complete(request);
    await Array.fromAsync(provider.stream!(request));
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(init.body);
      expect(body.model).toBe("gpt-6.1-sol");
      if (expected === undefined) expect(body).not.toHaveProperty("reasoning_effort");
      else expect(body.reasoning_effort).toBe(expected);
    }
    expect(warning).not.toHaveBeenCalled();
  });

  it.each([false, true])("session driver carries validated effort on fresh/resumed turns (%s)", (resume) => {
    const args = codexSessionDriver.turnSpawn({ systemPrompt: "", prompt: "fixture", model: "custom-model",
      ...(resume ? { resume: { sessionId: "fixture-id" } } : {}),
      codex: { configFlags: ["-c", 'model_reasoning_effort="low"'], effort: "high" },
    }).args;
    expect(args.filter(x => x.startsWith("model_reasoning_effort=")))
      .toEqual(['model_reasoning_effort="low"', 'model_reasoning_effort="high"']);
  });
});
