import { describe, it, expect } from "vitest";
import {
  deriveZoneId,
  deriveZoneName,
  disambiguateZoneId,
  deriveZoneIdFromFilenames,
} from "../../../src/analyzers/zone-id-derivation.js";

// ── deriveZoneId ────────────────────────────────────────────────────────────

describe("deriveZoneId", () => {
  it("uses most common directory segment", () => {
    expect(
      deriveZoneId([
        "src/schema/v1.ts",
        "src/schema/validate.ts",
        "src/schema/index.ts",
      ])
    ).toBe("schema");
  });

  it("returns 'root' for root-level files", () => {
    expect(deriveZoneId(["package.json", "tsconfig.json"])).toBe("root");
  });

  it("skips generic segments like src, lib, app", () => {
    expect(
      deriveZoneId(["src/analyzers/foo.ts", "src/analyzers/bar.ts"])
    ).toBe("analyzers");
  });

  it("normalizes underscores to hyphens", () => {
    expect(deriveZoneId(["src/my_module/a.ts"])).toBe("my-module");
  });

  it("handles mixed root and nested files", () => {
    expect(
      deriveZoneId([
        "README.md",
        "src/schema/v1.ts",
        "src/schema/v2.ts",
      ])
    ).toBe("schema");
  });

  it("skips parent ID segments when parentId is provided", () => {
    // Without parentId, first non-generic is "hench"
    expect(
      deriveZoneId([
        "packages/hench/src/agent/core.ts",
        "packages/hench/src/agent/loop.ts",
      ])
    ).toBe("hench");

    // With parentId="hench", skips "hench" and finds "agent"
    expect(
      deriveZoneId(
        [
          "packages/hench/src/agent/core.ts",
          "packages/hench/src/agent/loop.ts",
        ],
        "hench"
      )
    ).toBe("agent");
  });

  it("skips hierarchical parent segments", () => {
    expect(
      deriveZoneId(
        [
          "packages/hench/src/agent/briefs/build.ts",
          "packages/hench/src/agent/briefs/validate.ts",
        ],
        "hench/agent"
      )
    ).toBe("briefs");
  });
});

// ── deriveZoneName ──────────────────────────────────────────────────────────

describe("deriveZoneName", () => {
  it("title-cases single word", () => {
    expect(deriveZoneName("schema")).toBe("Schema");
  });

  it("title-cases hyphenated words", () => {
    expect(deriveZoneName("detail-panel")).toBe("Detail Panel");
  });

  it("handles single-char segments", () => {
    expect(deriveZoneName("a-b")).toBe("A B");
  });
});

// ── disambiguateZoneId ──────────────────────────────────────────────────────

describe("disambiguateZoneId", () => {
  it("produces routes-admin style names from deeper path segments", () => {
    const result = disambiguateZoneId("routes", [
      "src/routes/admin/users.ts",
      "src/routes/admin/settings.ts",
      "src/routes/admin/dashboard.ts",
    ]);
    expect(result).toBe("routes-admin");
  });

  it("returns baseId when no discriminating segment found", () => {
    const result = disambiguateZoneId("routes", [
      "config/routes.ts",
      "other/file.ts",
    ]);
    expect(result).toBe("routes");
  });

  it("skips generic segments when looking for discriminator", () => {
    const result = disambiguateZoneId("routes", [
      "src/routes/src/admin/x.ts",
      "src/routes/src/admin/y.ts",
    ]);
    expect(result).toBe("routes-admin");
  });

  it("respects parentId to skip parent segments", () => {
    const result = disambiguateZoneId("api", [
      "packages/web/src/api/users/list.ts",
      "packages/web/src/api/users/create.ts",
    ], "web");
    expect(result).toBe("api-users");
  });

  it("picks the most common next segment when files differ", () => {
    const result = disambiguateZoneId("routes", [
      "src/routes/blog/post.ts",
      "src/routes/blog/list.ts",
      "src/routes/admin/users.ts",
    ]);
    expect(result).toBe("routes-blog");
  });
});

// ── Zone ID normalization ───────────────────────────────────────────────────

describe("zone ID normalization", () => {
  it("normalizes __tests__ to tests, not --tests--", () => {
    expect(
      deriveZoneId(["src/mylib/__tests__/a.test.ts", "src/mylib/__tests__/b.test.ts"])
    ).toBe("mylib");
  });

  it("normalizes __mocks__ without leading/trailing hyphens", () => {
    // __mocks__ should become "mocks" (then skipped), so the next segment wins
    expect(
      deriveZoneId(["src/api/__mocks__/handler.ts"])
    ).toBe("api");
  });

  it("normalizes _internal to internal", () => {
    // _internal → "internal" (which is in GENERIC_SEGMENTS, so it's skipped)
    // The next meaningful segment should win
    expect(
      deriveZoneId(["packages/mylib/_internal/utils.ts"])
    ).toBe("mylib");
  });
});

// ── deriveZoneIdFromFilenames ────────────────────────────────────────────────

describe("deriveZoneIdFromFilenames", () => {
  it("returns dominant theme word from filenames", () => {
    const files = [
      "src/provider-interface.ts",
      "src/provider-registry.ts",
      "src/provider-session.ts",
      "src/cli-provider.ts",
    ];
    expect(deriveZoneIdFromFilenames(files)).toBe("provider");
  });

  it("returns null when no word reaches 30% threshold", () => {
    const files = [
      "src/alpha.ts",
      "src/bravo.ts",
      "src/charlie.ts",
      "src/delta.ts",
      "src/echo.ts",
      "src/foxtrot.ts",
      "src/golf.ts",
    ];
    expect(deriveZoneIdFromFilenames(files)).toBeNull();
  });

  it("returns null with fewer than 2 source files", () => {
    expect(deriveZoneIdFromFilenames(["src/foo.ts"])).toBeNull();
    expect(deriveZoneIdFromFilenames([])).toBeNull();
  });

  it("filters out test files", () => {
    const files = [
      "src/provider.test.ts",
      "src/provider.spec.ts",
      "src/alpha.ts",
      "src/bravo.ts",
    ];
    // After filtering test files, only alpha and bravo remain — no dominant word
    expect(deriveZoneIdFromFilenames(files)).toBeNull();
  });

  it("skips generic words like index, utils, types", () => {
    const files = [
      "src/index.ts",
      "src/utils.ts",
      "src/types.ts",
      "src/auth-service.ts",
      "src/auth-middleware.ts",
      "src/auth-config.ts",
    ];
    expect(deriveZoneIdFromFilenames(files)).toBe("auth");
  });

  it("splits camelCase boundaries", () => {
    const files = [
      "src/providerInterface.ts",
      "src/providerRegistry.ts",
      "src/providerSession.ts",
    ];
    expect(deriveZoneIdFromFilenames(files)).toBe("provider");
  });

  it("tie-breaks lexicographically", () => {
    // "auth" and "user" each appear in 2 of 4 files (50%), both above threshold
    const files = [
      "src/auth-login.ts",
      "src/auth-logout.ts",
      "src/user-profile.ts",
      "src/user-settings.ts",
    ];
    // "auth" comes before "user" lexicographically
    expect(deriveZoneIdFromFilenames(files)).toBe("auth");
  });

  it("deduplicates words per file", () => {
    // "llm" appears twice in the stem "llm-llm" but should only count once per file
    const files = [
      "src/llm-llm.ts",
      "src/llm-types.ts",
      "src/llm-config.ts",
    ];
    expect(deriveZoneIdFromFilenames(files)).toBe("llm");
  });
});
