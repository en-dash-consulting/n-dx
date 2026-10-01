/**
 * Redirect aliases for view paths merged into a stage in 0.8.0
 * (src/shared/view-routing.ts, consumed by the SPA catch-all below).
 *
 * `/overview` and `/rex-dashboard` used to be their own top-level pages;
 * both are now the lead section of a stage (`analyze`, `work`) and should
 * 302 there instead of serving the orphaned bare view. The one exception is
 * a rex-scoped viewer, which has no Work stage, so `/rex-dashboard` keeps
 * being served as its own page there. `/llm-provider` was renamed to
 * `/robot-wrangler`, and `/hench-config`, `/cli-timeouts` and
 * `/hench-templates` merged into `/workflow`, and `/project-settings`,
 * `/feature-toggles`, `/notion-config` and `/integrations` merged into
 * `/project`; all redirect the same way.
 */

import { describe, it, expect } from "vitest";
import type { ServerContext } from "../../../src/server/types.js";
import { handleStaticRoute, type StaticAssets } from "../../../src/server/routes-static.js";
import { startRouteTestServer } from "../../helpers/server-route-test-support.js";

/** A minimal StaticAssets stub — the redirect paths never reach the viewer HTML. */
const ASSETS: StaticAssets = {
  viewerPath: "/nonexistent/index.html",
  viewerDir: "/nonexistent",
  resolvedViewerDir: "/nonexistent",
  resolvedPackageRoot: "/nonexistent",
  getViewerHtml: () => "<html><body>viewer</body></html>",
  getLandingHtml: () => null,
  findAssetPath: () => null,
};

function baseCtx(scope?: ServerContext["scope"]): ServerContext {
  return {
    projectDir: "/tmp/redirect-aliases-test",
    svDir: "/tmp/redirect-aliases-test/.sourcevision",
    rexDir: "/tmp/redirect-aliases-test/.rex",
    dev: false,
    scope,
  };
}

async function startFor(ctx: ServerContext) {
  return startRouteTestServer((req, res) => handleStaticRoute(req, res, ctx, ASSETS));
}

describe("redirect aliases: full dashboard (no scope)", () => {
  it("redirects /overview to /analyze", async () => {
    const { baseUrl, close } = await startFor(baseCtx());
    try {
      const res = await fetch(`${baseUrl}/overview`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("analyze");
    } finally {
      await close();
    }
  });

  it("redirects /rex-dashboard to /work", async () => {
    const { baseUrl, close } = await startFor(baseCtx());
    try {
      const res = await fetch(`${baseUrl}/rex-dashboard`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("work");
    } finally {
      await close();
    }
  });

  it("redirects the renamed /llm-provider to /robot-wrangler", async () => {
    const { baseUrl, close } = await startFor(baseCtx());
    try {
      const res = await fetch(`${baseUrl}/llm-provider`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("robot-wrangler");
    } finally {
      await close();
    }
  });

  for (const old of ["hench-config", "cli-timeouts", "hench-templates"]) {
    it(`redirects the merged /${old} to /workflow`, async () => {
      const { baseUrl, close } = await startFor(baseCtx());
      try {
        const res = await fetch(`${baseUrl}/${old}`, { redirect: "manual" });
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("workflow");
      } finally {
        await close();
      }
    });
  }

  for (const old of ["project-settings", "feature-toggles", "notion-config", "integrations"]) {
    it(`redirects the merged /${old} to /project`, async () => {
      const { baseUrl, close } = await startFor(baseCtx());
      try {
        const res = await fetch(`${baseUrl}/${old}`, { redirect: "manual" });
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("project");
      } finally {
        await close();
      }
    });
  }

  it("keeps a sub-path and query string across the redirect", async () => {
    const { baseUrl, close } = await startFor(baseCtx());
    try {
      const res = await fetch(`${baseUrl}/overview/some-zone?ref=email`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("../analyze/some-zone?ref=email");
    } finally {
      await close();
    }
  });

  it("stays inside a workspace slot and a hub prefix, which this route never sees", async () => {
    const { baseUrl, close } = await startFor(baseCtx());
    try {
      const bare = (await fetch(`${baseUrl}/overview`, { redirect: "manual" })).headers.get("location")!;
      expect(new URL(bare, "http://h/p/app/w/feature/overview").href).toBe("http://h/p/app/w/feature/analyze");
      const deep = (await fetch(`${baseUrl}/overview/some-zone?ref=email`, { redirect: "manual" })).headers.get("location")!;
      expect(new URL(deep, "http://h/w/feature/overview/some-zone?ref=email").href).toBe("http://h/w/feature/analyze/some-zone?ref=email");
    } finally {
      await close();
    }
  });

  it("does not touch unrelated known view paths", async () => {
    const { baseUrl, close } = await startFor(baseCtx());
    try {
      const res = await fetch(`${baseUrl}/zones`, { redirect: "manual" });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });
});

describe("redirect aliases: scoped viewers", () => {
  // Workflow is cross-cutting, so every scope that had hench-config or
  // cli-timeouts has it — the old paths redirect rather than 404.
  for (const scope of ["sourcevision", "rex", "hench"] as const) {
    it(`redirects /hench-config to /workflow in a ${scope}-scoped viewer`, async () => {
      const { baseUrl, close } = await startFor(baseCtx(scope));
      try {
        const res = await fetch(`${baseUrl}/hench-config`, { redirect: "manual" });
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("workflow");
      } finally {
        await close();
      }
    });
  }

  // Project is cross-cutting too. /notion-config and /integrations were
  // rex-scope views, so a rex-scoped viewer is where a stale bookmark to them
  // would otherwise have been served as an unknown path.
  it("redirects /notion-config to /project in a rex-scoped viewer", async () => {
    const { baseUrl, close } = await startFor(baseCtx("rex"));
    try {
      const res = await fetch(`${baseUrl}/notion-config`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("project");
    } finally {
      await close();
    }
  });

  for (const scope of ["sourcevision", "hench"] as const) {
    it(`redirects /project-settings to /project in a ${scope}-scoped viewer`, async () => {
      const { baseUrl, close } = await startFor(baseCtx(scope));
      try {
        const res = await fetch(`${baseUrl}/project-settings`, { redirect: "manual" });
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("project");
      } finally {
        await close();
      }
    });
  }
});

describe("redirect aliases: rex-scoped viewer (no Work stage)", () => {
  it("serves /rex-dashboard directly instead of redirecting", async () => {
    const { baseUrl, close } = await startFor(baseCtx("rex"));
    try {
      const res = await fetch(`${baseUrl}/rex-dashboard`, { redirect: "manual" });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("viewer");
    } finally {
      await close();
    }
  });
});
