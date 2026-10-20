// Subjects for call-within-budget.test.ts, loaded inside the helper's worker.

/** Never returns: a synchronous loop, like a backtracking match. */
export function spinForever() {
  for (;;);
}

export function fail(message) {
  throw new Error(message);
}
