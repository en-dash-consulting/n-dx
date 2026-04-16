import type { HenchConfig, TaskBrief, TaskBriefProject } from "../../schema/index.js";
import type { PromptEnvelope } from "../../prd/llm-gateway.js";
import { createPromptEnvelope } from "../../prd/llm-gateway.js";
import { buildBriefSections } from "./brief.js";

// ---------------------------------------------------------------------------
// Go-specific prompt context
// ---------------------------------------------------------------------------

/**
 * Returns Go-specific language context for the system prompt.
 * Covers toolchain commands, naming conventions, project structure,
 * and test conventions so the agent produces idiomatic Go code.
 */
function buildGoLanguageContext(): string {
  const lines: string[] = [];

  lines.push("## Language: Go");
  lines.push("");
  lines.push("### Toolchain");
  lines.push("- Build: `go build ./...`");
  lines.push("- Test: `go test ./...`");
  lines.push("- Vet: `go vet ./...`");
  lines.push("- Lint: `golangci-lint run`");
  lines.push("");
  lines.push("### Naming Conventions");
  lines.push("- Exported identifiers use PascalCase (e.g. `HandleRequest`, `UserService`).");
  lines.push("- Unexported identifiers use camelCase (e.g. `parseInput`, `defaultTimeout`).");
  lines.push("- Error handling uses explicit return values — no try/catch. Check every returned `error`.");
  lines.push("- Acronyms are all-caps when exported (`HTTPClient`, `ID`) and all-lower when unexported (`httpClient`, `id`).");
  lines.push("");
  lines.push("### Project Structure");
  lines.push("- `cmd/` — main packages (one subdirectory per binary).");
  lines.push("- `internal/` — private packages (not importable by other modules).");
  lines.push("- `pkg/` — public library packages (importable by external modules).");
  lines.push("- `go.mod` / `go.sum` — module definition and dependency checksums.");
  lines.push("");
  lines.push("### Test Conventions");
  lines.push("- Test files use the `_test.go` suffix in the same package.");
  lines.push("- Test functions accept `*testing.T` (e.g. `func TestParseInput(t *testing.T)`).");
  lines.push("- Prefer table-driven tests with `t.Run` subtests for comprehensive coverage.");
  lines.push("- Test helpers call `t.Helper()` so failures report the caller's line.");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

export function buildSystemPrompt(
  project: TaskBriefProject,
  config: HenchConfig,
): string {
  const lines: string[] = [];
  const isCli = config.provider === "cli";

  lines.push("You are Hench, an autonomous AI agent that implements software tasks.");
  lines.push("You receive a task brief and use tools to implement it.\n");

  lines.push("## Rules");
  lines.push("1. Read existing code before modifying it. Understand context first.");
  lines.push("2. Make minimal, focused changes. Don't refactor unrelated code.");
  lines.push("3. Follow existing code patterns and conventions.");
  lines.push("4. Run tests after making changes if a test command is configured.");
  lines.push("5. Commit your work with clear commit messages.");

  if (isCli) {
    lines.push("6. Never modify .hench/, .rex/, or .git/ directories directly.");
    lines.push("7. Stay within the project directory. Do not access files outside it.\n");
  } else {
    lines.push("6. Update the task status when you're done.");
    lines.push("7. If blocked by an external dependency, set status to 'blocked' and log the blocker.");
    lines.push("   If postponing by choice, set status to 'deferred'.");
    lines.push("8. Never modify .hench/, .rex/, or .git/ files directly.");
    lines.push("9. Use rex_append_log to record significant actions and decisions.");
    lines.push("10. If a task is too large, use rex_add_subtask to break it down.\n");
  }

  lines.push("## Project Info");
  lines.push(`Project: ${project.name}`);
  if (project.validateCommand) {
    lines.push(`Validate command: \`${project.validateCommand}\``);
  }
  if (project.testCommand) {
    lines.push(`Test command: \`${project.testCommand}\``);
  }
  lines.push("");

  // Language-specific context (only when detected)
  if (config.language === "go") {
    lines.push(buildGoLanguageContext());
    lines.push("");
  }

  lines.push("## Workflow");

  if (isCli) {
    lines.push("1. Explore the codebase to understand context");
    lines.push("2. Implement the changes described in the task brief");
    lines.push("3. Run validation/tests if configured");
    lines.push("4. Commit changes with git");
    lines.push("5. Provide a summary of what you did\n");
  } else {
    lines.push("1. Mark task as in_progress using rex_update_status");
    lines.push("2. Explore the codebase to understand context");
    lines.push("3. Implement the changes");
    lines.push("4. Run validation/tests if configured");
    lines.push("5. Commit changes with git");
    lines.push("6. Mark task as completed using rex_update_status");
    lines.push("7. Log a summary of what you did\n");
  }

  if (config.selfHeal) {
    lines.push("## Self-Heal Mode");
    lines.push("You are fixing a structural code issue found by static analysis.");
    lines.push("- Make source code changes that address the root cause. Move files, extract modules, remove cross-zone imports, reduce coupling.");
    lines.push("- Do NOT write ADR documents, markdown files, or architectural documentation as your primary deliverable.");
    lines.push("- Configuration-only changes (eslint rules, tsconfig, zone pins) are acceptable only when they directly fix the detected issue.");
    lines.push("- If the issue requires changes beyond a single task scope, set status to \"deferred\" with a specific reason. Do not fake completion.\n");
  }

  lines.push("## Error Handling");
  lines.push("- If tests fail after your changes, read the failure output carefully, fix the issue, and re-run.");
  lines.push("- If you encounter a test failure you did NOT cause (pre-existing), note it in the log and continue.");
  lines.push("- If validation/build fails, fix it before committing — never commit broken code.");
  lines.push("- If you're stuck after 3 attempts at the same problem, log what you tried and move on.\n");

  if (!isCli) {
    lines.push("## Tool Notes");
    lines.push("- File paths are relative to the project root.");
    lines.push(`- Allowed shell commands: ${config.guard.allowedCommands.join(", ")}`);
    lines.push(`- Max file size: ${config.guard.maxFileSize} bytes`);
    lines.push("- If a tool returns [GUARD], you hit a safety constraint. Adjust your approach.");
    lines.push("- If a tool returns [ERROR], something failed. Check your inputs and retry or adjust.");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Prompt envelope builder
// ---------------------------------------------------------------------------

/**
 * Build a complete {@link PromptEnvelope} from a task brief and agent config.
 *
 * Composes:
 * - **system** section from {@link buildSystemPrompt}
 * - **brief** (and future: workflow, files, validation, completion) sections
 *   from {@link buildBriefSections}
 *
 * Empty sections are filtered out by {@link createPromptEnvelope}, so only
 * populated sections appear in the envelope. Section names follow the
 * canonical set: system, workflow, brief, files, validation, completion.
 *
 * The returned envelope is a structured intermediate representation.
 * Vendor adapters translate it into their native delivery format via
 * {@link assemblePrompt} (from runtime-contract.ts).
 *
 * @see buildBriefSections in brief.ts — brief-side section contribution
 * @see createPromptEnvelope in runtime-contract.ts — factory with empty-section filtering
 */
export function buildPromptEnvelope(
  brief: TaskBrief,
  config: HenchConfig,
  extraContext?: string,
): PromptEnvelope {
  const systemContent = buildSystemPrompt(brief.project, config);
  const briefSections = buildBriefSections(brief);

  return createPromptEnvelope([
    { name: "system", content: systemContent },
    ...briefSections,
    ...(extraContext ? [{ name: "context" as const, content: extraContext }] : []),
  ]);
}
