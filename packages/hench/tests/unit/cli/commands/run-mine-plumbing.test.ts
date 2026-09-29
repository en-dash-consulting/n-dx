/**
 * `--mine` must survive the trip from flag parsing to task selection.
 *
 * WHY THIS IS A SOURCE TEST AND NOT A RUNTIME ONE. The identity `resolveActor`
 * produces is handed down a chain of module-private functions —
 * `selectTask`, `runLoop`, `runIterations`, `runOne` — whose signatures are 4,
 * 25, 24 and 27 positional parameters long, every trailing one of them
 * `string | undefined`. Dropping `assignee` from one call site is therefore
 * invisible to `tsc`: the argument list stays valid, the parameter silently
 * receives whatever now sits in its position, or `undefined`, and the run
 * quietly works the whole PRD instead of one person's slice of it. That is
 * exactly the defect this file exists to catch, and no type can catch it.
 *
 * None of the four are exported, and exporting a 27-parameter function purely
 * so a test can call it would be a worse trade than reading the source. So the
 * source is read — with TypeScript's own parser, not a regex — and three
 * things are asserted per function:
 *
 *   1. it still declares an `assignee` parameter (deleting it fails here),
 *   2. every call to it fills that parameter's index (a short argument list —
 *      the silent drop — fails here) with either `assignee` or a literal
 *      `undefined` (a displaced or wrong argument fails here),
 *   3. its body actually uses `assignee` (accepting the parameter and then
 *      ignoring it fails here).
 *
 * A literal `undefined` is allowed because one call site legitimately has no
 * identity to pass: `--epic-by-epic` refuses `--mine` outright. Writing it out
 * is the point — it occupies the position, so the next parameter appended after
 * it cannot quietly land in `assignee`'s slot, and a reader sees a decision
 * rather than an argument list that ran out.
 *
 * Together those make "assignee is dropped at runOne, runLoop or selectTask" a
 * failing test rather than a silent behaviour change.
 *
 * @see packages/hench/src/cli/commands/run.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const RUN_TS = join(
  fileURLToPath(new URL("../../../../src/cli/commands/", import.meta.url)),
  "run.ts",
);

/** The chain `--mine` travels down. Order is the call order. */
const CHAIN = ["selectTask", "runLoop", "runIterations", "runOne"] as const;

const source = ts.createSourceFile(
  "run.ts",
  readFileSync(RUN_TS, "utf-8"),
  ts.ScriptTarget.ESNext,
  /* setParentNodes */ true,
);

/** Every function declaration in the file, by name. */
function declarations(): Map<string, ts.FunctionDeclaration> {
  const found = new Map<string, ts.FunctionDeclaration>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      found.set(node.name.text, node);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/** Every call expression whose callee is a bare identifier, by callee name. */
function callSites(): Map<string, ts.CallExpression[]> {
  const found = new Map<string, ts.CallExpression[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      const list = found.get(name) ?? [];
      list.push(node);
      found.set(name, list);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

const DECLS = declarations();
const CALLS = callSites();

/** Index of the parameter named `assignee`, or -1. */
function assigneeParamIndex(fn: ts.FunctionDeclaration): number {
  return fn.parameters.findIndex(
    (p) => ts.isIdentifier(p.name) && p.name.text === "assignee",
  );
}

/** Does the body mention `assignee` anywhere below the parameter list? */
function bodyUsesAssignee(fn: ts.FunctionDeclaration): boolean {
  if (!fn.body) return false;
  let used = false;
  const visit = (node: ts.Node): void => {
    if (used) return;
    if (ts.isIdentifier(node) && node.text === "assignee") {
      used = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body, visit);
  return used;
}

describe("--mine plumbing through run.ts", () => {
  it("parses run.ts and finds every function in the chain", () => {
    // Guards the test itself: a rename would otherwise make every assertion
    // below vacuously pass by finding nothing to check.
    for (const name of CHAIN) {
      expect(DECLS.has(name), `${name} not found in run.ts — was it renamed?`).toBe(true);
    }
  });

  for (const name of CHAIN) {
    describe(name, () => {
      it("declares an assignee parameter", () => {
        const fn = DECLS.get(name)!;
        expect(
          assigneeParamIndex(fn),
          `${name} has no 'assignee' parameter — --mine cannot reach it`,
        ).toBeGreaterThanOrEqual(0);
      });

      it("uses assignee in its body rather than accepting and ignoring it", () => {
        expect(
          bodyUsesAssignee(DECLS.get(name)!),
          `${name} accepts 'assignee' but never reads it`,
        ).toBe(true);
      });

      it("receives assignee at the right position from every caller", () => {
        const fn = DECLS.get(name)!;
        const index = assigneeParamIndex(fn);
        const calls = CALLS.get(name) ?? [];

        expect(calls.length, `no call sites found for ${name}`).toBeGreaterThan(0);

        for (const call of calls) {
          const { line } = source.getLineAndCharacterOfPosition(call.getStart(source));
          const arg = call.arguments[index];
          expect(
            arg,
            `run.ts:${line + 1}: ${name}(...) passes ${call.arguments.length} argument(s) ` +
              `but 'assignee' is parameter ${index} — the identity is dropped here. ` +
              `Pass 'assignee', or an explicit 'undefined' if this path has none.`,
          ).toBeDefined();
          const text = arg!.getText(source);
          expect(
            text === "assignee" || text === "undefined",
            `run.ts:${line + 1}: ${name}(...) passes '${text}' where 'assignee' ` +
              `belongs (parameter ${index})`,
          ).toBe(true);
        }
      });
    });
  }

  /**
   * The end of the chain. `runOne` holds the identity and hands it to whichever
   * agent loop the provider selects; that loop passes it to `assembleTaskBrief`,
   * which is what actually scopes selection. Holding it and forwarding it to
   * neither loop would satisfy every check above and still work the whole PRD.
   */
  it.each(["cliLoop", "agentLoop"])(
    "runOne forwards assignee to %s, which is what scopes selection",
    (loopName) => {
      const fn = DECLS.get("runOne")!;
      let forwarded = false;
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === loopName
        ) {
          const options = node.arguments[0];
          if (
            options &&
            ts.isObjectLiteralExpression(options) &&
            options.properties.some(
              (p) => p.name && ts.isIdentifier(p.name) && p.name.text === "assignee",
            )
          ) {
            forwarded = true;
          }
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(fn.body!, visit);
      expect(
        forwarded,
        `runOne does not pass assignee to ${loopName} — --mine stops here`,
      ).toBe(true);
    },
  );
});
