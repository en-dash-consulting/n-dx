// @vitest-environment jsdom
/**
 * Finding → Ask seed hand-off.
 *
 * The seed is what makes an explanation specific to this repository rather
 * than to the finding type, so the mapping and the one-shot hand-off are
 * both worth pinning: a dropped field comes back as generic advice with
 * nothing saying why.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  EXPLAIN_FINDING_PROMPT,
  clearPendingAskSeed,
  findingToAskSeed,
  hasPendingAskSeed,
  setPendingAskSeed,
  takePendingAskSeed,
} from "../../../src/viewer/ask-seed.js";
import type { Finding } from "../../../src/viewer/external.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    type: "anti-pattern",
    pass: 4,
    scope: "web-shared",
    text: "web-shared has low cohesion and high coupling.",
    severity: "warning",
    related: ["packages/web/src/shared/data-files.ts", "packages/web/src/shared/view-id.ts"],
    ...overrides,
  } as Finding;
}

beforeEach(() => {
  clearPendingAskSeed();
});

describe("findingToAskSeed", () => {
  it("carries type, severity, zone, message and files", () => {
    expect(findingToAskSeed(finding())).toEqual({
      kind: "finding",
      type: "anti-pattern",
      severity: "warning",
      zone: "web-shared",
      message: "web-shared has low cohesion and high coupling.",
      files: ["packages/web/src/shared/data-files.ts", "packages/web/src/shared/view-id.ts"],
    });
  });

  it("omits severity when the analysis never assigned one", () => {
    const seed = findingToAskSeed(finding({ severity: undefined }));
    expect(seed).not.toHaveProperty("severity");
    // Not defaulted to "info": claiming a severity would put words in the
    // finding's mouth, even though the list renders these as info.
    expect(seed.type).toBe("anti-pattern");
    expect(seed.zone).toBe("web-shared");
  });

  it("drops the 'global' scope sentinel rather than sending it as a zone", () => {
    const seed = findingToAskSeed(finding({ scope: "global" }));
    expect(seed).not.toHaveProperty("zone");
    expect(seed.message).toBeTruthy();
  });

  it("omits files when the finding relates to nothing", () => {
    expect(findingToAskSeed(finding({ related: undefined }))).not.toHaveProperty("files");
    expect(findingToAskSeed(finding({ related: [] }))).not.toHaveProperty("files");
  });

  it("drops blank entries from the files list", () => {
    const seed = findingToAskSeed(finding({ related: ["a.ts", "  ", ""] }));
    expect(seed.files).toEqual(["a.ts"]);
  });

  it("handles every finding type and severity the list can render", () => {
    for (const type of ["pattern", "relationship", "anti-pattern", "suggestion"]) {
      for (const severity of ["critical", "warning", "info", undefined]) {
        const seed = findingToAskSeed(finding({ type: type as Finding["type"], severity: severity as Finding["severity"] }));
        expect(seed.kind).toBe("finding");
        expect(seed.type).toBe(type);
        expect(severity ? seed.severity : seed.severity === undefined).toBeTruthy();
      }
    }
  });

  it("always identifies itself as a finding seed", () => {
    expect(findingToAskSeed(finding()).kind).toBe("finding");
  });
});

describe("pending seed hand-off", () => {
  it("starts empty", () => {
    expect(hasPendingAskSeed()).toBe(false);
    expect(takePendingAskSeed()).toBeNull();
  });

  it("hands one seed across exactly once", () => {
    const seed = findingToAskSeed(finding());
    setPendingAskSeed(seed);
    expect(hasPendingAskSeed()).toBe(true);

    expect(takePendingAskSeed()).toEqual(seed);
    // Cleared on read: returning to the panel later must not re-ask the
    // last finding the user clicked Explain on.
    expect(hasPendingAskSeed()).toBe(false);
    expect(takePendingAskSeed()).toBeNull();
  });

  it("keeps the most recent seed when Explain is clicked twice", () => {
    setPendingAskSeed(findingToAskSeed(finding({ text: "first" })));
    setPendingAskSeed(findingToAskSeed(finding({ text: "second" })));
    expect(takePendingAskSeed()?.message).toBe("second");
  });

  it("clears without collecting", () => {
    setPendingAskSeed(findingToAskSeed(finding()));
    clearPendingAskSeed();
    expect(takePendingAskSeed()).toBeNull();
  });
});

describe("EXPLAIN_FINDING_PROMPT", () => {
  it("is a short fixed question, not the finding rendered into prose", () => {
    expect(EXPLAIN_FINDING_PROMPT).toBe("Explain this finding.");
    // The specifics belong in the seed, where the endpoint can validate them.
    expect(EXPLAIN_FINDING_PROMPT).not.toContain("web-shared");
  });
});
