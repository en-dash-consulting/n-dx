import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RunRecordSchema } from "../../../src/schema/validate.js";

/**
 * Every field of the `RunRecord` type must be declared on `RunRecordSchema`.
 *
 * `loadRun` returns the zod-parsed record, and zod strips keys the schema
 * does not declare. So a field added to the type and written by `saveRun` is
 * on disk and gone by the time anything reads it back — silently, because the
 * writer and the reader are different processes and neither compares notes.
 * It happened to `review` (a documented stuck-task exemption and a `hench
 * show` line were both dead on arrival), and then to eight more fields before
 * this test existed.
 *
 * The type side is read out of the source text because TypeScript types do
 * not survive to runtime; the schema side is read off the live zod object, so
 * it cannot drift from what actually parses.
 */

const HENCH_SRC = resolve(fileURLToPath(import.meta.url), "../../../../src");

/** Keys of `export interface RunRecord`, read from the source. */
function runRecordTypeKeys(): string[] {
  const source = readFileSync(join(HENCH_SRC, "schema", "v1.ts"), "utf-8");
  const declaration = source.indexOf("export interface RunRecord {");
  if (declaration === -1) {
    throw new Error("export interface RunRecord not found in schema/v1.ts — this test needs updating");
  }
  // Walk braces rather than matching to the first "}": the interface contains
  // inline object types and doc comments with braces in them.
  const open = source.indexOf("{", declaration);
  let depth = 0;
  let close = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  const body = source.slice(open + 1, close);
  // Top-level members only: two-space indent, since nested object literals
  // inside a member's type are indented further.
  return [...body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map((m) => m[1]);
}

describe("RunRecord schema drift", () => {
  const typeKeys = runRecordTypeKeys();
  const schemaKeys = Object.keys(RunRecordSchema.shape);

  it("reads a plausible set of fields out of the type (guards the parser itself)", () => {
    // If the regex or the brace walk breaks, every other assertion here
    // passes vacuously — so pin a floor and a few known members.
    expect(typeKeys.length).toBeGreaterThan(30);
    expect(typeKeys).toEqual([...new Set(typeKeys)]);
    for (const known of ["id", "taskId", "status", "tokenUsage", "toolCalls", "host"]) {
      expect(typeKeys, `${known} missing — the type parser is broken`).toContain(known);
    }
  });

  it("declares every RunRecord field, so none is stripped on load", () => {
    const undeclared = typeKeys.filter((key) => !schemaKeys.includes(key));
    expect(
      undeclared,
      `RunRecordSchema (schema/validate.ts) does not declare: ${undeclared.join(", ")}.\n` +
        "zod strips undeclared keys, so saveRun writes these and loadRun returns them as undefined.\n" +
        "Add each one — optional, and permissive enough that a record written before it existed still parses.",
    ).toEqual([]);
  });

  it("declares nothing the type does not have, so a typo cannot pass for a field", () => {
    const unknown = schemaKeys.filter((key) => !typeKeys.includes(key));
    expect(
      unknown,
      `RunRecordSchema declares fields absent from the RunRecord type: ${unknown.join(", ")}.`,
    ).toEqual([]);
  });

  it("keeps every field optional except the ones a record cannot be without", () => {
    // A required field that is not genuinely always written is the other way
    // to lose a run: safeParse fails, loadRun throws, listRuns swallows it.
    const required = schemaKeys.filter((key) => !RunRecordSchema.shape[key as keyof typeof RunRecordSchema.shape].isOptional());
    expect(required.sort()).toEqual(
      ["id", "model", "startedAt", "status", "taskId", "taskTitle", "tokenUsage", "toolCalls", "turns"],
    );
  });
});
