/**
 * Unit tests for the `effective` block of `GET /api/llm/config` — what
 * `ndx work` runs in this project with no flags.
 *
 * These cover the route's own behaviour: that it reads both files, applies the
 * rungs in order, and degrades rather than throwing on a config hench would
 * refuse. Agreement with hench's actual resolution is a separate question and
 * is pinned by `tests/integration/effective-agent-config-contract.test.js`,
 * which runs the same fixtures through `resolveAgentModel` itself.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { TIER_MODELS, resolveModel } from "@n-dx/llm-client";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";

let projectDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-effective-"));
  server = createServer((req, res) => {
    void handleLlmRoute(req, res, { projectDir } as never).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(projectDir, { recursive: true, force: true });
});

async function writeNdxConfig(config: unknown): Promise<void> {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(config, null, 2), "utf-8");
}

async function writeHenchConfig(config: unknown): Promise<void> {
  await mkdir(join(projectDir, ".hench"), { recursive: true });
  await writeFile(
    join(projectDir, ".hench", "config.json"),
    JSON.stringify(config, null, 2),
    "utf-8",
  );
}

async function effective(): Promise<{
  vendor: string;
  provider: string;
  model: string;
  modelSource: string;
}> {
  const res = await fetch(`${baseUrl}/api/llm/config`);
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.effective;
}

describe("GET /api/llm/config — effective block", () => {
  it("defaults to claude on the vendor default when nothing is configured", async () => {
    // No .n-dx.json and no .hench/config.json at all: the state a project is
    // in before `ndx init`, which is exactly when someone opens the page to
    // find out what pressing Run would do.
    expect(await effective()).toEqual({
      vendor: "claude",
      provider: "cli",
      model: resolveModel(TIER_MODELS.claude.standard),
      modelSource: "default",
    });
  });

  it("reports the vendor default as 'default', not 'configured'", async () => {
    await writeNdxConfig({ llm: { vendor: "codex" } });

    const result = await effective();
    expect(result.vendor).toBe("codex");
    expect(result.modelSource).toBe("default");
    expect(result.model).toBe(resolveModel(TIER_MODELS.codex.standard));
  });

  it("reports a pinned llm.<vendor>.model as 'configured'", async () => {
    await writeNdxConfig({ llm: { vendor: "claude", claude: { model: "opus" } } });

    expect(await effective()).toMatchObject({
      model: resolveModel("opus"),
      modelSource: "configured",
    });
  });

  it("reports the vendor-neutral llm.model as 'configured'", async () => {
    await writeNdxConfig({ llm: { vendor: "claude", model: "opus" } });

    expect(await effective()).toMatchObject({
      model: resolveModel("opus"),
      modelSource: "configured",
    });
  });

  it("hench.models.<vendor> outranks llm.<vendor>.model", async () => {
    // The whole point of the agent-only override: `analyze`, `plan` and Ask
    // keep resolving from llm.*, so a page that showed only llm.claude.model
    // would name a model `ndx work` does not run.
    await writeNdxConfig({ llm: { vendor: "claude", claude: { model: "opus" } } });
    await writeHenchConfig({ models: { claude: "haiku" } });

    expect(await effective()).toMatchObject({
      model: resolveModel("haiku"),
      modelSource: "hench-override",
    });
  });

  it("reads hench.models for the active vendor only", async () => {
    // An override pinned for a vendor that is not active must not leak into
    // the answer.
    await writeNdxConfig({ llm: { vendor: "codex" } });
    await writeHenchConfig({ models: { claude: "haiku" } });

    expect(await effective()).toMatchObject({
      vendor: "codex",
      model: resolveModel(TIER_MODELS.codex.standard),
      modelSource: "default",
    });
  });

  it("treats a whitespace-only hench.models entry as unset", async () => {
    await writeNdxConfig({ llm: { vendor: "claude" } });
    await writeHenchConfig({ models: { claude: "   " } });

    expect(await effective()).toMatchObject({ modelSource: "default" });
  });

  it("honours an llm.routes override for the agent.execute class", async () => {
    // The agent loop is routable — this is the rung that makes `effective`
    // more than a re-read of llm.claude.model.
    await writeNdxConfig({
      llm: { vendor: "claude", routes: { "agent.execute": "heavy" } },
    });

    expect(await effective()).toMatchObject({
      model: resolveModel(TIER_MODELS.claude.heavy),
      modelSource: "default",
    });
  });

  it("lets .n-dx.local.json override the shared vendor", async () => {
    await writeNdxConfig({ llm: { vendor: "claude" } });
    await writeFile(
      join(projectDir, ".n-dx.local.json"),
      JSON.stringify({ llm: { vendor: "codex" } }),
      "utf-8",
    );

    expect(await effective()).toMatchObject({ vendor: "codex" });
  });

  describe("provider", () => {
    it("reports hench.provider when the vendor accepts it", async () => {
      await writeNdxConfig({ llm: { vendor: "claude" } });
      await writeHenchConfig({ provider: "api" });

      expect(await effective()).toMatchObject({ provider: "api" });
    });

    it("switches an unsupported 'cli' to 'api', as hench does", async () => {
      // google has no CLI binary. hench auto-switches rather than failing, so
      // reporting "cli" here would name a provider the run will not use.
      await writeNdxConfig({ llm: { vendor: "google" } });
      await writeHenchConfig({ provider: "cli" });

      expect(await effective()).toMatchObject({ vendor: "google", provider: "api" });
    });

    it("switches 'cli' to 'api' for local too", async () => {
      await writeNdxConfig({ llm: { vendor: "local" } });
      await writeHenchConfig({ provider: "cli" });

      expect(await effective()).toMatchObject({ vendor: "local", provider: "api" });
    });

    it("defaults to 'cli' when .hench/config.json is absent", async () => {
      await writeNdxConfig({ llm: { vendor: "claude" } });

      expect(await effective()).toMatchObject({ provider: "cli" });
    });

    it("falls back to 'cli' on an unparseable hench config", async () => {
      // hench loads its config with onInvalid: "use-defaults", so a bad file
      // degrades to the default there; a 500 here would leave the settings
      // page unable to show the value someone needs to fix.
      await writeNdxConfig({ llm: { vendor: "claude" } });
      await mkdir(join(projectDir, ".hench"), { recursive: true });
      await writeFile(join(projectDir, ".hench", "config.json"), "{ not json", "utf-8");

      expect(await effective()).toMatchObject({ provider: "cli" });
    });

    it("falls back to 'cli' on a provider value outside cli/api", async () => {
      await writeNdxConfig({ llm: { vendor: "claude" } });
      await writeHenchConfig({ provider: "telepathy" });

      expect(await effective()).toMatchObject({ provider: "cli" });
    });

    it("reports codex+api unchanged rather than throwing", async () => {
      // hench refuses this combination outright — there is no supported
      // provider to switch to. The route reports the resolution and leaves
      // the refusal to validateProviderForVendor, so the page still renders.
      await writeNdxConfig({ llm: { vendor: "codex" } });
      await writeHenchConfig({ provider: "api" });

      expect(await effective()).toMatchObject({ vendor: "codex", provider: "api" });
    });
  });

  it("is refreshed in the PUT response", async () => {
    await writeNdxConfig({ llm: { vendor: "claude" } });

    const res = await fetch(`${baseUrl}/api/llm/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes: { "llm.claude.model": "opus" } }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.config.effective).toMatchObject({
      model: resolveModel("opus"),
      modelSource: "configured",
    });
  });
});
