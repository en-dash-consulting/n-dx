/**
 * Process liveness by pid, for the lock and progress files that record one
 * (the pack directory lock, the background narrator, the analyze progress
 * file).
 *
 * @module sourcevision/util/pid
 */

/** `kill(pid, 0)`; EPERM means the process exists but is not ours to signal. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === "EPERM";
  }
}
