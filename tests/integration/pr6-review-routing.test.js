import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveReviewModel, resolveTaskModel } from "../../packages/llm-client/dist/public.js";
import { handleLlmRoute } from "../../packages/web/dist/server/routes-llm.js";

let projectDir;
beforeEach(() => { projectDir = mkdtempSync(join(import.meta.dirname, "../../.tmp-pr6-review-")); });
afterEach(() => { rmSync(projectDir, { recursive: true, force: true }); });

it.each([undefined, "heavy", "light"])("keeps effort-only review out of tier claims (route=%s)", async route => {
  const llm = {
    vendor: "claude",
    ...(route ? { routes: { "agent.review": route } } : {}),
    effort: { "agent.*": "low", "agent.review": "high" },
  };
  for (const pin of [undefined, "haiku"]) {
    llm.claude = pin ? { reviewModel: pin } : {};
    writeFileSync(join(projectDir, ".n-dx.json"), JSON.stringify({ llm }));
    let config;
    const res = { writeHead(status) { expect(status).toBe(200); }, end(body) { config = JSON.parse(body); } };
    expect(await handleLlmRoute({ method: "GET", url: "/api/llm/config" }, res, { projectDir })).toBe(true);
    expect(config.tiers.flatMap(r => r.usedBy.flatMap(u => u.taskClasses ?? []))).not.toContain("agent.review");
    expect(config.routeOverrides.some(r => r.taskClass === "agent.review")).toBe(false);
    expect(config.review.models.claude.model).toBe(resolveReviewModel("claude", llm));
    expect(config.review.models.claude.source).toBe(pin ? "vendor-config" : "vendor-default");
    expect(resolveTaskModel("agent.review", llm).effort).toBe("high");
  }
});
