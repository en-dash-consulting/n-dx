// @vitest-environment jsdom
/**
 * The choice card (`ask_choice`) in the Sidecar drawer: a row per option with
 * a selected state, arrow-key movement, an Other row for free text, and Send,
 * which approves with the answer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { SidecarCards } from "../../../src/viewer/components/sidecar-cards.js";
import type { SidecarCard, SidecarCardDecision } from "../../../src/viewer/hooks/use-sidecar.js";

const MANIFEST = { cliNames: ["ndx"], effects: {}, layoutPaths: {} };

function choiceCard(over: Partial<SidecarCard> = {}, multiSelect = false): SidecarCard {
  return {
    id: "q1", sessionId: "s1", tool: "ask_choice", kind: "choice", allowListKey: null,
    input: { question: "Which store?" },
    choice: {
      question: "Which store?", multiSelect,
      options: [{ label: "SQLite", description: "one file" }, { label: "Postgres" }, { label: "Files" }],
    },
    status: "pending", raisedAt: "2026-11-06T00:00:01.000Z", ...over,
  };
}

let host: HTMLElement | null = null;
const decide = vi.fn(async (_id: string, _decision: SidecarCardDecision) => true);

async function mount(card: SidecarCard): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => { render(h(SidecarCards, { cards: [card], manifest: MANIFEST, decide }), host!); });
  return host;
}

afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = null;
  decide.mockClear();
});

const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLInputElement>("input[data-choice-row]")];
const send = (el: HTMLElement) => el.querySelector<HTMLButtonElement>(".sidecar-card-approve")!;
const press = async (target: HTMLElement, key: string) => {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
};

describe("choice card", () => {
  it("shows the question, a radio row per option and an Other row, and Send waits for an answer", async () => {
    const el = await mount(choiceCard());
    expect(el.querySelector(".sidecar-card-title")?.textContent).toBe("Which store?");
    expect(el.querySelector(".sidecar-choice-question")?.textContent).toBe("Which store?");
    expect(el.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(rows(el).map((r) => r.type)).toEqual(["radio", "radio", "radio", "radio"]);
    expect([...el.querySelectorAll(".sidecar-choice-label")].map((l) => l.textContent)).toEqual(["SQLite", "Postgres", "Files", "Other"]);
    expect(el.querySelector(".sidecar-choice-description")?.textContent).toBe("one file");
    expect(send(el).textContent).toBe("Send");
    expect(send(el).disabled).toBe(true);
    expect(el.querySelector(".sidecar-card-always")).toBeNull();
  });

  it("marks the picked row selected and sends it as the answer", async () => {
    const el = await mount(choiceCard());
    await act(async () => { rows(el)[1]!.click(); });
    expect(el.querySelectorAll(".sidecar-choice-row.is-selected")).toHaveLength(1);
    expect(el.querySelector(".sidecar-choice-row.is-selected")?.textContent).toContain("Postgres");
    expect(send(el).disabled).toBe(false);
    await act(async () => { send(el).click(); });
    expect(decide).toHaveBeenCalledWith("q1", { approve: true, answer: { selected: ["Postgres"] } });
  });

  it("moves with the arrow keys, wrapping, and selects the row a single answer lands on", async () => {
    const el = await mount(choiceCard());
    const [a, , , other] = rows(el);
    a!.focus();
    await press(a!, "ArrowDown");
    expect(document.activeElement).toBe(rows(el)[1]);
    expect(rows(el)[1]!.checked).toBe(true);
    await press(rows(el)[1]!, "ArrowUp");
    await press(rows(el)[0]!, "ArrowUp");
    expect(document.activeElement).toBe(other);
    expect(other!.checked).toBe(true);
    // Only the picked row is a tab stop.
    expect(rows(el).map((r) => r.tabIndex)).toEqual([-1, -1, -1, 0]);
  });

  it("Other sends free text, and an empty Other is no answer", async () => {
    const el = await mount(choiceCard());
    const text = el.querySelector<HTMLInputElement>(".sidecar-choice-other-input")!;
    await act(async () => { rows(el)[0]!.click(); });
    await type(text, "  Redis  ");
    // Typing in Other lets go of the option a single answer held.
    expect(rows(el)[0]!.checked).toBe(false);
    expect(rows(el)[3]!.checked).toBe(true);
    await type(text, "   ");
    expect(send(el).disabled).toBe(true);
    await type(text, "  Redis  ");
    await act(async () => { send(el).click(); });
    expect(decide).toHaveBeenCalledWith("q1", { approve: true, answer: { selected: [], other: "Redis" } });
  });

  it("sends from the Other field with Enter", async () => {
    const el = await mount(choiceCard());
    const text = el.querySelector<HTMLInputElement>(".sidecar-choice-other-input")!;
    await type(text, "Redis");
    await press(text, "Enter");
    expect(decide).toHaveBeenCalledWith("q1", { approve: true, answer: { selected: [], other: "Redis" } });
  });

  it("takes several answers as checkboxes when multiSelect is set", async () => {
    const el = await mount(choiceCard({}, true));
    expect(rows(el).map((r) => r.type)).toEqual(["checkbox", "checkbox", "checkbox", "checkbox"]);
    await act(async () => { rows(el)[0]!.click(); });
    await act(async () => { rows(el)[2]!.click(); });
    await type(el.querySelector<HTMLInputElement>(".sidecar-choice-other-input")!, "Redis");
    await act(async () => { send(el).click(); });
    expect(decide).toHaveBeenCalledWith("q1", { approve: true, answer: { selected: ["SQLite", "Files"], other: "Redis" } });
  });

  it("Skip denies with no answer", async () => {
    const el = await mount(choiceCard());
    const skip = el.querySelector<HTMLButtonElement>(".sidecar-card-deny")!;
    expect(skip.textContent).toBe("Skip");
    await act(async () => { skip.click(); });
    expect(decide).toHaveBeenCalledWith("q1", { approve: false, reason: "" });
  });

  it("reads back the answer on a settled card", async () => {
    const el = await mount(choiceCard({
      status: "approved", carriedOut: { ok: true },
      choice: { ...choiceCard().choice!, answer: { selected: ["SQLite"], other: "or Redis" } },
    }, true));
    expect(el.querySelector(".sidecar-card-note")?.textContent).toBe("Answered · SQLite · Other: or Redis");
  });
});
