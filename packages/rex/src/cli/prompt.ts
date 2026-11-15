/**
 * One-question terminal prompts for interactive rex commands.
 *
 * `node:readline` is imported on the first prompt, not at module load, so a
 * command that never asks (`--yes`, off a TTY, JSON output) never loads it.
 * Each prompt opens its own interface and closes it once answered.
 *
 * @module rex/cli/prompt
 */

/** Ask `question` on the terminal and resolve with the answer exactly as typed. */
export async function promptAnswer(question: string): Promise<string> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return answer;
}

/** Ask `question` and resolve with the answer, surrounding whitespace trimmed. */
export async function promptLine(question: string): Promise<string> {
  return (await promptAnswer(question)).trim();
}

/** Ask a yes/no `question`. True for "y" or "yes" in any case; anything else is no. */
export async function confirmPrompt(question: string): Promise<boolean> {
  const normalized = (await promptLine(question)).toLowerCase();
  return normalized === "y" || normalized === "yes";
}
