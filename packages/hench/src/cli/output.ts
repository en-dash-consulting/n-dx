/**
 * CLI output control — supports --quiet mode for scripting
 * and structured section headers for streaming agent output.
 *
 * Re-exports from types/output.ts for backwards compatibility.
 * The output utilities are now in a shared location to avoid
 * circular dependencies between CLI and agent modules.
 */

export {
  setQuiet,
  isQuiet,
  info,
  result,
  section,
  subsection,
  stream,
  detail,
  resetRollingWindow,
  getCapturedLines,
  resetCapturedLines,
} from "../types/output.js";
