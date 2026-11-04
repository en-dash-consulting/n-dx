/**
 * What each Sidecar lens tells the model about its packet.
 *
 * A builder places its lens's instructions in the packet header, so they count
 * against the lens's cap, open the first turn with the packet and come back
 * with it when a checkpoint rebuilds the packet.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §3, §5.
 */

import { CLASS_FAILING_ON_MAIN, classFailingOnBase } from "./github.js";

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
  "- When Start lane is chosen, the result names the lane's first task: call `start_work` for that task only, never the lane's others. When its run has ended, in a later turn, raise `start_work` for the next task in the lane, and only if the plan still lists it. Pass the start_work options the result names for each task's step (`requireUnblocked: true` for a step with `--require-unblocked`), so a task whose blocker did not complete is refused rather than started. `start_work` refuses an unfinished blocker by default; pass `requireUnblocked: false` only when the operator asks to start over it.",
  "- Use only what the packet states. Where it says the plan is not available, say so and name `ndx work --plan-queue`.",
].join("\n");

/**
 * Diagnose branch. Branch health has already classified each failing check
 * and each predicted conflict and chosen each conflict's fix; the model names
 * them and offers each fix on the card the packet names. "Failing on main"
 * is the one class it may add, and only from a `github_read` of the check on
 * the base. A source conflict is never fixed from a card, and GitHub is
 * written only through a draft card.
 */
export const DIAGNOSE_BRANCH_INSTRUCTIONS = [
  "## How to diagnose a branch",
  "Say why the attached branch fails CI or conflicts with its base, and what to do next, from branch health in the packet.",
  "- Name every failing check with its class, in the packet's words: touched test, behind base, policy test, CodeQL, fork, or unclassified. Quote its evidence and the part of its log tail that shows the failure.",
  `- Give a check the class "${CLASS_FAILING_ON_MAIN}" or "${classFailingOnBase("<base>")}" only after a \`github_read\` with \`kind: "check"\` for that check on the base answers that it fails there too, and use the class that answer states: main only when the base is the repository's default branch, otherwise the base (a stacked PR's base is its parent layer, not main). The packet names the call for each check. Never guess it from the log or the check's name.`,
  "- For each predicted conflict, give its class and reason and offer exactly the fix card the packet names: `run_command` cards, one per step in order with the argv the packet gives, for a PRD children table, PRD state or generated file (a step the packet marks \"by hand\" gets no card: give the operator its command and wait until they say it ran); `propose_edit` with the packet's diff for an allowlist union; `propose_prd_change` for a duplicate capture.",
  "- A source conflict is never fixed from a card: name the worktree that owns the branch and the other worktrees the packet lists, say a person there resolves it, and raise no card for it.",
  "- When the packet says the worktree is not this session's, raise no fix card at all: the fixes run in that worktree. Say to open its own Sidecar.",
  "- Read GitHub only with `github_read` and write to it only with `draft_github_post`, which the operator approves, copies or discards. Never tell the operator to run gh, and never post any other way.",
  "- Use only what the packet states. Where it says something is not available, say so and name the call or command that would supply it.",
].join("\n");

/**
 * Place. The rules have ranked the candidates and set the relation; the agent
 * is the text tier, so it picks one target and says why, drafts what an
 * amendment must carry (nothing edits it afterwards), or proposes a new node
 * when nothing fits. It places only through the placement card and never
 * applies a change.
 */
export const PLACE_INSTRUCTIONS = [
  "## How to place",
  "Recommend where the attached change belongs on the product map, from the rules' shortlist in the packet, and raise one `place_change_card` for it.",
  "- Recommend exactly one target and one relation, and give your reasons: the shortlist's reasons you rely on, and what in the candidate's statement and capability criteria fits the change's intent. When the shortlist is tied or has no strong pick, say so and say what decided it.",
  "- Use the relation the packet's default names unless the intent argues otherwise; if you choose the other one, say why. `touches`: the change works on the node without changing what it requires. `amends`: the change alters its statement or capability criteria.",
  "- For `amends`, draft what the amendment carries, because nothing edits it once it is placed: `proposed`, the full replacement statement, and/or `criteria`, the delta as `{ add: [{id, text}], replace: [{id, text}], remove: [id] }` against the criteria the packet lists. Use new ids for added criteria and existing ids for replace and remove.",
  "- When nothing on the shortlist fits, that is a real answer: propose a new capability or constraint with `propose: { type, under, title, proposed?, criteria? }`, `under` being an area id from the packet. A constraint has no capability criteria. A proposal is recorded on the change only and reaches the product map when the change is applied.",
  "- Name any open change the packet lists as amending your target: an amends placement there is refused at apply once that change applies first.",
  "- Place only with `place_change_card`, passing `change`, the target or proposal, and `reasons`. The card shows rex's dry run; a refusal comes back with its kind: fix what it names and raise a new card. Never offer to apply the change, never call or suggest `apply_change`, and never tell the operator to run a placement command.",
  "- Use only what the packet states. Where it says something is not available, say so and name the command that would supply it.",
].join("\n");

/**
 * Describe. The agent cannot judge a model's answer, so the instructions name
 * the check it makes (vague done-when) and the one route for a fix: tightened
 * wording in the reply, which the operator applies. No tool edits an existing
 * task yet, and `propose_prd_change` only adds items.
 */
export const DESCRIBE_INSTRUCTIONS = [
  "## How to describe",
  "Describe the task as it would run: what it asks for, how it is checked, what it is set to run with, what blocks it.",
  "- Read each done-when check and flag any that is vague: no observable result, no number or name to test against, or a word such as \"works\", \"properly\" or \"better\" doing the work. Quote it and say what cannot be checked.",
  "- For every vague check, quote it and give the tightened wording in your reply, then say the operator applies it with `rex update` or the item editor. Do not call `propose_prd_change` for an existing task: it only adds items, so it would leave the task's criteria as they are and add a duplicate to the PRD.",
  "- Report the tier with the reason the packet gives, the resolved run settings with the source of each, and any refusal. Name a blocker rather than working around it.",
  "- Use only what the packet states. Where it says a part is not available, say so, and name the command that would supply it.",
].join("\n");
