/**
 * Unit tests for the `tiers` block of `GET /api/llm/config` — the model each
 * tier resolves to, the key that supplied it, and what runs on it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

const classes = (r: TierRow): string[] => r.usedBy.flatMap((u) => (u.taskClass ? [u.taskClass] : []));

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
