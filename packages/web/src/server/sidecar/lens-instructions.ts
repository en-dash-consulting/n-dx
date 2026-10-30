/**
 * What each Sidecar lens tells the model about its packet.
 *
 * A builder places its lens's instructions in the packet header, so they count
 * against the lens's cap, open the first turn with the packet and come back
 * with it when a checkpoint rebuilds the packet.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §3, §5.
 */

/**
 * Explain. The packet labels each capability criterion; the model is held to
 * those labels, and to keeping the two kinds of criteria apart, because
 * "criteria" alone reads as either.
 */
export const EXPLAIN_INSTRUCTIONS = [
  "## How to explain",
  "Explain the target for someone who has not seen it: what it is, where it stands, what backs it.",
  "- Label every capability criterion you mention `met`, `not met` or `not verified`, exactly as the packet does, and cite its evidence. Never upgrade `not verified` to `met`; say what evidence is missing.",
  "- Say \"capability criteria\" for the standing requirements on the product layer (areas and capabilities). Say \"done when\" for a change's or task's acceptance criteria. They are different things: never call one by the other's name.",
  "- Use only what the packet states. Where it says something is not available, say so rather than guess, and name the command that would supply it.",
].join("\n");

/**
 * Diagnose run. The classifier has already decided the class and ranked the
 * actions; the model narrates that verdict and offers each action on the card
 * that carries it out. It never re-ranks, and at the last attempt it never
 * offers to try again.
 */
export const DIAGNOSE_RUN_INSTRUCTIONS = [
  "## How to diagnose a run",
  "Say why the task's newest run did not complete and what to do next, from the run classifier's verdict in the packet.",
  "- Label every claim `tested`, `inspected`, `not met` or `not verified`, and name the packet section it rests on, for example \"[tested · gate]\". `tested`: a recorded test or gate result shows it. `inspected`: read from the run record, review report or events, with no test behind it. `not met`: the record shows a requirement unmet. `not verified`: nothing in the packet checks it; say what would.",
  "- Offer the classifier's ranked actions in the order the verdict section lists them, which is the classifier's ranking (design §5 Q5). Do not reorder, drop or add to them; say why each fits.",
  "- When the verdict section says attempt 2 of 2, open with \"attempt 2 of 2: next is a fix or a split\" and do not offer a re-run or `--fresh`, even where an action reads as one.",
  "- Act only through broker cards, one per action, never by telling the operator to run something:",
  "  - verify-and-close (`close-verified`), a follow-up (`follow-up-run`), a split (`split-task`) or tightened done-when (`tighten-done-when`): `propose_prd_change`, which raises a change-set card.",
  "  - re-run (`re-run`): `start_work` for the task, which raises a work card.",
  "  - `--fresh` (`fresh`): `start_work` for the task with options `{ \"fresh\": true }`; the work card's resolve preview shows `--fresh`.",
  "  - a check such as `verify-on-main`, `release-claim` or `clean-tree`: `run_command`, which raises a command card.",
  "- Use only what the packet states. Where it says something is not available, say so and name the command that would supply it.",
].join("\n");

/**
 * Guide. The planner has already formed the lanes and said why each task is in
 * one or left out; the model reads that plan to the operator and raises the
 * run-plan card. It never forms a lane of its own, and never starts anything.
 */
export const GUIDE_INSTRUCTIONS = [
  "## How to guide",
  "Say what to run next and why, from the queue planner's plan in the packet.",
  "- Use the lanes exactly as the planner formed them: its commands, its task order, its reasons. Do not regroup, reorder or add to them, and never write a `ndx work` command of your own.",
  "- Say why each excluded task was left out, in the planner's words, and how many runs are active against the limit.",
  "- Raise a run-plan card with `propose_run_plan` only when the plan has at least one lane. With an empty ready list, or no lane, say so and raise no card: there is nothing to plan.",
  "- The card is the only way to propose a plan. The operator copies its commands or chooses Start lane; nothing starts without an approved work card.",
  "- When Start lane is chosen, the result names the lane's first task: call `start_work` for that task only, never the lane's others. When its run has ended, in a later turn, raise `start_work` for the next task in the lane, and only if the plan still lists it.",
  "- Use only what the packet states. Where it says the plan is not available, say so and name `ndx work --plan-queue`.",
].join("\n");

/**
 * Describe. The agent cannot judge a model's answer, so the instructions name
 * the check it makes (vague done-when) and the one route for a fix: a
 * change-set card the operator edits and approves, never prose to paste.
 */
export const DESCRIBE_INSTRUCTIONS = [
  "## How to describe",
  "Describe the task as it would run: what it asks for, how it is checked, what it is set to run with, what blocks it.",
  "- Read each done-when check and flag any that is vague: no observable result, no number or name to test against, or a word such as \"works\", \"properly\" or \"better\" doing the work. Quote it and say what cannot be checked.",
  "- For every vague check, propose a tightened one and send the tightened set through a `propose_prd_change` call, which raises a change-set card the operator edits and approves. Do not rewrite the PRD any other way and do not paste replacement text as the answer.",
  "- Report the tier with the reason the packet gives, the resolved run settings with the source of each, and any refusal. Name a blocker rather than working around it.",
  "- Use only what the packet states. Where it says a part is not available, say so, and name the command that would supply it.",
].join("\n");
