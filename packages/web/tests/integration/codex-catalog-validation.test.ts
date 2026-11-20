/** Real model/list parsing through picker and saved-run validation; simulated transport. */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getLiveVendorProbe } from "../../src/server/llm-catalog.js";
import { buildLlmCatalog, validateCatalogModel } from "../../src/server/routes-llm.js";
import { checkSavedRun } from "../../src/server/task-run-settings.js";
import { validateRunOptions } from "../../src/server/run-options.js";

const mocks = vi.hoisted(() => ({ exec: vi.fn(), spawn: vi.fn(), stop: vi.fn() }));
vi.mock("../../../llm-client/src/exec.js", async (original) => ({
  ...await original<typeof import("../../../llm-client/src/exec.js")>(),
  exec: mocks.exec,
  spawnCli: mocks.spawn,
}));
vi.mock("../../../llm-client/src/process-tree.js", async (original) => ({
  ...await original<typeof import("../../../llm-client/src/process-tree.js")>(),
  terminateProcessTree: mocks.stop,
}));

let dir: string;
let models: string[];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ndx-codex-catalog-validation-"));
  await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({
    llm: { vendor: "codex", codex: { cli_path: "selected-codex" } },
  }));
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  mocks.exec.mockReset().mockResolvedValue({ launched: true, exitCode: 0, stdout: "codex-cli 0.167.0", stderr: "" });
  mocks.stop.mockReset().mockResolvedValue(undefined);
  mocks.spawn.mockReset().mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    });
    child.stdin.on("data", (chunk) => {
      const message = JSON.parse(String(chunk));
      if (message.method === "initialize" || message.method === "model/list") {
        const result = message.method === "initialize" ? {} : {
          data: models.map((model) => ({ model })), nextCursor: null,
        };
        child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
      }
    });
    return child;
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

it.each([false, true])("excludes unsupported provider IDs across discovery, picker and validation (mixed: %s)", async (mixed) => {
  models = mixed ? ["deployment-prod", "gpt-client-only"] : ["deployment-prod"];
  expect((await getLiveVendorProbe("codex", dir)).listing).toEqual({ ok: true, models });
  expect(mocks.spawn.mock.calls[0].slice(0, 2)).toEqual(["selected-codex", ["app-server"]]);

  const catalog = await buildLlmCatalog(dir, false);
  expect(catalog.codex).toMatchObject({
    models: mixed ? ["gpt-client-only"] : [],
    source: "live", provenance: "codex-client-catalog",
    reason: expect.stringMatching(/custom-provider.*excluded.*configure.*refresh/i),
  });
  expect(await validateCatalogModel(dir, "codex", "deployment-prod")).toContain("not a codex model");
  expect(await checkSavedRun(dir, { models: { codex: "deployment-prod" } })).toMatchObject({ ok: false });
  expect(await validateRunOptions(dir, { model: "deployment-prod" })).toMatchObject({ ok: false });
  for (const model of catalog.codex.models) {
    expect(await validateCatalogModel(dir, "codex", model)).toBeNull();
    expect((await checkSavedRun(dir, { models: { codex: model } })).ok).toBe(true);
    expect((await validateRunOptions(dir, { model })).ok).toBe(true);
  }
});
