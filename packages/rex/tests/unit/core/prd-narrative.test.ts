/**
 * Unit tests for the narrative PRD renderer.
 *
 * The renderer's contract is negative as much as positive: a stakeholder
 * document must not leak the tracker's internals. The `no internals leak`
 * block is the enforcement of that — it scans the whole rendered body for
 * uuid-shaped strings and for every literal from the status and priority
 * enums, so adding a new status without giving it prose fails here rather
 * than shipping `deferred` into someone's board pack.
 */

import { describe, it, expect } from "vitest";
import { renderNarrative } from "../../../src/core/prd-narrative.js";
import { SCHEMA_VERSION, VALID_STATUSES, VALID_PRIORITIES } from "../../../src/schema/index.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";

const EPIC = "11111111-1111-4111-8111-111111111111";
const FEATURE = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const DONE_TASK = "44444444-4444-4444-8444-444444444444";
const SECOND_EPIC = "55555555-5555-4555-8555-555555555555";
const BLOCKED_TASK = "66666666-6666-4666-8666-666666666666";

const UUID_SHAPED = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

function item(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return { status: "pending", level: "task", ...overrides };
}

function fixture(): PRDDocument {
  return {
    schema: SCHEMA_VERSION,
    title: "Portable PRD",
    items: [
      item({
        id: EPIC,
        title: "Checkout Overhaul",
        level: "epic",
        status: "in_progress",
        priority: "critical",
        description:
          "Make paying for an order effortless. Today a third of shoppers abandon " +
          `the basket at the payment step, and support fields the fallout (see ${TASK}).`,
        children: [
          item({
            id: FEATURE,
            title: "One-tap payment",
            level: "feature",
            priority: "high",
            description: "Returning shoppers can pay with a stored card in a single tap.",
            acceptanceCriteria: ["a returning shopper can pay without re-entering card details"],
            children: [
              item({
                id: TASK,
                title: "Store cards against the shopper account",
                description: "Persist a payment token per shopper.",
                acceptanceCriteria: [
                  "cards are stored against the shopper account",
                  "`POST /cards` returns the stored token",
                ],
              }),
              item({
                id: DONE_TASK,
                title: "Pick a payment vendor",
                status: "completed",
                priority: "low",
              }),
              item({
                id: BLOCKED_TASK,
                title: "Show the stored card at checkout",
                status: "blocked",
                blockedBy: [TASK],
              }),
            ],
          }),
        ],
      }),
      item({
        id: SECOND_EPIC,
        title: "Warehouse Reporting",
        level: "epic",
        description: "Give operations a daily view of stock movement.",
      }),
    ],
  };
}

/** The document body, minus the fenced-off nothing — the whole string is body here. */
function render(doc: PRDDocument, options?: Parameters<typeof renderNarrative>[1]): string {
  return renderNarrative(doc, options).markdown;
}

describe("renderNarrative", () => {
  describe("no internals leak", () => {
    it("contains no uuid-shaped strings", () => {
      expect(render(fixture())).not.toMatch(UUID_SHAPED);
    });

    it("contains no uuid-shaped strings when completed work is included", () => {
      expect(render(fixture(), { includeCompleted: true })).not.toMatch(UUID_SHAPED);
    });

    it("contains no raw status enum tokens", () => {
      const markdown = render(fixture(), { includeCompleted: true }).toLowerCase();
      for (const status of VALID_STATUSES) {
        expect(markdown, `status token "${status}" leaked`).not.toMatch(
          new RegExp(`\\b${status}\\b`),
        );
      }
    });

    it("contains no raw priority enum tokens", () => {
      const markdown = render(fixture(), { includeCompleted: true }).toLowerCase();
      for (const priority of VALID_PRIORITIES) {
        expect(markdown, `priority token "${priority}" leaked`).not.toMatch(
          new RegExp(`\\b${priority}\\b`),
        );
      }
    });

    it("resolves a uuid embedded in prose to the item's title", () => {
      const markdown = render(fixture());
      expect(markdown).toContain("(see “Store cards against the shopper account”)");
    });

    it("drops rather than expands a uuid whose title is already in the passage", () => {
      const doc = fixture();
      doc.items[1].description =
        `Follows the "One-tap payment" work (${FEATURE}) into the warehouse.`;

      const markdown = render(doc);
      expect(markdown).not.toMatch(UUID_SHAPED);
      expect(markdown).toContain('Follows the "One-tap payment" work into the warehouse.');
    });

    it("drops a uuid that resolves to nothing, leaving no empty parentheses", () => {
      const doc = fixture();
      doc.items[1].description = `Give operations a daily view (${"a".repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa).`;

      const markdown = render(doc);
      expect(markdown).not.toMatch(UUID_SHAPED);
      expect(markdown).toContain("Give operations a daily view.");
    });
  });

  describe("prose is passed through, not reflowed", () => {
    /**
     * The id clean-up closes gaps a removed uuid leaves behind. Its rules read
     * as generic whitespace tidying, which is exactly why they must not run on
     * text that had no id in it: a leading-dot path and an author's ellipsis
     * both look like a stranded space to them.
     */
    it("keeps the space in front of a dotfile path", () => {
      const doc = fixture();
      doc.items[1].description = "Stock counts land in .rex/prd_tree/ overnight.";
      expect(render(doc)).toContain("land in .rex/prd_tree/ overnight.");
    });

    it("keeps an ellipsis the author spaced away from the preceding word", () => {
      const doc = fixture();
      doc.items[1].description = 'Reads as "this follows on from ..." to the reader.';
      expect(render(doc)).toContain('"this follows on from ..." to the reader.');
    });

    it("still closes the gap left by a removed id in the same sentence", () => {
      const doc = fixture();
      doc.items[1].description = `Stock counts land in .rex/prd_tree/ (${TASK}) overnight.`;
      const markdown = render(doc);
      expect(markdown).toContain(
        "Stock counts land in .rex/prd_tree/ (“Store cards against the shopper account”) overnight.",
      );
    });
  });

  describe("document shape", () => {
    it("renders the PRD title as the document heading", () => {
      expect(render(fixture())).toMatch(/^# Portable PRD\n/);
    });

    it("renders epics as sections carrying a goal and a rationale", () => {
      const markdown = render(fixture());
      expect(markdown).toContain("## Checkout Overhaul");
      expect(markdown).toContain("**Goal.** Make paying for an order effortless.");
      expect(markdown).toContain("**Why it matters.** Today a third of shoppers abandon");
    });

    it("renders a feature as a described capability, not a goal/rationale pair", () => {
      const markdown = render(fixture());
      expect(markdown).toContain("### One-tap payment");
      expect(markdown).toContain(
        "Returning shoppers can pay with a stored card in a single tap.",
      );
      expect(markdown).not.toContain("**Goal.** Returning shoppers");
    });

    it("renders acceptance criteria as sentences under a plain-language heading", () => {
      const markdown = render(fixture());
      expect(markdown).toContain("**How we'll know it's done**");
      expect(markdown).toContain("- A returning shopper can pay without re-entering card details.");
      expect(markdown).toContain("- Cards are stored against the shopper account.");
    });

    it("leaves a criterion that opens with code untouched apart from its full stop", () => {
      expect(render(fixture())).toContain("- `POST /cards` returns the stored token.");
    });

    it("expresses a dependency as sequencing prose rather than an id", () => {
      const markdown = render(fixture());
      expect(markdown).toContain(
        "This follows on from “Store cards against the shopper account”.",
      );
    });

    it("nests levels by heading depth", () => {
      const markdown = render(fixture());
      expect(markdown).toContain("#### Store cards against the shopper account");
    });
  });

  describe("filtering", () => {
    it("omits finished work by default", () => {
      expect(render(fixture())).not.toContain("Pick a payment vendor");
    });

    it("includes finished work on request", () => {
      const markdown = render(fixture(), { includeCompleted: true });
      expect(markdown).toContain("Pick a payment vendor");
      expect(markdown).toContain("Delivered.");
    });

    it("always omits deleted items, even with completed work included", () => {
      const doc = fixture();
      doc.items[1].status = "deleted";
      expect(render(doc, { includeCompleted: true })).not.toContain("Warehouse Reporting");
    });

    it("keeps a finished container that still holds unfinished children", () => {
      const doc = fixture();
      doc.items[0].status = "completed";

      const markdown = render(doc);
      expect(markdown).toContain("## Checkout Overhaul");
      // Retained as a container only: its own goal survives, its state does not.
      expect(markdown).toContain("**Goal.** Make paying for an order effortless.");
      expect(markdown).not.toContain("Delivered.");
    });

    it("counts only the items it rendered", () => {
      expect(renderNarrative(fixture()).items).toBe(5);
      expect(renderNarrative(fixture(), { includeCompleted: true }).items).toBe(6);
    });
  });

  describe("scoping", () => {
    it("renders a subtree with the scoped item as the document heading", () => {
      const markdown = render(fixture(), { rootId: FEATURE });
      expect(markdown).toMatch(/^# One-tap payment\n/);
      expect(markdown).toContain("## Store cards against the shopper account");
      expect(markdown).not.toContain("Warehouse Reporting");
      expect(markdown).not.toContain("Checkout Overhaul");
    });

    it("still resolves a dependency title from outside the scope", () => {
      const doc = fixture();
      // Move the blocker out of the rendered subtree.
      doc.items[1].children = [doc.items[0].children![0].children![0]];
      doc.items[0].children![0].children!.splice(0, 1);

      const markdown = render(doc, { rootId: FEATURE });
      expect(markdown).toContain(
        "This follows on from “Store cards against the shopper account”.",
      );
    });

    it("returns null items for an unknown root", () => {
      expect(() => renderNarrative(fixture(), { rootId: "nope" })).toThrow(/nope/);
    });
  });

  describe("empty documents", () => {
    it("renders a heading and an explanatory line when nothing survives the filter", () => {
      const doc = fixture();
      doc.items = [];
      const result = renderNarrative(doc);
      expect(result.items).toBe(0);
      expect(result.markdown).toContain("# Portable PRD");
      expect(result.markdown).toContain("No open work");
    });
  });
});
