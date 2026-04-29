import { readFile } from "node:fs/promises";
import { parseDocument } from "../../store/markdown-parser.js";
import { toCanonicalJSON } from "../../core/canonical.js";
import { CLIError } from "../errors.js";
import { result } from "../output.js";

/**
 * Parse a rex/v1 PRD markdown document and emit canonical JSON to stdout.
 *
 * Sources (priority):
 *   1. `--stdin` flag: read markdown from stdin
 *   2. `--file=<path>` flag: read markdown from the given file
 *
 * Either `--stdin` or `--file` must be provided. The folder-tree backend
 * does not support direct markdown reads; use the folder-tree parser or
 * `rex status` for folder-tree access.
 *
 * Used by spawn-only consumers (sourcevision, core orchestration scripts) to
 * parse PRD markdown without taking a code-level dependency on rex.
 */
export async function cmdParseMd(
  dir: string,
  flags: Record<string, string>,
  stdinInput: string,
): Promise<void> {
  let raw: string;

  if (flags.stdin === "true") {
    raw = stdinInput;
    if (!raw) {
      throw new CLIError("rex parse-md: --stdin requested but no input was piped");
    }
  } else if (flags.file) {
    raw = await readFile(flags.file, "utf-8");
  } else {
    throw new CLIError(
      "rex parse-md requires either --stdin or --file",
      "Pass markdown via --stdin or provide a file with --file=<path>",
    );
  }

  const parsed = parseDocument(raw);
  if (!parsed.ok) {
    throw new CLIError(`rex parse-md: ${parsed.error.message}`);
  }

  result(toCanonicalJSON(parsed.data));
}
