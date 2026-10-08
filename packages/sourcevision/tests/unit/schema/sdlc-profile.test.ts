/**
 * The SdlcProfile schema and its registration.
 *
 * The rule under test is that nothing is asserted without proof: every
 * detection carries at least one piece of evidence with a known confidence.
 * It is enforced twice — by a non-empty tuple type in `v1.ts`, which stops our
 * own code writing an evidence-free detection, and by `.nonempty()` here,
 * which stops one being read out of a file another writer produced. This file
 * tests the second.
 *
 * @see src/schema/v1.ts
 * @see src/schema/validate.ts
 */
import { describe, it, expect } from "vitest";
import { SdlcProfileSchema, validate, validateModule } from "../../../src/schema/validate.js";
import { DATA_FILES, ALL_DATA_FILES } from "../../../src/schema/data-files.js";
import type { SdlcEvidence, SdlcProfile } from "../../../src/schema/v1.js";

const EVIDENCE: SdlcEvidence = {
  kind: "manifest-script",
  path: "package.json",
  line: 12,
  excerpt: '"test": "vitest run"',
  confidence: "certain",
};

/** A profile that found nothing — every section present and empty. */
function emptyProfile(): SdlcProfile {
  return {
    schemaVersion: "1.0.0",
    commands: [],
    tests: { frameworks: [], suites: [] },
    ci: [],
    cd: [],
    rollback: [],
    migrations: [],
    featureFlags: [],
    qualityGates: [],
    observability: [],
    containers: [],
    iac: [],
    parseFailures: [],
  };
}

/** A profile with one detection in every section. */
function fullProfile(): SdlcProfile {
  return {
    ...emptyProfile(),
    projectDir: "/abs/project",
    commands: [
      { evidence: [EVIDENCE], kind: "test", command: "pnpm test", runner: "pnpm" },
      { evidence: [EVIDENCE], kind: "build", command: "pnpm build", cwd: "packages/web" },
    ],
    tests: {
      frameworks: [{ evidence: [EVIDENCE], name: "vitest", roots: ["tests"] }],
      suites: [{ evidence: [EVIDENCE], kind: "unit", fileCount: 42 }],
      coverage: { evidence: [EVIDENCE], tool: "c8", threshold: 80, enforced: true },
    },
    ci: [{
      evidence: [EVIDENCE], provider: "github-actions", name: "ci",
      triggers: ["push", "pull_request"],
      jobs: [
        {
          name: "build",
          steps: [
            { uses: "actions/checkout@v4", kind: "checkout" },
            { name: "Build", run: "pnpm build", kind: "build" },
          ],
        },
        {
          name: "deploy",
          needs: ["build"],
          condition: "github.ref == 'refs/heads/main'",
          steps: [{ name: "Ship", run: "./deploy.sh", kind: "deploy" }],
        },
      ],
    }],
    cd: [{
      evidence: [EVIDENCE], environment: "production", mechanism: "github-actions",
      requiresApproval: true, automated: false,
    }],
    rollback: [{ evidence: [EVIDENCE], mechanism: "redeploy-previous", environment: "production" }],
    migrations: [{
      evidence: [EVIDENCE], tool: "prisma", directory: "prisma/migrations",
      reversible: true, automated: false,
    }],
    featureFlags: [{ evidence: [EVIDENCE], provider: "unleash", flags: ["new-checkout"] }],
    qualityGates: [{
      evidence: [EVIDENCE], kind: "required-status-check", blocking: true, appliesTo: "main",
    }],
    observability: [{ evidence: [EVIDENCE], kind: "tracing", provider: "opentelemetry" }],
    containers: [{
      evidence: [EVIDENCE], path: "Dockerfile", baseImages: ["node:22-alpine"],
      multiStage: true, orchestration: "compose",
    }],
    iac: [{ evidence: [EVIDENCE], tool: "terraform", root: "infra", remoteState: true }],
  };
}

describe("SdlcProfileSchema", () => {
  it("accepts a profile with a detection in every section", () => {
    const result = validate(SdlcProfileSchema, fullProfile());
    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors.issues)).toBe(true);
  });

  it("accepts a profile that found nothing, with every section present and empty", () => {
    expect(validate(SdlcProfileSchema, emptyProfile()).ok).toBe(true);
  });

  it("rejects a section that is absent rather than empty", () => {
    const { ci: _ci, ...withoutCi } = emptyProfile();
    const result = validate(SdlcProfileSchema, withoutCi);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.issues.some((i) => i.path.join(".") === "ci")).toBe(true);
    }
  });
});

describe("evidence is required on every detection", () => {
  // One case per section, so a section added later without the shared
  // evidence list fails here rather than shipping unprovable claims.
  const SECTIONS: Array<[string, (p: SdlcProfile) => void]> = [
    ["commands", (p) => { p.commands = [{ evidence: [], kind: "test", command: "x" } as never]; }],
    ["tests.frameworks", (p) => { p.tests.frameworks = [{ evidence: [], name: "vitest" } as never]; }],
    ["tests.suites", (p) => { p.tests.suites = [{ evidence: [], kind: "unit" } as never]; }],
    ["tests.coverage", (p) => { p.tests.coverage = { evidence: [], tool: "c8", enforced: true } as never; }],
    ["ci", (p) => { p.ci = [{ evidence: [], provider: "x", name: "n", triggers: [], jobs: [] } as never]; }],
    ["cd", (p) => { p.cd = [{ evidence: [], environment: "p", mechanism: "m", automated: true } as never]; }],
    ["rollback", (p) => { p.rollback = [{ evidence: [], mechanism: "manual" } as never]; }],
    ["migrations", (p) => { p.migrations = [{ evidence: [], tool: "knex" } as never]; }],
    ["featureFlags", (p) => { p.featureFlags = [{ evidence: [], provider: "split" } as never]; }],
    ["qualityGates", (p) => {
      p.qualityGates = [{ evidence: [], kind: "codeowners", blocking: true } as never];
    }],
    ["observability", (p) => {
      p.observability = [{ evidence: [], kind: "logging", provider: "pino" } as never];
    }],
    ["containers", (p) => {
      p.containers = [{ evidence: [], path: "Dockerfile", baseImages: [], multiStage: false } as never];
    }],
    ["iac", (p) => { p.iac = [{ evidence: [], tool: "terraform" } as never]; }],
  ];

  for (const [section, break_] of SECTIONS) {
    it(`rejects a detection in ${section} with no evidence`, () => {
      const profile = fullProfile();
      break_(profile);
      expect(validate(SdlcProfileSchema, profile).ok).toBe(false);
    });
  }
});

describe("evidence shape", () => {
  it("rejects an unknown confidence value", () => {
    const profile = fullProfile();
    profile.commands[0].evidence[0] = { ...EVIDENCE, confidence: "probably" as never };
    const result = validate(SdlcProfileSchema, profile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.issues.some((i) => i.path.includes("confidence"))).toBe(true);
    }
  });

  it("accepts each of the three confidence values", () => {
    for (const confidence of ["certain", "likely", "inferred"] as const) {
      const profile = fullProfile();
      profile.commands[0].evidence[0] = { ...EVIDENCE, confidence };
      expect(validate(SdlcProfileSchema, profile).ok).toBe(true);
    }
  });

  it("accepts evidence with only the required fields", () => {
    const profile = fullProfile();
    profile.commands[0].evidence[0] = { kind: "file-present", path: "Makefile", confidence: "likely" };
    expect(validate(SdlcProfileSchema, profile).ok).toBe(true);
  });

  it("rejects evidence with no path", () => {
    const profile = fullProfile();
    profile.commands[0].evidence[0] = { kind: "file-present", path: "", confidence: "likely" };
    expect(validate(SdlcProfileSchema, profile).ok).toBe(false);
  });
});

describe("commands section", () => {
  it("models all six command kinds uniformly", () => {
    const profile = fullProfile();
    profile.commands = (["test", "lint", "typecheck", "build", "deploy", "migrate"] as const)
      .map((kind) => ({ evidence: [EVIDENCE] as [SdlcEvidence], kind, command: `run ${kind}` }));
    expect(validate(SdlcProfileSchema, profile).ok).toBe(true);
  });

  it("rejects a command kind outside the closed set", () => {
    const profile = fullProfile();
    profile.commands[0] = { evidence: [EVIDENCE], kind: "publish" as never, command: "x" };
    expect(validate(SdlcProfileSchema, profile).ok).toBe(false);
  });
});

describe("CI jobs and steps", () => {
  it("accepts a job with steps, needs and a condition", () => {
    expect(validate(SdlcProfileSchema, fullProfile()).ok).toBe(true);
  });

  it("rejects a step whose kind is outside the closed set", () => {
    const profile = fullProfile();
    profile.ci[0].jobs[0].steps[0] = { run: "x", kind: "frobnicate" as never };
    expect(validate(SdlcProfileSchema, profile).ok).toBe(false);
  });

  it("rejects a job with no name", () => {
    const profile = fullProfile();
    profile.ci[0].jobs[0] = { name: "", steps: [] };
    expect(validate(SdlcProfileSchema, profile).ok).toBe(false);
  });

  it("accepts a job with no steps — a pipeline can declare an empty job", () => {
    const profile = fullProfile();
    profile.ci[0].jobs = [{ name: "noop", steps: [] }];
    expect(validate(SdlcProfileSchema, profile).ok).toBe(true);
  });
});

describe("parse failures", () => {
  // "No CI configured" and "CI configured but unreadable" are opposite facts;
  // an empty ci array asserts the first, so the second needs its own place.
  it("accepts a profile that parsed nothing but found something", () => {
    const profile = emptyProfile();
    profile.parseFailures = [
      { path: ".github/workflows/ci.yml", kind: "github-actions", reason: "merge keys are not supported (line 4)" },
    ];
    expect(validate(SdlcProfileSchema, profile).ok).toBe(true);
  });

  it("requires every parse failure to carry its path, kind and reason", () => {
    for (const bad of [
      { kind: "github-actions", reason: "x" },
      { path: "a.yml", reason: "x" },
      { path: "a.yml", kind: "github-actions" },
      { path: "", kind: "github-actions", reason: "x" },
    ]) {
      const profile = emptyProfile();
      profile.parseFailures = [bad as never];
      expect(validate(SdlcProfileSchema, profile).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("requires the section to be present, not optional", () => {
    const { parseFailures: _omitted, ...without } = emptyProfile();
    expect(validate(SdlcProfileSchema, without).ok).toBe(false);
  });
});

describe("registration", () => {
  it("registers sdlc-profile.json in the data-file registry", () => {
    expect(DATA_FILES.sdlcProfile).toBe("sdlc-profile.json");
    expect(ALL_DATA_FILES).toContain("sdlc-profile.json");
  });

  it("validates through validateModule by its registry key", () => {
    expect(validateModule("sdlcProfile", fullProfile()).ok).toBe(true);
    expect(validateModule("sdlcProfile", { schemaVersion: "1.0.0" }).ok).toBe(false);
  });
});

describe("older analyses", () => {
  // The profile is its own file, so an analysis produced before this change
  // simply has no sdlc-profile.json. What must not happen is the new entry
  // making the other artifacts of that analysis invalid.
  it("leaves the other module validators untouched", () => {
    const manifest = {
      schemaVersion: "1.0.0",
      toolVersion: "0.8.0",
      analyzedAt: "2026-01-01T00:00:00.000Z",
      targetPath: "/abs/project",
      modules: {},
    };
    expect(validateModule("manifest", manifest).ok).toBe(true);
  });
});
