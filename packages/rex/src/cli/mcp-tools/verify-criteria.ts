import { z } from "zod";
import { evaluateRepoTrust } from "@n-dx/llm-client";
import { verify } from "../../core/verify.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

export async function handleVerifyCriteria(
  store: PRDStore,
  dir: string,
  args: { taskId?: string; runTests?: boolean },
): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    const config = await store.loadConfig();
    // The test command comes from the repository's own `.rex/config.json`, so
    // running it on a checkout the user has not trusted would execute whatever
    // that checkout chose. Default off; and even when asked for, tests run
    // only once the repository's execution config is trusted (`ndx trust`).
    const requested = args.runTests === true;
    const trust = requested ? evaluateRepoTrust(dir) : null;
    const runTests = requested && trust !== null && !trust.restricted;
    const result = await verify({
      projectDir: dir,
      items: doc.items,
      taskId: args.taskId,
      testCommand: config.test,
      runTests,
    });
    const payload = requested && !runTests
      ? {
          ...result,
          testsSkipped: "The repository's execution config is not trusted, so its test command was not run. Review with `ndx trust .` and accept with `ndx trust accept .`.",
          trust: { state: trust?.state, findings: trust?.findings.filter((f) => f.severity === "warning").map((f) => f.message) ?? [] },
        }
      : result;
    return textResult(JSON.stringify(payload, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const verifyCriteriaTool = defineTool({
  name: "verify_criteria",
  description: "Map acceptance criteria to test files, and optionally run the repository's test command against them. Tests run only when runTests is true AND the repository's execution config is trusted (see `ndx trust`); the mapping is always returned.",
  schema: {
    taskId: z.string().optional().describe("Task ID to verify (omit for all tasks)"),
    runTests: z.boolean().optional().describe("Execute the test command from .rex/config.json (default: false). Ignored, with a note in the result, while the repository is not trusted."),
  },
  access: "read",
  run: (ws, args) => handleVerifyCriteria(ws.store, ws.projectDir, args),
});
