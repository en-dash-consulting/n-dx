/**
 * PRD refinement review — the Ask panel's proposal list.
 *
 * The endpoint may return a set of proposed mutations to existing PRD items
 * alongside its prose. This module renders each one as a before/after diff and
 * owns the accept/reject decision for it.
 *
 * ## Review before write
 *
 * An edit can destroy content in a way a capture cannot: a rewritten set of
 * acceptance criteria replaces history that nothing else holds. So the rules
 * here are stricter than the capture action's confirm step:
 *
 * - **Individually.** Every proposal is accepted or rejected on its own. There
 *   is deliberately no "accept all": a single control over a list is how five
 *   diffs get applied on the strength of having read one.
 * - **Exactly the fields that change.** The diff shows the fields the mutation
 *   touches and no others, so "what will this destroy?" is answerable by
 *   reading the card rather than by reasoning about the whole item.
 * - **Rejecting is local.** Reject removes the card and issues no request at
 *   all. The reject path cannot write, because it has no code path that could.
 *
 * ## Why the before side is trusted
 *
 * The `before` lines are the server's reading of the item at generation time,
 * not the model's quotation of it — see `prd-refinement.ts`. That is what makes
 * the diff a review surface rather than a second thing to verify: a model that
 * misquotes the current description cannot produce a diff that understates what
 * it is replacing.
 *
 * ## Staleness is not a client concern
 *
 * Nothing here checks whether a proposal still matches the PRD. The check
 * belongs under the store lock, where the answer cannot change between reading
 * it and acting on it, so the client's job is only to render the verdict the
 * apply route returns.
 *
 * @module web/viewer/views/ask-refinements
 * @see ../../server/prd-refinement.ts — where proposals and their diffs are built
 * @see ../../server/routes-rex/refinements.ts — the apply endpoint
 */

import { h } from "preact";

/** Path of the apply endpoint. Exported so tests assert on the real string. */
export const REFINEMENT_APPLY_ENDPOINT = "/api/rex/apply-refinements";

/**
 * Fields a proposal can change.
 *
 * The three types below mirror the server's, declared locally rather than
 * imported: the viewer is a browser bundle and cannot reach `src/server/`. That
 * is the same arrangement `viewer/components/prd-tree/types.ts` uses for rex's
 * schema, and it carries the same obligation — when the server's shape changes,
 * change this one.
 *
 * @see ../../server/prd-refinement.ts — canonical source: RefinementField,
 *      RefinementDiff, RefinementProposal, RefinementOutcome
 */
export type RefinementField = "description" | "acceptanceCriteria" | "priority" | "parent";

export interface RefinementDiff {
  field: RefinementField;
  before: string[];
  after: string[];
}

/**
 * A proposal, as the endpoint sent it.
 *
 * Carried opaquely and posted back unchanged on accept: `baseline` is the
 * server's fingerprint of the items this proposal was generated against, and
 * rewriting any of it here would defeat the staleness check it exists for.
 */
export interface RefinementProposal {
  id: string;
  op: "edit" | "reparent" | "merge";
  itemId: string;
  itemTitle: string;
  itemLevel: string;
  rationale: string;
  diffs: RefinementDiff[];
  baseline: Array<{ itemId: string; fingerprint: string }>;
  /** Present on a merge: the sibling that survives. */
  intoTitle?: string;
}

/** What the apply endpoint reports for one proposal. */
export interface RefinementOutcome {
  id: string;
  itemId: string;
  status: "applied" | "stale" | "invalid";
  detail?: string;
}

/** Where one proposal card stands. */
export type RefinementCardState =
  | { status: "pending" }
  | { status: "applying" }
  | { status: "applied" }
  | { status: "refused"; reason: string };

/** Human-readable label for each field, used as the diff's heading. */
const FIELD_LABEL: Record<RefinementField, string> = {
  description: "Description",
  acceptanceCriteria: "Acceptance criteria",
  priority: "Priority",
  parent: "Parent",
};

/**
 * One-line statement of what a proposal does.
 *
 * States the operation and the item, because the diffs below show the values
 * but not the verb: a description diff and a merge that rewrites the same
 * description look identical without it.
 */
export function describeProposal(proposal: RefinementProposal): string {
  switch (proposal.op) {
    case "reparent":
      return `Move this ${proposal.itemLevel} to a different parent`;
    case "merge":
      return `Merge this ${proposal.itemLevel} into "${proposal.intoTitle ?? "a duplicate sibling"}"`;
    default: {
      const fields = proposal.diffs.map((diff) => FIELD_LABEL[diff.field].toLowerCase());
      return `Rewrite the ${fields.join(" and ")} of this ${proposal.itemLevel}`;
    }
  }
}

/**
 * Turn an apply response into per-proposal card states.
 *
 * A proposal the response says nothing about is left refused rather than
 * assumed applied: silence from a write endpoint is not evidence of a write,
 * and showing it as applied would be the one lie this surface cannot afford.
 */
export function outcomeStates(
  sent: RefinementProposal[],
  outcomes: RefinementOutcome[],
): Map<string, RefinementCardState> {
  const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  const states = new Map<string, RefinementCardState>();
  for (const proposal of sent) {
    const outcome = byId.get(proposal.id);
    if (!outcome) {
      states.set(proposal.id, {
        status: "refused",
        reason: "The server did not report what happened to this change.",
      });
      continue;
    }
    if (outcome.status === "applied") {
      states.set(proposal.id, { status: "applied" });
      continue;
    }
    states.set(proposal.id, {
      status: "refused",
      reason: outcome.detail
        ?? (outcome.status === "stale"
          ? "This item changed after the answer was generated."
          : "This change is no longer valid."),
    });
  }
  return states;
}

/** Render one side of a diff. An empty list is stated, never left blank. */
function diffSide(kind: "before" | "after", lines: string[]) {
  return h("div", { class: `sv-ask-diff-side sv-ask-diff-${kind}` },
    h("p", { class: "section-sub sv-ask-diff-label" }, kind === "before" ? "Before" : "After"),
    lines.length === 0
      // "(not set)" rather than an empty box: a blank side reads as a render
      // failure, and the difference between "empty" and "absent" is exactly
      // what the user is being asked to approve.
      ? h("p", { class: "sv-ask-diff-empty" }, "(not set)")
      : h("ul", { class: "sv-ask-diff-lines" },
          ...lines.map((line, i) => h("li", { key: i }, line)),
        ),
  );
}

/** Render one field's before/after pair. */
function diffBlock(diff: RefinementDiff) {
  return h("div", { class: `sv-ask-diff sv-ask-diff-field-${diff.field}`, key: diff.field },
    h("h5", { class: "sv-ask-diff-field" }, FIELD_LABEL[diff.field]),
    diffSide("before", diff.before),
    diffSide("after", diff.after),
  );
}

export interface RefinementCardProps {
  proposal: RefinementProposal;
  state: RefinementCardState;
  onAccept: (proposal: RefinementProposal) => void;
  onReject: (proposal: RefinementProposal) => void;
}

/**
 * One reviewable proposal.
 *
 * Accept and Reject are peers, both always present while the card is pending.
 * Reject is not styled as the safe default and Accept is not pre-focused: the
 * user is being asked to make a choice, not to confirm one already made.
 */
export function RefinementCard({ proposal, state, onAccept, onReject }: RefinementCardProps) {
  const pending = state.status === "pending";
  const applying = state.status === "applying";

  return h("li", {
    class: `card sv-ask-proposal sv-ask-proposal-${state.status}`,
    "data-proposal-id": proposal.id,
    "data-proposal-op": proposal.op,
  },
    h("h4", { class: "section-header-sm sv-ask-proposal-title" }, proposal.itemTitle),
    h("p", { class: "section-sub sv-ask-proposal-summary" }, describeProposal(proposal)),
    proposal.rationale
      ? h("p", { class: "section-sub sv-ask-proposal-rationale" }, proposal.rationale)
      : null,

    proposal.diffs.length > 0
      ? h("div", { class: "sv-ask-diffs" }, ...proposal.diffs.map(diffBlock))
      // A merge whose target already carries every field of the absorbed item
      // changes no field on the survivor. Saying so is the diff.
      : h("p", { class: "section-sub sv-ask-diff-none" },
          "No field on the surviving item changes; only the duplicate is removed.",
        ),

    pending || applying
      ? h("div", { class: "sv-ask-proposal-actions" },
          h("button", {
            type: "button",
            class: "btn sv-ask-proposal-accept",
            // Focus is not moved when the write starts: `aria-disabled` reports
            // the control unavailable while the handler's own guard refuses a
            // second press, the same rule the submit button follows.
            "aria-disabled": applying ? "true" : undefined,
            onClick: () => { if (!applying) onAccept(proposal); },
          }, applying ? "Applying..." : "Accept"),
          h("button", {
            type: "button",
            class: "btn sv-ask-proposal-reject",
            title: "Discard this change. Nothing is written.",
            "aria-disabled": applying ? "true" : undefined,
            onClick: () => { if (!applying) onReject(proposal); },
          }, "Reject"),
        )
      : null,

    state.status === "applied"
      ? h("p", { class: "sv-ask-proposal-result sv-ask-proposal-result-ok", role: "status" },
          h("span", { class: "sv-ask-feedback-mark", "aria-hidden": "true" }, "✓"),
          h("span", { class: "section-sub" }, "Applied to the PRD."),
        )
      : null,

    // An alert, not a status: a refusal is the one outcome the user must not
    // miss, because the change they approved did not happen.
    state.status === "refused"
      ? h("p", { class: "sv-ask-proposal-result sv-ask-proposal-result-fail", role: "alert" },
          h("span", { class: "sv-ask-feedback-mark", "aria-hidden": "true" }, "⚠"),
          h("span", { class: "sr-only" }, "Not applied: "),
          h("span", { class: "section-sub sv-ask-proposal-reason" }, state.reason),
        )
      : null,
  );
}

export interface RefinementListProps {
  proposals: RefinementProposal[];
  states: Map<string, RefinementCardState>;
  /** Reasons the server dropped entries from the model's block. */
  notes: string[];
  onAccept: (proposal: RefinementProposal) => void;
  onReject: (proposal: RefinementProposal) => void;
}

/**
 * The proposal list under an answer.
 *
 * Renders nothing at all when there are no proposals and no notes — an empty
 * "Proposed PRD changes" heading over nothing reads as a failed render, and in
 * refine mode "the model proposed nothing" is a legitimate, common answer.
 */
export function RefinementList(props: RefinementListProps) {
  const { proposals, states, notes, onAccept, onReject } = props;
  if (proposals.length === 0 && notes.length === 0) return null;

  return h("div", { class: "card sv-ask-proposals" },
    h("h3", { class: "section-header-sm" }, "Proposed PRD changes"),
    h("p", { class: "section-sub sv-ask-proposals-intro" },
      proposals.length === 0
        ? "The model proposed no changes to existing items."
        : "Nothing is written until you accept a change. Each one is reviewed on its own.",
    ),
    proposals.length > 0
      ? h("ul", { class: "sv-ask-proposal-list" },
          ...proposals.map((proposal) => h(RefinementCard, {
            key: proposal.id,
            proposal,
            state: states.get(proposal.id) ?? { status: "pending" },
            onAccept,
            onReject,
          })),
        )
      : null,
    notes.length > 0
      ? h("ul", { class: "sv-ask-proposal-notes" },
          ...notes.map((note, i) => h("li", { key: i, class: "section-sub" }, note)),
        )
      : null,
  );
}
