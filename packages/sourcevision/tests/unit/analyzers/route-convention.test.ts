import { describe, it, expect } from "vitest";
import {
  buildRouteLayout,
  detectRouteConventions,
  dominantRouteFeature,
  routeFeatureOf,
  routeLayoutFor,
  routePathOf,
} from "../../../src/analyzers/route-convention.js";
import { analyzeZones, deriveZoneId } from "../../../src/analyzers/zones.js";
import { buildNameCandidates } from "../../../src/analyzers/zone-naming.js";
import { makeEdge, makeFileEntry, makeImports, makeInventory, makeZone } from "./zones-helpers.js";

describe("detectRouteConventions", () => {
  it("detects React Router from react-router.config or app/routes.ts", () => {
    expect(detectRouteConventions(["react-router.config.ts", "app/routes/_index.tsx"]))
      .toEqual([{ framework: "react-router", root: "app/routes" }]);
    expect(detectRouteConventions(["app/routes.ts", "app/routes/home.tsx"]))
      .toEqual([{ framework: "react-router", root: "app/routes" }]);
  });

  it("detects Next roots that exist, under a package prefix", () => {
    expect(detectRouteConventions(["web/next.config.mjs", "web/src/app/page.tsx", "web/src/lib/x.ts"]))
      .toEqual([{ framework: "nextjs", root: "web/src/app" }]);
  });

  it("detects SvelteKit", () => {
    expect(detectRouteConventions(["svelte.config.js", "src/routes/+page.svelte"]))
      .toEqual([{ framework: "sveltekit", root: "src/routes" }]);
  });

  it("finds nothing without a marker, even with a routes directory", () => {
    expect(detectRouteConventions(["src/routes/users.ts", "src/server.ts"])).toEqual([]);
  });
});

describe("route layout", () => {
  const paths = [
    "react-router.config.ts",
    "app/routes/_index.tsx",
    "app/routes/api.draft.ts",
    "app/routes/api.skips.ts",
    "app/routes/robots[.]txt.ts",
    "app/routes/admin/users.tsx",
    "app/routes/admin/components/Table.tsx",
    "app/routes/apps/_index.tsx",
    "app/routes/apps/timer/_index.tsx",
    "app/routes/apps/scrapbook/_index.tsx",
    "app/routes/apps/digest/_index.tsx",
    "app/routes/apps/digest/domains/a/x.ts",
    "app/routes/apps/digest/domains/b/x.ts",
    "app/routes/apps/digest/domains/c/x.ts",
  ];
  const layout = routeLayoutFor(paths);

  it("treats a directory of several feature directories as a container, only on the chain from the root", () => {
    expect([...layout.containers]).toEqual(["app/routes/apps"]);
    expect([...layout.genericSegments].sort()).toEqual(["apps", "routes"]);
  });

  it("resolves features: directories, container children, and flat dotted routes", () => {
    expect(routeFeatureOf("app/routes/admin/components/Table.tsx", layout)).toBe("app/routes/admin");
    expect(routeFeatureOf("app/routes/apps/digest/domains/a/x.ts", layout)).toBe("app/routes/apps/digest");
    expect(routeFeatureOf("app/routes/api.draft.ts", layout)).toBe("app/routes/api");
    expect(routeFeatureOf("app/routes/robots[.]txt.ts", layout)).toBe("app/routes/robots");
    expect(routeFeatureOf("app/routes/_index.tsx", layout)).toBe("app/routes/index");
    expect(routeFeatureOf("app/routes/.well-known.appspecific.json.ts", layout)).toBe("app/routes/well-known");
    expect(routeFeatureOf("app/components/Button.tsx", layout)).toBeUndefined();
  });

  it("maps a feature to the URL it serves", () => {
    expect(routePathOf("app/routes/apps/timer", layout)).toBe("/apps/timer");
    expect(routePathOf("app/routes/_marketing", layout)).toBe("/marketing");
  });

  it("finds the dominant feature only when at least half the files share it", () => {
    expect(dominantRouteFeature(["app/routes/admin/users.tsx", "app/routes/admin/components/Table.tsx", "app/lib/x.ts"], layout))
      .toEqual({ feature: "app/routes/admin", count: 2 });
    expect(dominantRouteFeature(["app/routes/admin/users.tsx", "app/lib/x.ts", "app/lib/y.ts"], layout)).toBeUndefined();
  });

  it("is empty without a convention", () => {
    const none = buildRouteLayout(["src/a.ts"], []);
    expect(none.containers.size + none.genericSegments.size).toBe(0);
  });
});

describe("zone ids under a route root", () => {
  it("skip the route root and containers, so a feature names its zone", () => {
    const files = ["app/routes/apps/watt-matters/layout.tsx", "app/routes/apps/watt-matters/lib/chapters.ts"];
    expect(deriveZoneId(files)).toBe("routes");
    expect(deriveZoneId(files, undefined, new Set(["routes", "apps"]))).toBe("watt-matters");
  });
});

describe("analyzeZones with a route convention", () => {
  // Three route features whose route modules import a shared UI library more
  // than they import their own feature code — the React Router shape.
  const features = ["alpha", "beta", "gamma"];
  const shared = Array.from({ length: 6 }, (_, i) => `app/components/ui/C${i}.tsx`);
  const featureFiles = (f: string) => [
    `app/routes/apps/${f}/_index.tsx`,
    `app/routes/apps/${f}/layout.tsx`,
    `app/routes/apps/${f}/settings.tsx`,
    `app/routes/apps/${f}/lib/model.ts`,
    `app/routes/apps/${f}/lib/api.ts`,
  ];
  const paths = ["react-router.config.ts", ...shared, ...features.flatMap(featureFiles)];
  const edges = [
    ...shared.slice(1).map((c, i) => makeEdge(c, shared[i])),
    ...features.flatMap((f, fi) => {
      const [index, layout, settings, model, api] = featureFiles(f);
      return [
        // Route files lean on shared UI, in overlapping pairs across features.
        ...[index, layout, settings].flatMap((r, ri) => [
          makeEdge(r, shared[(fi + ri) % 6]),
          makeEdge(r, shared[(fi + ri + 3) % 6]),
        ]),
        makeEdge(index, model),
        makeEdge(model, api),
      ];
    }),
  ];
  const inventory = makeInventory(paths.map((p) => makeFileEntry(p)));
  const imports = makeImports(edges);

  it("puts each feature's files in one zone named after the feature", async () => {
    const { zones } = await analyzeZones(inventory, imports, { enrich: false });
    for (const f of features) {
      const holders = zones.zones.filter((z) => featureFiles(f).some((p) => z.files.includes(p)));
      expect(holders.map((z) => z.id), `feature ${f}`).toEqual([f]);
      expect(holders[0].files).toEqual(expect.arrayContaining(featureFiles(f)));
    }
    expect(zones.zones.some((z) => /^routes(-\d+)?$/.test(z.id))).toBe(false);
  });

  it("does not raise measured cohesion with route-feature edges", async () => {
    const { zones } = await analyzeZones(inventory, imports, { enrich: false });
    const alpha = zones.zones.find((z) => z.id === "alpha")!;
    // 5 files, internal import edges: index→model, model→api only.
    expect(alpha.cohesion).toBeLessThan(1);
  });
});

describe("flat route zones", () => {
  it("take their id from the route, not the route root", async () => {
    const paths = ["app/routes.ts", "app/routes/events.$slug.tsx", "app/routes/events._index.tsx", "app/routes/events.feed.ts", "app/lib/a.ts", "app/lib/b.ts", "app/lib/c.ts"];
    const { zones } = await analyzeZones(
      makeInventory(paths.map((p) => makeFileEntry(p))),
      makeImports([makeEdge("app/lib/a.ts", "app/lib/b.ts"), makeEdge("app/lib/b.ts", "app/lib/c.ts"), makeEdge("app/lib/a.ts", "app/lib/c.ts")]),
      { enrich: false },
    );
    const events = zones.zones.find((z) => z.files.includes("app/routes/events.$slug.tsx"))!;
    expect(events.id).toBe("events");
  });
});

describe("route name candidate", () => {
  it("offers the feature the route serves ahead of directory names", () => {
    const layout = routeLayoutFor(["react-router.config.ts", "app/routes/apps/scrapbook/_index.tsx", "app/routes/apps/timer/_index.tsx", "app/routes/apps/digest/_index.tsx"]);
    const zone = makeZone("routes-9", ["app/routes/apps/scrapbook/_index.tsx", "app/routes/apps/scrapbook/barlow-principles.tsx"]);
    const candidates = buildNameCandidates(zone, { crossings: [], routeLayout: layout });
    expect(candidates[0]).toMatchObject({ name: "Scrapbook", source: "route" });
    expect(candidates[0].why).toContain("/apps/scrapbook");
    expect(candidates.some((c) => /^Routes/.test(c.name))).toBe(false);
  });
});
