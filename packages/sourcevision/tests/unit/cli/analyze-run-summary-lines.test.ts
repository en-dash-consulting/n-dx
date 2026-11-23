/**
 * The one-line run summaries analyze prints for a legacy estate, and the
 * primer's cascade gate. Pure helpers; no analysis runs.
 */
import { describe, expect, it } from "vitest";
import { describeOutboundTargets, textModelCalls } from "../../../src/cli/commands/analyze.js";
import { describeDocrootRoutes, describeExcluded } from "../../../src/cli/commands/analyze-phases.js";

describe("textModelCalls", () => {
  it("counts calls to any vendor but TypeSafe, so a cascade run that escalated can write a primer", () => {
    const run = {
      llm: {
        byTaskClass: {
          "code.classify": { calls: 105, vendor: "typesafe" },
          "code.classify/claude": { calls: 95, vendor: "claude" },
          "zone.judge": { calls: 42, vendor: "typesafe" },
        },
      },
    };
    expect(textModelCalls(run)).toBe(95);
    expect(textModelCalls({ llm: { byTaskClass: { "zone.judge": { calls: 3, vendor: "typesafe" } } } })).toBe(0);
  });
});

describe("describeOutboundTargets", () => {
  it("counts targets by source and the blank ones", () => {
    expect(
      describeOutboundTargets([
        { target: "https://a.example.test", targetSource: "literal" },
        { target: "DB_HOST", targetSource: "env" },
        { target: "$this->host . '/soap.php'", targetSource: "unknown" },
        { target: "", targetSource: "unknown" },
      ]),
    ).toBe("  outbound targets: 1 literal, 1 env, 2 unknown (1 blank)");
    expect(describeOutboundTargets([])).toBeUndefined();
  });
});

describe("describeDocrootRoutes", () => {
  it("counts the files each docroot serves, once per file", () => {
    const route = (source: string) => ({ source });
    expect(
      describeDocrootRoutes([
        { file: "site/htdocs/a.php", routes: [route("docroot site/htdocs"), route("docroot site/htdocs")] },
        { file: "site/htdocs/b.php", routes: [route("docroot site/htdocs")] },
        { file: "site/htdocs/api/r.php", routes: [route("site/htdocs/api/.htaccess:2")] },
      ]),
    ).toBe("  routes by docroot (files served): site/htdocs 2");
    expect(describeDocrootRoutes([{ file: "a.ts", routes: [{}] }])).toBeUndefined();
  });
});

describe("describeExcluded", () => {
  it("names third-party and mirrored counts by reason, largest first", () => {
    const summary = {
      thirdParty: { files: 5, byReason: { "config lib/**": 1, "library YUI": 4 } },
      mirrored: { files: 3, byReason: { "edit/ mirrors app/": 3 } },
    } as never;
    expect(describeExcluded(summary)).toBe(
      "  5 files marked third-party (library YUI 4, config lib/** 1); 3 files marked mirror copies (edit/ mirrors app/ 3); left out of zones, classification, the call graph and migration totals",
    );
    expect(describeExcluded({} as never)).toBeUndefined();
  });
});
