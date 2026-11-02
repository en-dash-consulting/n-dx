// @vitest-environment jsdom
/**
 * The placement card (story 29) in the Sidecar drawer: the shortlist as radio
 * rows, the propose row, the touches/amends toggle and amendment editor, rex's
 * dry-run line, the re-check an edit sends, and what approval, Leave in Inbox
 * and Deny send. And "Place with Sidecar", which attaches a change to the Place lens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { SidecarCards, LEFT_IN_INBOX_REASON, sidecarCardTitle } from "../../../src/viewer/components/sidecar-cards.js";
import {
  dryRunLine, draftFromRequest, nextCriterionId, placementBody, placementTitle, requestFromDraft,
} from "../../../src/viewer/components/sidecar-placement.js";
import { PlaceWithSidecarButton, PlaceWithSidecarContext } from "../../../src/viewer/components/place-with-sidecar.js";
import { pageItemFor, wantedLensFor, resolveLens } from "../../../src/viewer/hooks/use-sidecar-attachment.js";
import type { SidecarCard, SidecarCardDecision, SidecarPlacement, SidecarPlacementRequest } from "../../../src/viewer/hooks/use-sidecar.js";

const CHANGE = "ch-1";
const SHORTLIST = {
  layout: "v2",
  change: { id: CHANGE, title: "Retry a declined card", status: "pending", taskCount: 1 },
  relation: "touches",
  relationRule: "no Relation line",
  tied: false,
  shortlist: [
    {
      target: "cap-pay", type: "capability", title: "Pay by card", area: "Payments", statement: "Shoppers pay by card.",
      criteria: [{ id: "c1", text: "A card is charged" }, { id: "c2", text: "A decline is shown" }],
      score: 8, strength: "strong", reasons: ["title overlap: card"],
    },
    {
      target: "cap-refund", type: "capability", title: "Refunds", area: "Payments", criteria: [],
      score: 3, strength: "weak", reasons: ["package mention"],
    },
  ],
};
const PRODUCT = { map: { areas: [{ id: "area-pay", title: "Payments", capabilities: [] }], constraints: [] } };

const placement: SidecarPlacement = {
  change: CHANGE,
  request: { action: "place", target: "cap-pay", relation: "touches" },
  reasons: ["The change retries a declined card."],
  check: { ok: true, action: "place", target: "cap-pay", title: "Pay by card", relation: "touches", warnings: [] },
};

function placementCard(over: Partial<SidecarCard> = {}): SidecarCard {
  return {
    id: "p1", sessionId: "s1", tool: "place_change_card", kind: "placement",
    input: { change: CHANGE, target: "cap-pay" }, allowListKey: null, placement,
    status: "pending", raisedAt: "2026-11-02T00:00:01.000Z", ...over,
  };
}

let host: HTMLElement | null = null;
let checks: Array<Record<string, unknown>>;
/** What the check route answers for the body it was sent. */
let answerCheck: (body: Record<string, unknown>) => unknown;

beforeEach(() => {
  checks = [];
  answerCheck = (body) => ({
    ok: true, action: "place", target: body.target, title: "Pay by card", relation: body.relation ?? "touches", base: "4f1c9", warnings: [],
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => ({ ok: true, status: 200, statusText: "OK", json: async () => body });
    if (url.endsWith("/placement/check")) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      checks.push(body);
      return json({ layout: "v2", change: CHANGE, check: answerCheck(body) });
    }
    if (url.endsWith("/placement")) return json(SHORTLIST);
    if (url.endsWith("/api/rex/product")) return json(PRODUCT);
    return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) };
  }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (host) {
    await act(async () => { render(null, host!); });
    host.remove();
    host = null;
  }
});

const settle = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function draw(card: SidecarCard, decide = vi.fn(async (_id: string, _d: SidecarCardDecision) => {})) {
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => { render(h(SidecarCards, { cards: [card], manifest: null, decide }), host!); });
  await settle();
  return { el: host, decide };
}

const q = <T extends Element>(el: Element, sel: string) => el.querySelector<T>(sel)!;
const button = (el: Element, cls: string) => q<HTMLButtonElement>(el, `.${cls}`);

async function click(el: Element) { await act(async () => { (el as HTMLElement).click(); }); }
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); });
}
/** Wait out the re-check's debounce and its answer. */
const recheck = () => settle(400);

describe("placement card", () => {
  it("shows the shortlist as radio rows with score, strength and reasons, and a row to propose", async () => {
    const { el } = await draw(placementCard());
    const rows = [...el.querySelectorAll<HTMLElement>(".sidecar-place-shortlist .sidecar-place-row")];
    expect(rows.map((r) => r.dataset.target ?? "propose")).toEqual(["cap-pay", "cap-refund", "propose"]);
    expect(rows[0].textContent).toContain("Pay by card");
    expect(rows[0].textContent).toContain("score 8");
    expect(rows[0].textContent).toContain("strong");
    expect(rows[0].textContent).toContain("title overlap: card");
    expect(q<HTMLInputElement>(rows[0], "input").checked).toBe(true);
    expect(rows[2].textContent).toBe("Propose a new capability or constraint");
    expect(el.querySelector(".sidecar-place-reasons")?.textContent).toContain("retries a declined card");
  });

  it("titles the card '<change> → <target>' or '<change> → new <type> under <area>'", () => {
    expect(placementTitle(placement)).toBe("ch-1 → cap-pay");
    const proposing: SidecarPlacement = { ...placement, request: { action: "propose", type: "constraint", under: "area-pay", title: "No raw card numbers" } };
    expect(placementTitle(proposing)).toBe("ch-1 → new constraint under area-pay");
    expect(sidecarCardTitle(placementCard({ placement: proposing }), "ndx")).toBe("ch-1 → new constraint under area-pay");
  });

  it("shows the server's dry-run line, and a refusal's kind", async () => {
    const { el } = await draw(placementCard());
    expect(q(el, ".sidecar-place-check").textContent).toBe("Applies cleanly: touches Pay by card (cap-pay).");
    expect(dryRunLine({ ok: false, kind: "nothing-to-modify", error: "no amendment" })).toBe("Rex refuses this placement (nothing-to-modify): no amendment");
    expect(dryRunLine({ ok: true, action: "place", target: "A2.3", title: "T", relation: "amends", base: "4f1c9ab", warnings: ["Another open change amends it."] }))
      .toBe("Applies cleanly: amends T (A2.3 @ spec 4f1c). Another open change amends it.");
  });

  it("an unedited Place approves the card as it is, with no edits and no re-check", async () => {
    const { el, decide } = await draw(placementCard());
    expect(button(el, "sidecar-card-approve").textContent).toBe("Place");
    expect(button(el, "sidecar-card-approve").disabled).toBe(false);
    await click(button(el, "sidecar-card-approve"));
    expect(decide).toHaveBeenCalledWith("p1", { approve: true });
    expect(checks).toEqual([]);
  });

  it("an edit re-checks through the check route, and Place stays disabled until that line is back", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const original = answerCheck;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/placement/check")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        checks.push(body);
        await gate;
        return { ok: true, status: 200, statusText: "OK", json: async () => ({ layout: "v2", change: CHANGE, check: original(body) }) };
      }
      const json = (b: unknown) => ({ ok: true, status: 200, statusText: "OK", json: async () => b });
      return url.endsWith("/placement") ? json(SHORTLIST) : json(PRODUCT);
    }));
    const { el, decide } = await draw(placementCard());

    await click(q(el, 'input[name="place-p1-relation"][value="amends"]'));
    expect(q(el, ".sidecar-place-check").textContent).toBe("Checking the edited placement…");
    expect(button(el, "sidecar-card-approve").disabled).toBe(true);
    await settle(400);
    expect(checks).toEqual([{ target: "cap-pay", relation: "amends" }]);
    // The request is out, the line is not back: Place does nothing.
    expect(button(el, "sidecar-card-approve").disabled).toBe(true);
    await click(button(el, "sidecar-card-approve"));
    expect(decide).not.toHaveBeenCalled();

    release();
    await settle();
    expect(q(el, ".sidecar-place-check").textContent).toContain("amends Pay by card (cap-pay @ spec 4f1c)");
    expect(button(el, "sidecar-card-approve").disabled).toBe(false);
  });

  it("Place sends the edited placement: a changed target, relation, statement and criteria delta", async () => {
    const { el, decide } = await draw(placementCard());
    await click(q(el, 'input[name="place-p1"][value="cap-refund"]'));
    await click(q(el, 'input[name="place-p1"][value="cap-pay"]'));
    await click(q(el, 'input[name="place-p1-relation"][value="amends"]'));
    await type(q(el, ".sidecar-place-statement"), "Shoppers pay by card and retry a decline.");
    await type(q(el, '[data-criterion="c2"] .sidecar-place-criterion-text'), "A decline is shown with its reason");
    await click(q(el, '[data-criterion="c1"] .sidecar-place-criterion-remove'));
    await click(q(el, ".sidecar-place-add"));
    expect(q<HTMLInputElement>(el, ".sidecar-place-added-id").value).toBe("c3");
    await type(q(el, ".sidecar-place-added-text"), "A declined card can be retried");
    await recheck();

    const edited = {
      target: "cap-pay",
      relation: "amends",
      proposed: "Shoppers pay by card and retry a decline.",
      criteria: {
        add: [{ id: "c3", text: "A declined card can be retried" }],
        replace: [{ id: "c2", text: "A decline is shown with its reason" }],
        remove: ["c1"],
      },
    };
    expect(checks.at(-1)).toEqual(edited);
    expect(button(el, "sidecar-card-approve").disabled).toBe(false);
    await click(button(el, "sidecar-card-approve"));
    expect(decide).toHaveBeenCalledWith("p1", { approve: true, edits: edited });
  });

  it("proposing a new node takes a type, an area and a title, and sends them as a propose body", async () => {
    answerCheck = (body) => ({ ok: true, action: "propose", ...(body.propose as object), warnings: [] });
    const { el, decide } = await draw(placementCard());
    await click(q(el, ".sidecar-place-propose input"));
    await recheck();
    // No area or title yet: the check says so and Place stays off.
    expect(checks.at(-1)).toEqual({ propose: { type: "capability", under: "", title: "" } });
    await type(q(el, ".sidecar-place-title"), "Retry a declined card");
    await act(async () => {
      const area = q<HTMLSelectElement>(el, ".sidecar-place-area");
      area.value = "area-pay";
      area.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await recheck();
    expect(checks.at(-1)).toEqual({ propose: { type: "capability", under: "area-pay", title: "Retry a declined card" } });
    await click(button(el, "sidecar-card-approve"));
    expect(decide).toHaveBeenCalledWith("p1", { approve: true, edits: { propose: { type: "capability", under: "area-pay", title: "Retry a declined card" } } });
  });

  it("a refusal for the edited placement keeps Place disabled and shows rex's kind", async () => {
    answerCheck = () => ({ ok: false, kind: "nothing-to-modify", error: "an amends placement needs an amendment" });
    const { el, decide } = await draw(placementCard());
    await click(q(el, 'input[name="place-p1-relation"][value="amends"]'));
    await recheck();
    expect(q(el, ".sidecar-place-check").textContent).toBe("Rex refuses this placement (nothing-to-modify): an amends placement needs an amendment");
    expect(button(el, "sidecar-card-approve").disabled).toBe(true);
    await click(button(el, "sidecar-card-approve"));
    expect(decide).not.toHaveBeenCalled();
  });

  it("Leave in Inbox and Deny are denials that carry no edit, even after the placement was edited", async () => {
    const { el, decide } = await draw(placementCard());
    await click(q(el, 'input[name="place-p1-relation"][value="amends"]'));
    await recheck();
    await click(button(el, "sidecar-card-leave"));
    expect(decide).toHaveBeenLastCalledWith("p1", { approve: false, reason: LEFT_IN_INBOX_REASON });
    await click(button(el, "sidecar-card-deny"));
    expect(decide).toHaveBeenLastCalledWith("p1", { approve: false, reason: "" });
    expect(decide.mock.calls.every(([, d]) => d.edits === undefined && d.approve === false)).toBe(true);
  });

  it("a settled card shows its placement read-only", async () => {
    const { el } = await draw(placementCard({ status: "approved" }));
    expect(el.querySelector(".sidecar-place-shortlist")).toBeNull();
    expect(q(el, ".sidecar-place-check").textContent).toContain("Pay by card");
  });
});

describe("placement draft", () => {
  it("round-trips a request, and sends a propose as { propose }", () => {
    const place: SidecarPlacementRequest = { action: "place", target: "t", relation: "amends", proposed: "S", criteria: { remove: ["c1"] } };
    expect(requestFromDraft(draftFromRequest(place), place)).toEqual(place);
    const propose: SidecarPlacementRequest = { action: "propose", type: "capability", under: "a", title: "T", proposed: "S", criteria: { add: [{ id: "c1", text: "x" }] } };
    expect(requestFromDraft(draftFromRequest(propose), propose)).toEqual(propose);
    expect(placementBody(propose)).toEqual({ propose: { type: "capability", under: "a", title: "T", proposed: "S", criteria: { add: [{ id: "c1", text: "x" }] } } });
    expect(placementBody(place)).toEqual({ target: "t", relation: "amends", proposed: "S", criteria: { remove: ["c1"] } });
  });

  it("drops an amendment when the relation goes back to touches, and numbers a new criterion after the used ones", () => {
    const amends = draftFromRequest({ action: "place", target: "t", relation: "amends", proposed: "S", criteria: { remove: ["c1"] } });
    expect(requestFromDraft({ ...amends, relation: "touches" }, { action: "place", target: "t" })).toEqual({ action: "place", target: "t", relation: "touches" });
    expect(nextCriterionId(["c1", "c7", "x"])).toBe("c8");
    expect(nextCriterionId([])).toBe("c1");
  });
});

describe("Place with Sidecar", () => {
  it("attaches the change as a 'change' item that asks with the Place lens", () => {
    const item = pageItemFor({ view: "plan", zone: null, taskId: null, changeId: CHANGE });
    expect(item).toEqual({ kind: "change", ref: CHANGE, label: CHANGE });
    expect(wantedLensFor(item, false)).toBe("place");
    const registry = [{ id: "place", available: true, target: { kind: "change", needs: "a change awaiting placement" } }];
    expect(resolveLens("place", registry, item)).toEqual({ wanted: "place", running: "place" });
  });

  it("is drawn only while Sidecar is on, and attaches the change on click", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => { render(h(PlaceWithSidecarButton, { changeId: CHANGE }), host!); });
    expect(host.querySelector(".cp-place-with-sidecar")).toBeNull();

    const place = vi.fn();
    await act(async () => {
      render(h(PlaceWithSidecarContext.Provider, { value: { place, attached: null } }, h(PlaceWithSidecarButton, { changeId: CHANGE })), host!);
    });
    const control = q<HTMLButtonElement>(host, ".cp-place-with-sidecar");
    expect(control.textContent).toBe("Place with Sidecar");
    await click(control);
    expect(place).toHaveBeenCalledWith(CHANGE);
  });
});
