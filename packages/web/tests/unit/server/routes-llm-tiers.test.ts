/**
 * Unit tests for the `tiers` block of `GET /api/llm/config` — the model each
 * tier resolves to, the key that supplied it, and what runs on it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { DEFAULT_ROUTES, TIER_MODELS, resolveModel, resolveTaskModel } from "@n-dx/llm-client";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";
import { TASK_CLASS_LABELS } from "../../../src/server/llm-tiers.js";
import type { TierRow } from "../../../src/server/llm-tiers.js";

let projectDir: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "ndx-llm-tiers-"));
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

async function tiers(config: unknown = {}): Promise<TierRow[]> {
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify(config), "utf-8");
  const res = await fetch(`${baseUrl}/api/llm/config`);
  expect(res.status).toBe(200);
  return (await res.json()).tiers;
}

const row = (rows: TierRow[], tier: string): TierRow => {
  const found = rows.find((r) => r.tier === tier);
  if (!found) throw new Error(`no ${tier} row in ${rows.map((r) => r.tier).join(",")}`);
  return found;
};

const classes = (r: TierRow): string[] => r.usedBy.flatMap((u) => u.taskClasses ?? []);

describe("GET /api/llm/config — tiers block", () => {
  it("returns agent, standard, light and heavy, and no free row by default", async () => {
    const rows = await tiers({ llm: { vendor: "claude" } });
    expect(rows.map((r) => r.tier)).toEqual(["agent", "standard", "light", "heavy"]);
    expect(row(rows, "light").model).toBe(resolveModel(TIER_MODELS.claude.light));
    expect(row(rows, "heavy").model).toBe(resolveModel(TIER_MODELS.claude.heavy));
    for (const t of ["standard", "light", "heavy"]) expect(row(rows, t).source).toBe("catalog default");
  });

  it("reports the model and key resolveTaskModel resolves for each tier", async () => {
    const llm = {
      vendor: "claude",
      claude: { model: "sonnet", lightModel: "haiku" },
      tiers: { claude: { heavy: "opus" } },
    };
    const rows = await tiers({ llm });
    for (const tier of ["standard", "light", "heavy"] as const) {
      const expected = resolveTaskModel("agent.execute", { ...llm, routes: { "agent.execute": tier } } as never, {
        vendor: "claude",
      });
      expect(row(rows, tier).model).toBe(expected.model);
    }
    expect(row(rows, "standard").source).toBe("llm.claude.model");
    expect(row(rows, "light").source).toBe("llm.claude.lightModel");
    expect(row(rows, "heavy").source).toBe("llm.tiers.claude.heavy");
  });

  it("agent row follows hench.models.<vendor> over the tier chain", async () => {
    const rows = await tiers({
      llm: { vendor: "claude", claude: { model: "sonnet" } },
      hench: { models: { claude: "opus" } },
    });
    expect(row(rows, "agent").model).toBe(resolveModel("opus"));
    expect(row(rows, "agent").source).toBe("hench.models.claude");
    expect(classes(row(rows, "agent"))).toEqual(["agent.execute"]);
    expect(row(rows, "agent").usedBy[0]?.label).toBe("ndx work");
  });

  it("includes free only when llm.tiers.<vendor>.free is configured", async () => {
    const rows = await tiers({
      llm: { vendor: "claude", tiers: { claude: { free: "haiku" } }, routes: { "prd.merge": "free" } },
    });
    const free = row(rows, "free");
    expect(free.source).toBe("llm.tiers.claude.free");
    expect(classes(free)).toEqual(["prd.merge"]);
  });

  it("groups task classes by default tier, and heavy lists Prepare task", async () => {
    const rows = await tiers({ llm: { vendor: "claude" } });
    expect(classes(row(rows, "light"))).toContain("prd.rename");
    expect(classes(row(rows, "standard"))).toContain("prd.propose");
    expect(classes(row(rows, "standard"))).not.toContain("agent.execute");
    expect(row(rows, "heavy").usedBy.map((u) => u.label)).toEqual(["tasks set to Heavy in Prepare task"]);
    expect(row(rows, "heavy").usedBy[0]).not.toHaveProperty("taskClass");
  });

  it("never repeats a label within a tier, and folds suffix-only variants", async () => {
    for (const config of [{}, { routes: { "prd.*": "heavy" } }]) {
      const rows = await tiers({ llm: { vendor: "claude", ...config } });
      for (const r of rows) {
        const labels = r.usedBy.map((u) => u.label);
        expect(new Set(labels).size).toBe(labels.length);
        expect(labels.filter((l) => /\([^)]*\)$/.test(l))).toEqual([]);
      }
    }
  });

  it("folds classes sharing a label into one entry that still names each class", async () => {
    const rows = await tiers({ llm: { vendor: "claude", routes: { "prd.place": "heavy", "prd.place.judge": "heavy" } } });
    const heavy = row(rows, "heavy");
    const place = heavy.usedBy.filter((u) => u.label === "change placement");
    expect(place).toHaveLength(1);
    expect(place[0].taskClasses).toEqual(["prd.place", "prd.place.judge"]);
    expect(place[0].taskClass).toBe("prd.place");

    const light = row(await tiers({ llm: { vendor: "claude" } }), "light");
    const rename = light.usedBy.filter((u) => u.label === "rename/merge");
    expect(rename).toHaveLength(1);
    expect(rename[0].taskClasses).toEqual(["prd.rename", "prd.merge"]);
  });

  it("lists rename under heavy, not light, when llm.routes sets it", async () => {
    const rows = await tiers({ llm: { vendor: "claude", routes: { "prd.rename": "heavy" } } });
    expect(classes(row(rows, "heavy"))).toContain("prd.rename");
    expect(classes(row(rows, "light"))).not.toContain("prd.rename");
    expect(classes(row(rows, "light"))).toContain("prd.merge");
  });

  it("honours glob routes the way resolveTaskModel does", async () => {
    const rows = await tiers({ llm: { vendor: "claude", routes: { "prd.*": "heavy" } } });
    expect(classes(row(rows, "heavy"))).toContain("prd.propose");
    expect(classes(row(rows, "standard"))).not.toContain("prd.propose");
  });
});

describe("task class labels", () => {
  it("covers every DEFAULT_ROUTES key", () => {
    const missing = Object.keys(DEFAULT_ROUTES).filter((k) => !TASK_CLASS_LABELS[k]);
    expect(missing).toEqual([]);
  });

  it("has no label for a class DEFAULT_ROUTES no longer routes", () => {
    const stale = Object.keys(TASK_CLASS_LABELS).filter((k) => !(k in DEFAULT_ROUTES));
    expect(stale).toEqual([]);
  });
});

/**
 * `isWritablePath` accepts any `llm.tiers.*` suffix, and a delete used to skip
 * the `<vendor>.<tier>` shape check, so `llm.tiers.__proto__.toString: null`
 * walked `deleteByPath` through `config.llm.tiers["__proto__"]` — which is
 * Object.prototype — and removed its `toString` from the server process.
 *
 * Every request here is sent through `send`, which restores the original
 * method before any assertion runs, so a regression surfaces as a failed
 * expectation rather than a test process with no `toString`.
 */
describe("PUT /api/llm/config — prototype-chain paths", () => {
  const seed = JSON.stringify({ llm: { vendor: "claude", tiers: { claude: { light: "haiku" } } } });
  const originalToString = Object.prototype.toString;

  async function send(
    method: "PUT" | "POST",
    path: string,
    changes: Record<string, unknown>,
  ): Promise<{ res: Response; prototypeIntact: boolean }> {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      return { res, prototypeIntact: Object.prototype.hasOwnProperty("toString") };
    } finally {
      if (!Object.prototype.hasOwnProperty("toString")) {
        Object.defineProperty(Object.prototype, "toString", {
          value: originalToString,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      }
    }
  }

  it("refuses a delete through __proto__ and leaves Object.prototype alone", async () => {
    const configPath = join(projectDir, ".n-dx.json");
    for (const value of [null, ""]) {
      await writeFile(configPath, seed, "utf-8");
      const { res, prototypeIntact } = await send("PUT", "/api/llm/config", {
        "llm.tiers.__proto__.toString": value,
      });
      const label = `value ${JSON.stringify(value)}`;
      expect(prototypeIntact, label).toBe(true);
      expect(res.status, label).toBe(400);
      expect(await res.text(), label).toContain("__proto__");
      expect(await readFile(configPath, "utf-8"), label).toBe(seed);
    }
  });

  it("refuses llm.routes.__proto__ rather than answering 200 for a silent no-op", async () => {
    const configPath = join(projectDir, ".n-dx.json");
    await writeFile(configPath, seed, "utf-8");
    const { res } = await send("PUT", "/api/llm/config", { "llm.routes.__proto__": "light" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("__proto__");
    expect(await readFile(configPath, "utf-8")).toBe(seed);
  });

  it("reports the same paths as edit problems in the preview and applies neither", async () => {
    await writeFile(join(projectDir, ".n-dx.json"), seed, "utf-8");
    const { res, prototypeIntact } = await send("POST", "/api/llm/config/preview", {
      "llm.tiers.__proto__.toString": null,
      "llm.routes.__proto__": "light",
    });
    expect(prototypeIntact).toBe(true);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.editProblems.map((p: { path: string }) => p.path).sort()).toEqual([
      "llm.routes.__proto__",
      "llm.tiers.__proto__.toString",
    ]);
  });

  it("holds a delete to the llm.tiers.<vendor>.<tier> shape, and still clears a tier", async () => {
    const configPath = join(projectDir, ".n-dx.json");
    await writeFile(configPath, seed, "utf-8");
    const whole = await send("PUT", "/api/llm/config", { "llm.tiers.claude": null });
    expect(whole.res.status).toBe(400);
    expect(await whole.res.text()).toContain("llm.tiers.<vendor>.<tier>");
    expect(await readFile(configPath, "utf-8")).toBe(seed);

    const one = await send("PUT", "/api/llm/config", { "llm.tiers.claude.light": null });
    expect(one.res.status).toBe(200);
    const after = JSON.parse(await readFile(configPath, "utf-8"));
    expect(after.llm.tiers.claude.light).toBeUndefined();
  });
});
