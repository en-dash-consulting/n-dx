import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { parseDocument } from "../../store/markdown-parser.js";
import { toCanonicalJSON } from "../../core/canonical.js";
import { CLIError } from "../errors.js";
import { result } from "../output.js";
import { REX_DIR } from "./constants.js";

/**
 * Parse a rex/v1 PRD markdown document and emit canonical JSON to stdout.
 *
 * Sources (priority):
 *   1. `--stdin` flag: read markdown from stdin
 *   2. `--file=<path>` flag: read markdown from the given file
 *   3. Positional dir argument: read `<dir>/.rex/prd.md`
 *
 * Used by spawn-only consumers (sourcevision, core orchestration scripts) to
 * read the PRD without taking a code-level dependency on rex.
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
    raw = await readFile(join(dir, REX_DIR, "prd.md"), "utf-8");
  }

  const parsed = parseDocument(raw);
  if (!parsed.ok) {
    throw new CLIError(`rex parse-md: ${parsed.error.message}`);
  }

  result(toCanonicalJSON(parsed.data));
}
