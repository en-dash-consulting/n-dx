/**
 * `PUT /api/llm/config` and the per-vendor agent model override
 * (`hench.models.<vendor>`), plus the vendor-compatibility check on
 * `llm.<vendor>.model` / `llm.<vendor>.lightModel`.
 *
 * Covers all four vendors for both fields. `local` runs whatever the server
 * has loaded, so it accepts any id; the cloud vendors refuse another vendor's
 * model with a 400 naming the vendor, because `ndx work` would otherwise fail
 * on the saved value.
 *
 * @see packages/web/src/server/routes-llm.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";

let projectDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-hench-models-"));
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
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(projectDir, { recursive: true, force: true });
});

async function writeConfig(config: unknown): Promise<void> {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(config, null, 2), "utf-8");
}

async function readConfig(): Promise<Record<string, unknown>> {
  // A refused write leaves no file behind when none existed — that is `{}`.
  return JSON.parse(await readFile(join(projectDir, ".n-dx.json"), "utf-8").catch(() => "{}"));
}

function put(changes: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/llm/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ changes }),
  });
}

/** One model each vendor runs, and one it does not. */
const MODELS = {
  claude: { ok: "claude-sonnet-5", wrong: "gpt-5.5" },
  codex: { ok: "gpt-5.5", wrong: "claude-sonnet-5" },
  google: { ok: "gemini-2.5-pro", wrong: "gpt-5.5" },
  local: { ok: "qwen3-coder-30b", wrong: "claude-sonnet-5" },
} as const;
const VENDORS = Object.keys(MODELS) as Array<keyof typeof MODELS>;

describe("PUT /api/llm/config — hench.models.<vendor>", () => {
  it.each(VENDORS)("saves a %s agent model into .n-dx.json and reports it as agentModels", async (vendor) => {
    await writeConfig({ llm: { vendor } });

    const res = await put({ [`hench.models.${vendor}`]: MODELS[vendor].ok });

    expect(res.status).toBe(200);
    const body = await res.json() as { config: { agentModels: Record<string, string> } };
    expect(body.config.agentModels).toEqual({ [vendor]: MODELS[vendor].ok });
    expect(((await readConfig()).hench as { models: Record<string, string> }).models[vendor]).toBe(MODELS[vendor].ok);
  });

  it.each(VENDORS)("accepts a %s model the vendor cannot run only for local", async (vendor) => {
    await writeConfig({ llm: { vendor } });

    const res = await put({ [`hench.models.${vendor}`]: MODELS[vendor].wrong });

    if (vendor === "local") {
      expect(res.status).toBe(200);
      return;
    }
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(vendor);
    expect((await readConfig()).hench).toBeUndefined();
  });

  it("deletes the override on null and leaves no empty hench block behind", async () => {
    await writeConfig({ llm: { vendor: "claude" }, hench: { models: { claude: "claude-opus-5" } } });

    const res = await put({ "hench.models.claude": null });

    expect(res.status).toBe(200);
    expect((await res.json() as { config: { agentModels: unknown } }).config.agentModels).toEqual({});
    const config = await readConfig();
    expect(config.hench).toBeUndefined();
    expect(config.llm).toEqual({ vendor: "claude" });
  });

  it("keeps other vendors' overrides and other hench keys when one is cleared", async () => {
    await writeConfig({ hench: { maxTurns: 9, models: { claude: "claude-opus-5", codex: "gpt-5.5" } } });

    await put({ "hench.models.claude": null });

    expect((await readConfig()).hench).toEqual({ maxTurns: 9, models: { codex: "gpt-5.5" } });
  });

  it("refuses an unknown vendor key rather than writing it (hench's schema is strict)", async () => {
    const res = await put({ "hench.models.gemini": "gemini-2.5-pro" });
    expect(res.status).toBe(400);
  });

  it("never writes hench.model", async () => {
    const res = await put({ "hench.model": "claude-sonnet-5" });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/llm/config — llm.<vendor>.model and lightModel", () => {
  const FIELDS = ["model", "lightModel"] as const;

  for (const vendor of VENDORS) {
    for (const field of FIELDS) {
      const path = `llm.${vendor}.${field}`;

      it(`${path}: saves a ${vendor} model`, async () => {
        const res = await put({ [path]: MODELS[vendor].ok });
        expect(res.status).toBe(200);
        const llm = (await readConfig()).llm as Record<string, Record<string, string>>;
        expect(llm[vendor][field]).toBe(MODELS[vendor].ok);
      });

      if (vendor === "local") {
        it(`${path}: accepts any id (the server decides)`, async () => {
          expect((await put({ [path]: MODELS.local.wrong })).status).toBe(200);
        });
      } else {
        it(`${path}: rejects another vendor's model with a 400 naming ${vendor}`, async () => {
          const res = await put({ [path]: MODELS[vendor].wrong });
          expect(res.status).toBe(400);
          expect(((await res.json()) as { error: string }).error).toContain(vendor);
          expect((await readConfig()).llm).toBeUndefined();
        });
      }

      it(`${path}: clearing is always allowed`, async () => {
        await writeConfig({ llm: { [vendor]: { [field]: MODELS[vendor].ok } } });
        expect((await put({ [path]: null })).status).toBe(200);
      });
    }
  }

  it("applies none of a batch when one change is refused", async () => {
    await writeConfig({ llm: { vendor: "codex" } });

    const res = await put({ "llm.vendor": "claude", "llm.claude.model": "gpt-5.5" });

    expect(res.status).toBe(400);
    expect((await readConfig()).llm).toEqual({ vendor: "codex" });
  });
});
