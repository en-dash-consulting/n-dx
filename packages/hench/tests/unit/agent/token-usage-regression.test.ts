import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseTokenUsage,
  parseStreamTokenUsage,
  mapCodexUsageToTokenUsage,
} from "../../../src/agent/lifecycle/token-usage.js";

interface ClaudeFixtureCase {
  name: string;
  parser: "api" | "stream";
  payload: Record<string, unknown>;
  expected: Record<string, unknown> | null;
}

interface CodexFixtureCase {
  name: string;
  payload: Record<string, unknown>;
  expected: {
    usage: { input: number; output: number };
    total: number;
    diagnostic: "codex_usage_missing" | null;
  };
}

interface ParsingFixtureFile {
  claude: ClaudeFixtureCase[];
  codex: CodexFixtureCase[];
}

const fixtures = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../fixtures/token-usage-regression.json"),
    "utf-8",
  ),
) as ParsingFixtureFile;

describe("token usage regression fixtures", () => {
  describe("claude payload parsing", () => {
    for (const testCase of fixtures.claude) {
      it(testCase.name, () => {
        const parsed = testCase.parser === "api"
          ? parseTokenUsage(testCase.payload)
          : parseStreamTokenUsage(testCase.payload);
        if (testCase.expected === null) {
          expect(parsed).toBeUndefined();
        } else {
          expect(parsed).toEqual(testCase.expected);
        }
      });
    }
  });

  describe("codex payload parsing", () => {
    for (const testCase of fixtures.codex) {
      it(testCase.name, () => {
        const parsed = mapCodexUsageToTokenUsage(testCase.payload);
        expect(parsed.usage).toEqual(testCase.expected.usage);
        expect(parsed.total).toBe(testCase.expected.total);
        expect(parsed.diagnostic ?? null).toBe(testCase.expected.diagnostic);
      });
    }
  });
});
