/**
 * Terminal prompts for interactive rex commands.
 *
 * `node:readline` is imported on the first prompt, not at module load, so a
 * command that never asks (`--yes`, off a TTY, JSON output) never loads it.
 * Each one-question prompt opens its own interface and closes it once
 * answered; {@link reviewEach} keeps one interface open for its whole walk.
 *
 * @module rex/cli/prompt
 */

import { info } from "./output.js";

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

/**
 * Review `items` one at a time: print each as `[n/total] <describe(item)>`
 * and ask `<label>? (y/n/a=all/q=quit)`. "y" or "yes" accepts the item, "a"
 * accepts it and every item after it, "q" stops; anything else skips it.
 * Resolves with the accepted items in their original order.
 */
export async function reviewEach<T>(
  items: readonly T[],
  describe: (item: T) => string,
  label: string,
): Promise<T[]> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

  const accepted: T[] = [];
  try {
    for (let i = 0; i < items.length; i++) {
      info(`\n[${i + 1}/${items.length}] ${describe(items[i])}`);
      const choice = (await ask(`  ${label}? (y/n/a=all/q=quit) `)).trim().toLowerCase();

      if (choice === "q") break;
      if (choice === "a") {
        accepted.push(...items.slice(i));
        break;
      }
      if (choice === "y" || choice === "yes") {
        accepted.push(items[i]);
      }
    }
  } finally {
    rl.close();
  }

  return accepted;
}
