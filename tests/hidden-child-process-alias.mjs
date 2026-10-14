/**
 * The vitest alias that makes every spawn in a test hidden on Windows.
 *
 * Spread into each config's `resolve.alias` array. Both specifiers are
 * covered: production code in this repository uses the bare `child_process`
 * in places and `node:child_process` in others, and a test's own spawns are
 * only half the problem — the module a test imports spawns too.
 *
 * @see tests/hidden-child-process.js — the wrapper, and why this exists
 */
import { fileURLToPath } from "node:url";

const wrapper = fileURLToPath(new URL("./hidden-child-process.js", import.meta.url));

export const hiddenChildProcessAlias = [
  { find: /^node:child_process$/, replacement: wrapper },
  { find: /^child_process$/, replacement: wrapper },
];
