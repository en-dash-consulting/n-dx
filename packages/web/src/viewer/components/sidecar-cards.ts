/**
 * Sidecar permission cards (story 08, UX4, UX8).
 *
 * The open session's cards, oldest first. The agent waits on the first
 * waiting card, so only that one can be decided: Approve, Deny with an
 * optional note that reaches the agent as the decision's reason, and
 * "Always allow" when the card carries an allow-list key. ⌘↵ (Ctrl+Enter)
 * approves it and ⌘⌫ (Ctrl+Backspace) denies it, except while focus is in
 * a text field, where those keys keep their editing meaning, or when a page
 * control has already handled the key.
 *
 * Bodies are generic: a title from the card's input and the input itself.
 * A command card adds the effects line its ndx command declares in the
 * command manifest; a work card shows the run's `ndx work --resolve`
 * preview, read before the card was raised. A change-set card (story 11)
 * shows its items as the server read them: each item's title, description
 * and done-when, editable while it is the first waiting card and sent with
 * the approval; any existing item it matches; and, on v2, where the change
 * lands — on its target, or in the Inbox needing placement. It never offers
 * to apply the change. A draft-post card shows the draft as it would be
 * posted, with Post / Copy / Discard: only Post posts, and Copy settles the
 * card as denied. A network-read card names what gh would read, with "Allow
 * GitHub reads for this project", which approves it and turns
 * `web.sidecarGithubReads` on. An external-call card (story 43) names the
 * connection and workspace host and draws the tool's input schema as a form
 * (sidecar-external-call.ts), editable while it is the first waiting card and
 * sent with the approval; a validation error's problems list shows under it.
 * Rich edit bodies come later.
 *
 * A card withdrawn because its session ended draws as denied with the note
 * "session ended" (UX8); one withdrawn because the turn stopped draws as
 * withdrawn.
 */

import { h } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { OWN_WORKTREE_NOTE } from "../utils/own-worktree-note.js";
import { SIDECAR_SESSION_ENDED_REASON, checkRunOptions, itemTypeLabel, laneSteps, stepRunOptions, workCommandArgs } from "../external.js";
import { useCliName } from "../hooks/sidecar.js";
import type { SidecarCard, SidecarCardDecision, SidecarCardKind, SidecarState } from "../hooks/sidecar.js";
import type { QueuePlan, SidecarChangeSetEdit } from "../external.js";
import { CopyTextButton } from "./copy-text-button.js";
import { linkHref, linkText } from "./tracker-links.js";
import { checkPlacementRequest, PlacementBody, placementDecidable, placementTitle, type PlacementEdit } from "./sidecar-placement.js";
import { ExternalCallBody, ProblemList, type ExternalCallEdit } from "./sidecar-external-call.js";
import { ItemEditBody, itemEditDraftOf, itemEditEdits, type ItemEditDraft } from "./sidecar-item-edit.js";

/** A placement card's decision note when the operator leaves the change in the Inbox: nothing is written. */
export const LEFT_IN_INBOX_REASON = "Left in the Inbox by the operator; nothing was written";

export const SIDECAR_CARD_KIND_LABELS: Readonly<Record<SidecarCardKind, string>> = {
  command: "Command",
  work: "Work",
  "change-set": "Change set",
  "run-plan": "Run plan",
  placement: "Placement",
  edit: "Edit",
  link: "Link",
  "item-edit": "Item edit",
  "network-read": "Network read",
  "draft-post": "Draft post",
  "draft-file": "Draft file",
  "migration-decision": "Migration decision",
  "external-call": "External call",
};

export type SidecarCardState = "pending" | "approved" | "denied" | "allow-listed" | "withdrawn";

/** How a card draws: a session-end withdrawal reads as a denial. */
export function sidecarCardState(card: SidecarCard): SidecarCardState {
  switch (card.status) {
    case "pending": return "pending";
    case "approved": return card.remembered ? "allow-listed" : "approved";
    case "denied": return "denied";
    case "withdrawn": return card.reason === SIDECAR_SESSION_ENDED_REASON ? "denied" : "withdrawn";
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const count = (v: unknown, one: string, many: string): string => {
  const n = Array.isArray(v) ? v.length : 0;
  return `${n} ${n === 1 ? one : many}`;
};

/** One line naming what the card would do, from its input; `cliName` from useCliName(). */
export function sidecarCardTitle(card: SidecarCard, cliName: string): string {
  const { input } = card;
  const title = ((): string => {
    switch (card.kind) {
      // A hub call names its project: the title says whose repository it runs in.
      case "command": {
        const argv = Array.isArray(input.argv) ? input.argv.map(String).join(" ") : "";
        return str(input.project) && argv ? `${str(input.project)}: ${argv}` : argv;
      }
      case "work": {
        // The execute route's own argv builder over the options the server will start with
        // (defaults applied), so the title is the command approval spawns. A card without them
        // falls back to the call's own options. Options that fail the shape check would be
        // refused there; the title then leaves them out.
        const checked = checkRunOptions(card.runOptions ?? input.options);
        const options = checked.ok ? checked.options : {};
        return str(input.taskId) ? [cliName, ...workCommandArgs({ taskId: str(input.taskId), options, dir: "." })].join(" ") : "";
      }
      case "change-set": return count(input.items, "item", "items");
      case "run-plan": return card.runPlan ? count(card.runPlan.lanes, "lane", "lanes") : "";
      // The card's own placement, as approval will write it; the call's input only when the card carries none.
      case "placement":
        return card.placement ? placementTitle(card.placement) : str(input.change) && str(input.target) ? `${str(input.change)} → ${str(input.target)}` : "";
      case "edit": return str(input.path);
      // The card's own link, as approval will write it; the call's input only when the card carries none.
      case "link":
        return card.link ? `${card.link.itemId} → ${linkText(card.link.ref, card.link.label)}` : [str(input.itemId), str(input.ref)].filter(Boolean).join(" → ");
      // The item and the fields approval writes.
      case "item-edit":
        return card.itemEdit ? `${card.itemEdit.itemId}: ${Object.keys(card.itemEdit.after).join(", ")}` : str(input.id);
      case "network-read": return [str(input.kind), str(input.ref)].filter(Boolean).join(" ");
      case "draft-post": return [str(input.project), str(input.kind), str(input.target)].filter(Boolean).join(" · ");
      case "draft-file": return [str(input.kind), str(input.path)].filter(Boolean).join(" · ");
      case "migration-decision": return count(input.entries, "decision", "decisions");
      // The tool's display name (`<connection>.<tool>`) and its class; the input shows the arguments.
      case "external-call": return [str(input.tool), str(input.class)].filter(Boolean).join(" · ");
    }
  })();
  return title || card.tool;
}

/**
 * The effects line of a command card: what its ndx command reads, writes,
 * whether it calls a model and how long it takes, from GET
 * /api/commands/manifest; "no declared effects" when the manifest has none.
 * `{token}` layout paths expand to the manifest's layoutPaths; a token it
 * does not name stays as written.
 */
export function sidecarCommandEffectsLine(card: SidecarCard, manifest: SidecarState["commandManifest"]): string {
  if (manifest === null || manifest === "loading") return "reading effects…";
  if (manifest === "unavailable") return "effects unavailable";
  const argv = Array.isArray(card.input.argv) ? card.input.argv.map(String) : [];
  const effects = manifest.cliNames.includes(argv[0] ?? "") ? manifest.effects[argv[1] ?? ""] : undefined;
  if (!effects) return "no declared effects";
  const expand = (text: string): string =>
    text.replace(/\{(\w+)\}/g, (token, name: string) => manifest.layoutPaths[name] ?? token);
  const reads = effects.reads.length > 0 ? expand(effects.reads.join(" + ")) : "nothing";
  const writes = effects.writes.length > 0 ? expand(effects.writes.map((w) => w.path).join(", ")) : "nothing";
  const llm = effects.llm.length > 0 ? `${effects.llm.length === 1 ? "1 LLM phase" : `${effects.llm.length} LLM phases`}` : "no LLM";
  return `reads ${reads} · writes ${writes} · ${llm} · ${effects.duration}`;
}

// ── Change-set card (story 11) ───────────────────────────────────────

/** One item's fields as the operator is editing them; criteria one per line. */
export interface ChangeSetDraft {
  title: string;
  description: string;
  criteria: string;
}

type ChangeSetItem = NonNullable<SidecarCard["changeSet"]>["items"][number];

const criteriaLines = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter(Boolean);

function draftOf(item: ChangeSetItem): ChangeSetDraft {
  return { title: item.title, description: item.description ?? "", criteria: (item.acceptanceCriteria ?? []).join("\n") };
}

/** The edits an approval sends: only the items, and fields, the operator changed. */
export function changeSetEdits(card: SidecarCard, drafts: Readonly<Record<number, ChangeSetDraft>>): SidecarChangeSetEdit[] {
  const items = card.changeSet?.items ?? [];
  const edits: SidecarChangeSetEdit[] = [];
  for (const [key, draft] of Object.entries(drafts)) {
    const index = Number(key);
    const item = items[index];
    if (!item) continue;
    const edit: SidecarChangeSetEdit = { index };
    if (draft.title.trim() !== item.title) edit.title = draft.title;
    if (draft.description.trim() !== (item.description ?? "").trim()) edit.description = draft.description;
    const criteria = criteriaLines(draft.criteria);
    if (criteria.join("\n") !== (item.acceptanceCriteria ?? []).join("\n")) edit.acceptanceCriteria = criteria;
    if (Object.keys(edit).length > 1) edits.push(edit);
  }
  return edits;
}

/** Where a v2 change-set's change lands, said before approval. */
export function changeSetPlacementLine(card: SidecarCard): string | null {
  const placement = card.changeSet?.placement;
  if (!placement) return null;
  return "target" in placement
    ? `Placed on ${placement.title} (touches ${placement.target})`
    : "No target: the change lands in the Inbox needing placement. Placing it from Sidecar comes with the Place lens.";
}

function parentLine(item: ChangeSetItem, items: readonly ChangeSetItem[]): string {
  if (item.parent !== undefined) return `under item ${item.parent + 1} (${items[item.parent]?.title ?? "?"})`;
  if (item.parentId) return `under ${item.parentId}`;
  return item.type === "change" ? "" : "at the root";
}

interface ChangeSetBodyProps {
  card: SidecarCard;
  /** The first waiting card: its fields are editable. */
  editable: boolean;
  drafts: Readonly<Record<number, ChangeSetDraft>>;
  onDraft: (index: number, draft: ChangeSetDraft) => void;
}

function ChangeSetBody({ card, editable, drafts, onDraft }: ChangeSetBodyProps) {
  const changeSet = card.changeSet!;
  const placement = changeSetPlacementLine(card);
  const written = card.carriedOut;
  return h("div", { class: "sidecar-change-set" },
    placement
      ? h("p", { class: `sidecar-change-set-placement${"inbox" in changeSet.placement! ? " sidecar-change-set-inbox" : ""}` }, placement)
      : null,
    h("ol", { class: "sidecar-change-set-items" },
      changeSet.items.map((item, index) => {
        const draft = drafts[index] ?? draftOf(item);
        const set = (field: keyof ChangeSetDraft) => (e: Event) =>
          onDraft(index, { ...draft, [field]: (e.target as HTMLInputElement | HTMLTextAreaElement).value });
        const label = `item ${index + 1}`;
        return h("li", { class: "sidecar-change-set-item", "data-index": index },
          h("div", { class: "sidecar-change-set-item-head" },
            h("span", { class: "sidecar-change-set-type" }, itemTypeLabel(item.type)),
            h("span", { class: "sidecar-change-set-parent" }, parentLine(item, changeSet.items)),
          ),
          item.duplicate
            ? h("p", { class: "sidecar-change-set-duplicate", role: "note" },
                `Matches existing ${itemTypeLabel(item.duplicate.type).toLowerCase()} "${item.duplicate.title}" (${item.duplicate.id}, ${item.duplicate.status})`)
            : null,
          editable
            ? h("div", { class: "sidecar-change-set-fields" },
                h("input", { type: "text", class: "sidecar-change-set-title", "aria-label": `Title of ${label}`, value: draft.title, onInput: set("title") }),
                h("textarea", { class: "sidecar-change-set-description", "aria-label": `Description of ${label}`, rows: 2, value: draft.description, onInput: set("description") }),
                h("textarea", { class: "sidecar-change-set-criteria", "aria-label": `Done when (one per line) for ${label}`, rows: 2, placeholder: "Done when… (one per line)", value: draft.criteria, onInput: set("criteria") }),
              )
            : h("div", { class: "sidecar-change-set-fields" },
                h("p", { class: "sidecar-change-set-title" }, item.title, written?.ids?.[index] ? h("code", null, ` ${written.ids[index]}`) : null),
                item.description ? h("p", { class: "sidecar-change-set-description" }, item.description) : null,
                item.acceptanceCriteria?.length
                  ? h("ul", { class: "sidecar-change-set-criteria", "aria-label": "Done when" }, item.acceptanceCriteria.map((c) => h("li", null, c)))
                  : null,
              ),
        );
      }),
    ),
    written
      ? h("p", { class: "sidecar-change-set-written" },
          written.ok ? `Written${card.edited ? " with your edits" : ""}: ${written.ids?.length ?? 0} items` : "Nothing was written; the agent was told why")
      : null,
  );
}

// ── Run-plan card (Guide) ────────────────────────────────────────────

/** Every lane's command, one per line: what Copy commands puts on the clipboard. */
export function runPlanCommands(plan: QueuePlan): string {
  return plan.lanes.map((lane) => lane.command).join("\n");
}

/**
 * Where a chosen lane stands, read from the lane's first task's work card in
 * the same session, raised after the plan card was decided: `raised` while the
 * card waits (or before the agent has raised one), `started` once it is
 * approved and its run began, `open` when it was denied, withdrawn, its
 * start was refused or its run failed afterwards (the server revises the
 * card's `carriedOut` to failed) — the lane has nothing running.
 */
export function runPlanLaneState(plan: SidecarCard, lane: number, cards: readonly SidecarCard[]): "open" | "raised" | "started" {
  if (plan.status !== "approved" || plan.lane !== lane) return "open";
  const first = plan.runPlan?.lanes[lane]?.tasks[0]?.id;
  const since = plan.decidedAt ?? plan.raisedAt;
  const work = cards
    .filter((c) => c.kind === "work" && c.sessionId === plan.sessionId && str(c.input.taskId) === first && c.raisedAt >= since)
    .at(-1);
  if (!work) return "raised";
  if (work.status === "pending") return "raised";
  if (work.status === "approved" && work.carriedOut?.ok) return "started";
  return work.status === "approved" && !work.carriedOut ? "raised" : "open";
}

/**
 * The turn Start lane sends when the lane's work card ended without a start:
 * it names the lane's first task and forbids a second plan card, because the
 * settled plan card cannot be decided again.
 */
export function runPlanRestartPrompt(plan: SidecarCard, lane: number): string {
  const planned = plan.runPlan?.lanes[lane];
  const first = planned?.tasks[0];
  const { options } = stepRunOptions(planned ? laneSteps(planned)[0] ?? "" : "");
  const withOptions = Object.keys(options).length > 0 ? ` with options ${JSON.stringify(options)}` : "";
  return `Start lane ${lane + 1} of the approved run plan again: raise start_work for task ${first?.id ?? ""}${first ? ` (${first.title})` : ""}${withOptions} only. Do not propose a new run plan.`;
}

/**
 * The `send` a card may use: none on an ended session (its transcript is
 * read-only) or while a turn runs or is being sent, so Start lane is offered
 * only when a new turn can start — and is not clicked twice into two turns.
 */
export function cardTurnSender(s: Pick<SidecarState, "readOnly" | "running" | "sending" | "send">): SidecarState["send"] | undefined {
  return s.readOnly || s.running || s.sending ? undefined : s.send;
}

interface RunPlanBodyProps {
  card: SidecarCard;
  /** Every card of the drawer: a lane's state is its work card's. */
  cards: readonly SidecarCard[];
  /** The first waiting card: Start lane can be chosen. */
  decidable: boolean;
  deciding: boolean;
  onStartLane: (lane: number) => void;
  /** Asks the agent for a new work card for a chosen lane whose card ended without a start. */
  onRestartLane?: (lane: number) => void;
}

/** The chosen lane's work card was denied, withdrawn or refused: the settled plan card cannot be decided again. */
function startAgain(card: SidecarCard, lane: number, cards: readonly SidecarCard[], restart: ((lane: number) => void) | undefined): boolean {
  return restart !== undefined && card.status === "approved" && card.lane === lane && runPlanLaneState(card, lane, cards) === "open"
    && cards.some((c) => c.kind === "work" && c.sessionId === card.sessionId && c.raisedAt >= (card.decidedAt ?? card.raisedAt));
}

function laneBadge(state: "open" | "raised" | "started") {
  if (state === "started") return h("span", { class: "sidecar-run-plan-started" }, "Started");
  if (state === "raised") return h("span", { class: "sidecar-run-plan-raised" }, "Work card raised");
  return null;
}

/**
 * The planner's lanes as it printed them, each task with its exact command.
 * Copy commands is the page's own clipboard write: no broker call, nothing
 * starts. Start lane approves the card with that lane; the agent is then
 * told to raise a work card for the lane's first task alone, so the rest of
 * the lane is listed here and started one work card at a time.
 */
function RunPlanBody({ card, cards, decidable, deciding, onStartLane, onRestartLane }: RunPlanBodyProps) {
  const plan = card.runPlan!;
  const note = str(card.input.note);
  return h("div", { class: "sidecar-run-plan" },
    note ? h("p", { class: "sidecar-run-plan-note" }, note) : null,
    h("p", { class: "sidecar-run-plan-active" }, `Active runs: ${plan.activeRuns} of ${plan.runLimit}`),
    h("ol", { class: "sidecar-run-plan-lanes" },
      plan.lanes.map((lane, index) => {
        const steps = laneSteps(lane);
        return h("li", { class: "sidecar-run-plan-lane", "data-lane": index, key: lane.changeId },
          h("div", { class: "sidecar-run-plan-lane-head" },
            h("span", { class: "sidecar-run-plan-lane-title" }, `Lane ${index + 1} · change ${lane.changeId}`),
            decidable
              ? h("button", {
                  type: "button",
                  class: "sidecar-run-plan-start",
                  disabled: deciding,
                  onClick: () => onStartLane(index),
                }, "Start lane")
              : startAgain(card, index, cards, onRestartLane)
                ? h("button", {
                    type: "button",
                    class: "sidecar-run-plan-start sidecar-run-plan-restart",
                    disabled: deciding,
                    onClick: () => onRestartLane!(index),
                  }, "Start lane")
                : laneBadge(runPlanLaneState(card, index, cards)),
          ),
          lane.ownWorktree ? h("p", { class: "sidecar-run-plan-worktree" }, OWN_WORKTREE_NOTE) : null,
          h("ol", { class: "sidecar-run-plan-tasks" },
            lane.tasks.map((task, i) => h("li", { class: "sidecar-run-plan-task", key: task.id },
              h("span", { class: "sidecar-run-plan-task-title" }, `${task.title}${i === 0 ? " (starts first)" : ""}`),
              h("span", { class: "sidecar-run-plan-task-reason" }, task.reason),
              h("code", { class: "sidecar-run-plan-command" }, steps[i] ?? lane.command),
            ))),
        );
      })),
    h("div", { class: "sidecar-run-plan-actions" },
      h(CopyTextButton, { text: runPlanCommands(plan), class: "sidecar-run-plan-copy", label: "Copy commands", caption: "Copy commands" }),
      h("span", { class: "sidecar-run-plan-hint" }, "Start lane asks for one work card, for the lane's first task. Nothing runs without it."),
    ),
  );
}

// ── Draft post and network read (Diagnose branch) ───────────────────

/** The reason a Copy sends: the draft left the dashboard, and nothing was posted. */
export const DRAFT_COPIED_REASON = "Copied, not posted";

/** A draft card's body: where it would go and the text exactly as it would be posted. */
function DraftPostBody({ card }: { card: SidecarCard }) {
  return h("div", { class: "sidecar-draft-post" },
    h("p", { class: "sidecar-draft-target" },
      `${str(card.input.kind) === "review" ? "Review comment" : "Comment"} on ${str(card.input.target)}`
      + (str(card.input.project) ? ` in project ${str(card.input.project)}` : "")),
    h("pre", { class: "sidecar-draft-text", "aria-label": "The draft as it would be posted" }, str(card.input.body)),
  );
}

/**
 * A draft-file card's body: the path the file would be saved at, editable
 * while the card waits, and the content as it would be written. Nothing is
 * written before Approve.
 */
function DraftFileBody({ card, editable, path, onPath }: { card: SidecarCard; editable: boolean; path: string; onPath: (path: string) => void }) {
  return h("div", { class: "sidecar-draft-file" },
    editable
      ? h("label", { class: "sidecar-draft-path" },
          "Save to ",
          h("input", {
            type: "text",
            class: "sidecar-draft-path-input",
            "aria-label": "Path the draft is saved to",
            value: path,
            onInput: (e: Event) => onPath((e.target as HTMLInputElement).value),
          }))
      : h("p", { class: "sidecar-draft-path" }, `Saved to ${str(card.input.path)}`),
    h("pre", { class: "sidecar-draft-text", "aria-label": "The file as it would be written" }, str(card.input.content)),
  );
}

/** A link card's body: the item, the tracker ref as the tracker's label reads it, and where approval writes it. */
function LinkBody({ link, written }: { link: NonNullable<SidecarCard["link"]>; written: SidecarCard["carriedOut"] }) {
  const href = linkHref(link.ref);
  return h("div", { class: "sidecar-link" },
    h("p", { class: "sidecar-link-item" }, h("strong", null, link.itemId), " ", link.title),
    h("p", { class: "sidecar-link-ref" }, "Link to ",
      href
        ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, linkText(link.ref, link.label))
        : h("span", null, linkText(link.ref, link.label)),
    ),
    h("p", { class: "sidecar-link-note" }, written
      ? (written.ok ? "Written to the item." : "Nothing was written.")
      : "Approve writes the ref to the item; Deny writes nothing."),
  );
}

/** A network-read card's body: the host and what would be read. */
function NetworkReadBody({ card }: { card: SidecarCard }) {
  const { kind, ref, base } = card.input;
  const what = kind === "check"
    ? `the newest run of check "${str(ref)}" on ${str(base)}`
    : `the PR of worktree ${str(ref)}, its checks and failed-check logs`;
  return h("p", { class: "sidecar-network-read" }, `Reads github.com with your gh login: ${what}.`);
}

/**
 * Copy on a draft card: the draft goes to the clipboard and the card settles
 * as denied, so nothing is posted. A refused clipboard leaves the card
 * waiting and says so; the draft stays on screen to select by hand.
 */
function DraftCopyButton({ text, deciding, onCopied }: { text: string; deciding: boolean; onCopied: () => void }) {
  const [failed, setFailed] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setFailed(true);
      return;
    }
    onCopied();
  };
  return h("button", { type: "button", class: "sidecar-card-copy", disabled: deciding, onClick: () => { void copy(); } },
    failed ? "Copy failed — select it" : "Copy");
}

/** Puts GitHub reads on for this project (`web.sidecarGithubReads`); later reads run without a card. */
async function allowGithubReads(): Promise<void> {
  const res = await fetch("/api/sidecar/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ githubReads: true }),
  });
  // This read is approved either way; only later reads still ask. The settings page shows the toggle.
  if (!res.ok) throw new Error(`Saving web.sidecarGithubReads failed (${res.status})`);
}

function settledNote(card: SidecarCard, state: SidecarCardState): string {
  switch (state) {
    case "approved": return "Approved";
    case "allow-listed": return "Approved · allow-listed, runs without asking from now on";
    case "denied":
      if (card.status === "withdrawn") return `Denied · ${SIDECAR_SESSION_ENDED_REASON}`;
      return card.reason ? `Denied · note sent to the agent: "${card.reason}"` : "Denied";
    case "withdrawn": return `Withdrawn · ${card.reason ?? "the turn stopped"}`;
    case "pending": return "";
  }
}

/**
 * A decided card folds to one line. A decided run plan does not: its lanes
 * stay live after the decision (Started, Work card raised, Start lane again).
 * Nor does an approval whose action failed: "Approved" alone would hide that
 * nothing was written, and its problems are what the operator needs to read.
 */
function foldable(card: SidecarCard): boolean {
  return sidecarCardState(card) !== "pending" && !card.runPlan && card.carriedOut?.ok !== false;
}

/** Focus is somewhere ⌘↵ and ⌘⌫ edit text. */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"].includes(target.type);
}

/** ⌘↵ / Ctrl+Enter approves, ⌘⌫ / Ctrl+Backspace denies; null for any other key. */
export function cardShortcut(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): "approve" | "deny" | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null;
  if (e.key === "Enter") return "approve";
  if (e.key === "Backspace") return "deny";
  return null;
}

interface CardProps {
  card: SidecarCard;
  cards: readonly SidecarCard[];
  cliName: string;
  /** The first waiting card: the only one that can be decided. */
  first: boolean;
  manifest: SidecarState["commandManifest"];
  note: string;
  onNote: (note: string) => void;
  deciding: boolean;
  onDecide: (decision: SidecarCardDecision) => void;
  /** The first waiting change-set card's edits, by item index. */
  drafts: Readonly<Record<number, ChangeSetDraft>>;
  onDraft: (index: number, draft: ChangeSetDraft) => void;
  /** The first waiting draft-file card's path as the operator is editing it. */
  path: string;
  onPath: (path: string) => void;
  /** The first waiting placement card's edit and its re-check. */
  placementEdit: PlacementEdit | null;
  onPlacementEdit: (edit: PlacementEdit | null) => void;
  /** The first waiting external-call card's arguments as edited; null while a field's text is not a value, undefined before any edit. */
  externalEdit: ExternalCallEdit | undefined;
  onExternalEdit: (edit: ExternalCallEdit) => void;
  /** The first waiting item-edit card's fields as the operator is editing them. */
  itemEditDraft: ItemEditDraft;
  onItemEditDraft: (draft: ItemEditDraft) => void;
  onRestartLane?: (lane: number) => void;
}

function SidecarCardView({ card, cards, cliName, first, manifest, note, onNote, deciding, onDecide, drafts, onDraft, path, onPath, placementEdit, onPlacementEdit, externalEdit, onExternalEdit, itemEditDraft, onItemEditDraft, onRestartLane }: CardProps) {
  const state = sidecarCardState(card);
  // A decided card is one line (head + note) until the operator opens its body.
  const [open, setOpen] = useState(false);
  const folded = foldable(card) && !open;
  const input = h("pre", { class: "sidecar-card-input" }, JSON.stringify(card.input, null, 2));
  const editable = first && state === "pending";
  // A change-set card's body is its items; the raw input stays behind a disclosure.
  const body = card.externalCall
    ? [
        h(ExternalCallBody, {
          call: card.externalCall, editable, onEdit: onExternalEdit,
          args: (card.input.arguments && typeof card.input.arguments === "object" ? card.input.arguments : {}) as Record<string, unknown>,
        }),
        h(ProblemList, { problems: card.carriedOut?.problems }),
        h("details", { class: "sidecar-card-details" }, h("summary", null, "Input"), input),
      ]
    : card.changeSet
    ? [
        h(ChangeSetBody, { card, editable, drafts: editable ? drafts : {}, onDraft }),
        h("details", { class: "sidecar-card-details" }, h("summary", null, "Input"), input),
      ]
    : card.placement
      ? [
          h(PlacementBody, { card, editable, onEdit: onPlacementEdit, edit: placementEdit }),
          h("details", { class: "sidecar-card-details" }, h("summary", null, "Input"), input),
        ]
    : card.itemEdit
      ? [
          h(ItemEditBody, { card, editable, draft: editable ? itemEditDraft : {}, onDraft: onItemEditDraft }),
          h("details", { class: "sidecar-card-details" }, h("summary", null, "Input"), input),
        ]
    : card.link
      ? [
          h(LinkBody, { link: card.link, written: card.carriedOut }),
          h("details", { class: "sidecar-card-details" }, h("summary", null, "Input"), input),
        ]
    : card.runPlan
      ? h(RunPlanBody, { card, cards, decidable: editable, deciding, onStartLane: (lane) => onDecide({ approve: true, lane }), onRestartLane })
      : card.kind === "draft-post" || card.kind === "network-read" || card.kind === "draft-file"
      ? [
          card.kind === "draft-post"
            ? h(DraftPostBody, { card })
            : card.kind === "draft-file"
              ? h(DraftFileBody, { card, editable, path, onPath })
              : h(NetworkReadBody, { card }),
          h("details", { class: "sidecar-card-details" }, h("summary", null, "Input"), input),
        ]
      : state === "pending"
      ? input
      : h("details", { class: "sidecar-card-details" }, h("summary", null, "Input"), input);
  const draft = card.kind === "draft-post";
  return h("li", { class: `sidecar-card sidecar-card--${state}`, "data-card": card.id, "data-kind": card.kind },
    h("div", { class: "sidecar-card-head" },
      h("span", { class: "sidecar-card-kind" }, SIDECAR_CARD_KIND_LABELS[card.kind] ?? card.kind),
      h("span", { class: "sidecar-card-title" }, sidecarCardTitle(card, cliName)),
    ),
    state !== "pending"
      ? h("div", { class: "sidecar-card-settled" },
          h("p", { class: "sidecar-card-note" }, settledNote(card, state)),
          !foldable(card) ? null : h("button", {
            type: "button", class: "sidecar-card-toggle", "aria-expanded": open,
            "aria-label": `${open ? "Hide" : "Show"} details of ${sidecarCardTitle(card, cliName)}`,
            onClick: () => setOpen(!open),
          }, open ? "Hide" : "Details"),
        )
      : null,
    !folded && card.kind === "command" ? h("div", { class: "sidecar-card-effects" }, sidecarCommandEffectsLine(card, manifest)) : null,
    !folded && card.preview !== undefined
      ? h("pre", { class: "sidecar-card-preview", "aria-label": "What this would run" }, card.preview)
      : null,
    folded ? null : body,
    state !== "pending"
      ? null
      : first
        ? h("div", { class: "sidecar-card-decide" },
            h("input", {
              type: "text",
              class: "sidecar-card-reason",
              "aria-label": "Note for the agent if you deny",
              placeholder: "Note for the agent if you deny (optional)",
              value: note,
              onInput: (e: Event) => onNote((e.target as HTMLInputElement).value),
            }),
            h("div", { class: "sidecar-card-actions" },
              // A run plan is approved by choosing a lane on the card, never by a bare approval.
              card.runPlan
                ? null
                : h("button", {
                    type: "button", class: "sidecar-card-approve",
                    // Place waits for the dry-run line of the placement as edited; a call waits for every field to hold a value.
                    disabled: deciding || (!!card.placement && !placementDecidable(card, placementEdit)) || externalEdit === null,
                    onClick: () => onDecide({ approve: true }),
                  },
                    card.changeSet
                      ? `Approve and write ${card.changeSet.items.length} ${card.changeSet.items.length === 1 ? "item" : "items"}`
                      : card.placement ? "Place"
                      : card.itemEdit ? "Approve and write"
                      : draft ? "Post under your gh login" : card.kind === "draft-file" ? "Save file" : "Approve"),
              // Leaving the change in the Inbox settles the card as denied and writes nothing.
              card.placement
                ? h("button", { type: "button", class: "sidecar-card-leave", disabled: deciding, onClick: () => onDecide({ approve: false, reason: LEFT_IN_INBOX_REASON }) }, "Leave in Inbox")
                : null,
              // Copy hands the draft to the operator and posts nothing: it settles the card as denied.
              draft ? h(DraftCopyButton, { text: str(card.input.body), deciding, onCopied: () => onDecide({ approve: false, reason: DRAFT_COPIED_REASON }) }) : null,
              h("button", { type: "button", class: "sidecar-card-deny", disabled: deciding, onClick: () => onDecide({ approve: false, reason: note }) },
                card.runPlan ? "Not now" : draft ? "Discard" : "Deny"),
              card.kind === "network-read"
                ? h("button", {
                    type: "button",
                    class: "sidecar-card-always",
                    disabled: deciding,
                    onClick: () => { onDecide({ approve: true }); void allowGithubReads(); },
                  }, "Allow GitHub reads for this project")
                : null,
              card.allowListKey !== null
                ? h("button", {
                    type: "button",
                    class: "sidecar-card-always",
                    disabled: deciding,
                    onClick: () => onDecide({ approve: true, remember: true }),
                  }, "Always allow")
                : null,
              h("span", { class: "sidecar-card-keys", "aria-hidden": "true" }, card.runPlan ? "⌘⌫ not now" : "⌘↵ approve · ⌘⌫ deny"),
            ),
          )
        : h("p", { class: "sidecar-card-queued" }, "Decided after the card above"),
  );
}

export interface SidecarCardsProps {
  cards: SidecarCard[];
  manifest: SidecarState["commandManifest"];
  decide: SidecarState["decide"];
  /** Posts a turn to the session; lets a lane whose work card ended start again. */
  send?: SidecarState["send"];
}

/** The cards with the project's CLI name, read from `/api/project`. */
export function SidecarCards(props: SidecarCardsProps) {
  return h(SidecarCardList, { ...props, cliName: useCliName() });
}

/**
 * The cards with the CLI name given. The hub session's drawer belongs to no
 * project, so it has no `/api/project` to read one from.
 */
export function SidecarCardList({ cards, manifest, decide, send, cliName }: SidecarCardsProps & { cliName: string }) {
  const first = cards.find((c) => c.status === "pending") ?? null;
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<Record<number, ChangeSetDraft>>({});
  const [placementEdit, setPlacementEdit] = useState<PlacementEdit | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [path, setPath] = useState("");
  const [externalEdit, setExternalEdit] = useState<ExternalCallEdit | undefined>(undefined);
  const [itemEditDraft, setItemEditDraft] = useState<ItemEditDraft>({});
  const [decidedOpen, setDecidedOpen] = useState(false);
  const firstId = first?.id ?? null;
  const firstPath = first?.kind === "draft-file" ? str(first.input.path) : "";
  const firstItemEdit = first?.itemEdit;

  // A note, a change set's, item edit's or placement's edits, and a draft's path belong to the card they were typed on.
  useEffect(() => {
    setNote(""); setDrafts({}); setPlacementEdit(null); setPath(firstPath); setExternalEdit(undefined);
    setItemEditDraft(firstItemEdit ? itemEditDraftOf(firstItemEdit) : {});
  }, [firstId]);

  const answer = async (decision: SidecarCardDecision) => {
    if (!first || deciding) return;
    // ⌘↵ is no answer to a run plan: only a lane's Start lane approves it.
    if (first.runPlan && decision.approve && decision.lane === undefined) return;
    // Nor of a placement until the dry-run line for the placement shown is back.
    if (first.placement && decision.approve && !placementDecidable(first, placementEdit)) return;
    // Nor of a call while a field's text is not a value of its type.
    if (first.kind === "external-call" && decision.approve && externalEdit === null) return;
    setDeciding(true);
    try {
      // An approval writes the operator's edits; a denial writes nothing, so it sends none.
      // An edited placement goes with the dry run the operator read, so the server writes nothing if the PRD moved since.
      if (decision.approve && first.placement && placementEdit?.cardId === first.id) {
        const settled = await decide(first.id, { ...decision, edits: placementEdit.body, ...(placementEdit.check && { reviewed: placementEdit.check }) });
        // A refusal (the PRD moved since the line was read) leaves the card waiting: read the line again so Place cannot repeat it.
        if (!settled) {
          const mine = placementEdit;
          const check = await checkPlacementRequest(first.placement.change, mine.body);
          setPlacementEdit((current) => (current === mine ? { ...mine, check } : current));
        }
        return;
      }
      // The values the operator left on an item-edit card are what an approval writes.
      if (decision.approve && first.itemEdit) {
        const fields = itemEditEdits(first.itemEdit, itemEditDraft);
        await decide(first.id, Object.keys(fields).length > 0 ? { ...decision, edits: fields } : decision);
        return;
      }
      const edits = decision.approve && first.changeSet ? changeSetEdits(first, drafts) : [];
      // The path the operator left on a draft-file card is where an approval saves it.
      const edited = edits.length > 0 ? { ...decision, edits } : decision;
      // The arguments the operator left on an external-call card are what an approval calls the tool with.
      if (decision.approve && first.kind === "external-call" && externalEdit) {
        await decide(first.id, { ...edited, arguments: externalEdit });
        return;
      }
      await decide(first.id, decision.approve && first.kind === "draft-file" && path.trim() ? { ...edited, path } : edited);
    } finally {
      setDeciding(false);
    }
  };
  const answerRef = useRef(answer);
  answerRef.current = answer;
  const noteRef = useRef(note);
  noteRef.current = note;

  useEffect(() => {
    if (!firstId) return;
    const handler = (e: KeyboardEvent) => {
      const action = cardShortcut(e);
      // A page control that already took the key (the PRD forms submit on
      // ⌘↵ from any of their fields, selects included) must not also decide
      // the agent's card. A held key's auto-repeat would decide the next card
      // the moment it is read back, and an open modal (Settings, search, …)
      // hides the drawer: only a fresh press on a visible card counts.
      if (!action || e.repeat || e.defaultPrevented || isTextField(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      void answerRef.current(action === "approve" ? { approve: true } : { approve: false, reason: noteRef.current });
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [firstId]);

  if (cards.length === 0) return null;
  const view = (card: SidecarCard) => h(SidecarCardView, {
      key: card.id,
      card,
      cards,
      cliName,
      first: card.id === firstId,
      manifest,
      note,
      onNote: setNote,
      deciding,
      onDecide: (decision: SidecarCardDecision) => { void answer(decision); },
      drafts,
      placementEdit: card.id === firstId ? placementEdit : null,
      onPlacementEdit: setPlacementEdit,
      externalEdit: card.id === firstId ? externalEdit : undefined,
      onExternalEdit: setExternalEdit,
      itemEditDraft: card.id === firstId ? itemEditDraft : {},
      onItemEditDraft: setItemEditDraft,
      onDraft: (index: number, draft: ChangeSetDraft) => setDrafts((prev) => ({ ...prev, [index]: draft })),
      path,
      onPath: setPath,
      onRestartLane: send ? (lane: number) => { void send(runPlanRestartPrompt(card, lane)); } : undefined,
  });
  // Pending cards (and run plans) stay first and open; several decided ones sit behind one toggle.
  const open = cards.filter((c) => !foldable(c));
  const decided = cards.filter(foldable);
  return h("ol", { class: "sidecar-cards", "aria-label": "Permission cards" },
    open.map(view),
    decided.length > 1
      ? h("li", { class: "sidecar-cards-decided" },
          h("button", {
            type: "button", class: "sidecar-cards-decided-toggle", "aria-expanded": decidedOpen,
            onClick: () => setDecidedOpen(!decidedOpen),
          }, `${decided.length} decided`),
          decidedOpen ? h("ol", { class: "sidecar-cards-decided-list" }, decided.map(view)) : null,
        )
      : decided.map(view),
  );
}
