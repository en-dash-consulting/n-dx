/**
 * The choice card: what an `ask_choice` call asks, read before the card is
 * raised, and the answer an approval carries back to the agent.
 *
 * It writes nothing. Sending an answer is the approval; the answer is the
 * tool result. A denied card is a question the operator declined.
 */

import type { SidecarChoice, SidecarChoiceAnswer } from "../../shared/index.js";

const MAX_OPTIONS = 12;
const MAX_ANSWER_CHARS = 2000;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** An `ask_choice` call read for its card, or why no card can be raised. */
export function readChoiceCall(input: Record<string, unknown>): SidecarChoice | string {
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) return "a choice needs a question";
  if (!Array.isArray(input.options) || input.options.length < 2) return "a choice needs at least two options";
  if (input.options.length > MAX_OPTIONS) return `a choice has at most ${MAX_OPTIONS} options`;
  const options: SidecarChoice["options"] = [];
  for (const raw of input.options) {
    const label = isObject(raw) && typeof raw.label === "string" ? raw.label.trim() : "";
    if (!label) return "every option needs a label";
    if (options.some((o) => o.label === label)) return `option "${label}" is listed twice`;
    const description = isObject(raw) && typeof raw.description === "string" ? raw.description.trim() : "";
    options.push({ label, ...(description && { description }) });
  }
  return { question, options, multiSelect: input.multiSelect === true };
}

/** An approval's answer read against the card, or why it cannot be accepted. */
export function readChoiceAnswer(choice: SidecarChoice, raw: unknown): SidecarChoiceAnswer | string {
  if (!isObject(raw)) return `"answer" must be an object`;
  const selected = raw.selected ?? [];
  if (!Array.isArray(selected) || !selected.every((s) => typeof s === "string")) return `"answer.selected" must be a list of option labels`;
  if (raw.other !== undefined && typeof raw.other !== "string") return `"answer.other" must be a string`;
  const other = typeof raw.other === "string" ? raw.other.trim() : "";
  const unknown = selected.find((s) => !choice.options.some((o) => o.label === s));
  if (unknown !== undefined) return `"${unknown}" is not an option of this card`;
  if (other.length > MAX_ANSWER_CHARS) return `"answer.other" is at most ${MAX_ANSWER_CHARS} characters`;
  if (selected.length === 0 && !other) return "an answer picks an option or writes one in";
  if (!choice.multiSelect && selected.length + (other ? 1 : 0) > 1) return "this question takes one answer";
  return { selected: [...new Set(selected)], ...(other && { other }) };
}

/** What the agent reads when the operator sent an answer. */
export function choiceResultText(choice: SidecarChoice): string {
  const { answer } = choice;
  if (!answer) return "The card carried no answer; the operator has not chosen.";
  const picks = answer.selected.map((s) => JSON.stringify(s));
  const parts = [
    ...(picks.length > 0 ? [`chose ${picks.join(", ")}`] : []),
    ...(answer.other ? [`wrote in (Other): ${JSON.stringify(answer.other)}`] : []),
  ];
  return `The operator answered "${choice.question}": ${parts.join("; ")}.`;
}
