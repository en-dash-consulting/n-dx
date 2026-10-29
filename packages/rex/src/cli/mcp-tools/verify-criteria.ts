import { z } from "zod";
import { verify } from "../../core/verify.js";
import { gateRepoTestCommand } from "../../core/test-command-trust.js";
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
    // Tests are off by default, and a repository test command runs only once
    // the user has accepted it; see gateRepoTestCommand (#686).
    const gate = gateRepoTestCommand(dir, config.test, args.runTests === true);
    const result = await verify({
      projectDir: dir,
      items: doc.items,
      taskId: args.taskId,
      testCommand: gate.testCommand,
      runTests: gate.runTests,
    });
    const payload = gate.refusal ? { ...result, ...gate.refusal } : result;
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
