// @vitest-environment jsdom
/**
 * The external-call card (story 43) in the Sidecar drawer: a form drawn from
 * the tool's input schema and prefilled with the agent's arguments, the
 * connection and workspace host in its header, an idempotency key shown
 * read-only, a picker where the card carries choices, and a validation error's
 * problems list. Approve sends the edited arguments.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { SidecarCards } from "../../../src/viewer/components/sidecar-cards.js";
import {
  fieldKind, formFields, idempotencyKey, parseJsonField, parseList, parseNumber, workspaceLine,
} from "../../../src/viewer/components/sidecar-external-call.js";
import type { SidecarCard, SidecarCardDecision } from "../../../src/viewer/hooks/use-sidecar.js";

const SCHEMA = {
  type: "object",
  required: ["title"],
  properties: {
    title: { type: "string", description: "What the item is called" },
    estimate: { type: "integer" },
    ratio: { type: "number" },
    urgent: { type: "boolean" },
    priority: { enum: ["low", "high"] },
    labels: { type: "array", items: { type: "string" } },
    owner: { type: "object", required: ["name"], properties: { name: { type: "string" }, seats: { type: "integer" } } },
    links: { type: "array", items: { type: "object", properties: { url: { type: "string" } } } },
    ownerId: { type: "string" },
    requestId: { type: "string" },
  },
};

const ARGS = {
  title: "Ship it",
  estimate: 3,
  urgent: false,
  priority: "low",
  labels: ["a", "b"],
  owner: { name: "Rae" },
  links: [{ url: "https://x.test" }],
  requestId: "req-1",
  extra: { kept: true },
};

function externalCard(over: Partial<SidecarCard> = {}): SidecarCard {
  return {
    id: "x1", sessionId: "s1", tool: "external_call", kind: "external-call", allowListKey: null,
    input: { connection: "caos", tool: "caos.create_item", class: "write", arguments: ARGS },
    externalCall: { label: "CAOS", host: "caos.endash.us", inputSchema: SCHEMA },
    status: "pending", raisedAt: "2026-11-05T00:00:01.000Z", ...over,
  };
}

let host: HTMLElement | null = null;

afterEach(async () => {
  if (host) {
    await act(async () => { render(null, host!); });
    host.remove();
    host = null;
  }
});

async function draw(card: SidecarCard, decide = vi.fn(async (_id: string, _d: SidecarCardDecision) => true)) {
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => { render(h(SidecarCards, { cards: [card], manifest: null, decide }), host!); });
  return { el: host, decide };
}

const field = (el: Element, name: string) => el.querySelector<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>(`[data-field="${name}"]`)!;
const approve = (el: Element) => el.querySelector<HTMLButtonElement>(".sidecar-card-approve")!;

async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function click(el: Element) { await act(async () => { (el as HTMLElement).click(); }); }

describe("external-call card form", () => {
  it("draws a field per schema property, by type, prefilled with the agent's arguments", async () => {
    const { el } = await draw(externalCard());
    expect(field(el, "title").value).toBe("Ship it");
    expect(field(el, "title").type).toBe("text");
    expect(field(el, "estimate").value).toBe("3");
    expect(field(el, "ratio").value).toBe("");
    expect(field(el, "urgent").type).toBe("checkbox");
    expect(field(el, "urgent").checked).toBe(false);
    expect(field(el, "priority").tagName).toBe("SELECT");
    expect(field(el, "priority").value).toBe("low");
    expect([...field(el, "priority").options].map((o) => o.value)).toEqual(["", "low", "high"]);
    expect(field(el, "labels").value).toBe("a\nb");
    // An object one level deep is a group of fields.
    expect(el.querySelector('fieldset[data-field="owner"]')).not.toBeNull();
    expect(field(el, "owner.name").value).toBe("Rae");
    // A list of objects, and an argument the schema does not name, fall back to a JSON field.
    expect(JSON.parse(field(el, "links").value)).toEqual([{ url: "https://x.test" }]);
    expect(JSON.parse(field(el, "extra").value)).toEqual({ kept: true });
  });

  it("marks required fields", async () => {
    const { el } = await draw(externalCard());
    expect(field(el, "title").getAttribute("aria-required")).toBe("true");
    expect(field(el, "title").closest("label")!.querySelector(".sidecar-external-required")).not.toBeNull();
    expect(field(el, "estimate").getAttribute("aria-required")).toBeNull();
    expect(field(el, "owner.name").closest("label")!.querySelector(".sidecar-external-required")).not.toBeNull();
  });

  it("names the connection and workspace host, and shows the idempotency key read-only", async () => {
    const { el } = await draw(externalCard());
    expect(el.querySelector(".sidecar-external-workspace")!.textContent).toBe("CAOS · caos.endash.us");
    const key = el.querySelector(".sidecar-external-key")!;
    expect(key.textContent).toContain("requestId");
    expect(key.querySelector(".sidecar-external-key-value")!.textContent).toBe("req-1");
    // Read-only: there is no input for it.
    expect(el.querySelector('[data-field="requestId"]')).toBeNull();
    expect(key.querySelector("input, textarea, select")).toBeNull();
  });

  it("reads an idempotencyKey argument the same way, and shows none when there is none", async () => {
    const withKey = await draw(externalCard({ input: { connection: "caos", tool: "caos.t", class: "write", arguments: { title: "t", idempotencyKey: "k-9" } } }));
    expect(withKey.el.querySelector(".sidecar-external-key-value")!.textContent).toBe("k-9");
    await act(async () => { render(null, host!); });
    const without = await draw(externalCard({ input: { connection: "caos", tool: "caos.t", class: "write", arguments: { title: "t" } } }));
    expect(without.el.querySelector(".sidecar-external-key")).toBeNull();
  });

  it("an unedited Approve sends no arguments: the agent's go as they are", async () => {
    const { el, decide } = await draw(externalCard());
    await click(approve(el));
    expect(decide).toHaveBeenCalledWith("x1", { approve: true });
  });

  it("Approve sends the edited arguments, with untouched ones and the arguments the schema does not name", async () => {
    const { el, decide } = await draw(externalCard());
    await type(field(el, "title"), "Ship it now");
    await type(field(el, "estimate"), "5");
    await click(field(el, "urgent"));
    await choose(field(el, "priority"), "high");
    await type(field(el, "labels"), "a\n\nc\n");
    await type(field(el, "owner.name"), "Sam");
    await type(field(el, "owner.seats"), "2");
    await click(approve(el));
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith("x1", {
      approve: true,
      arguments: {
        title: "Ship it now",
        estimate: 5,
        urgent: true,
        priority: "high",
        labels: ["a", "c"],
        owner: { name: "Sam", seats: 2 },
        links: [{ url: "https://x.test" }],
        requestId: "req-1",
        extra: { kept: true },
      },
    });
  });

  it("clearing an optional field removes the property", async () => {
    const { el, decide } = await draw(externalCard());
    await type(field(el, "estimate"), "");
    await click(approve(el));
    const sent = decide.mock.calls[0][1].arguments!;
    expect("estimate" in sent).toBe(false);
  });

  it("holds Approve while a field's text is not a value of its type, and again after it is fixed", async () => {
    const { el, decide } = await draw(externalCard());
    await type(field(el, "estimate"), "3.5");
    expect(approve(el).disabled).toBe(true);
    expect(field(el, "estimate").getAttribute("aria-invalid")).toBe("true");
    await type(field(el, "extra"), "{ not json");
    await type(field(el, "estimate"), "4");
    expect(approve(el).disabled).toBe(true);
    await type(field(el, "extra"), '{"kept":false}');
    expect(approve(el).disabled).toBe(false);
    await click(approve(el));
    expect(decide.mock.calls[0][1].arguments).toMatchObject({ estimate: 4, extra: { kept: false } });
  });

  it("Deny sends no arguments", async () => {
    const { el, decide } = await draw(externalCard());
    await type(field(el, "title"), "changed");
    await click(el.querySelector(".sidecar-card-deny")!);
    expect(decide).toHaveBeenCalledWith("x1", { approve: false, reason: "" });
  });
});

describe("external-call card pickers", () => {
  it("draws a plain field for a property with no choices", async () => {
    const { el } = await draw(externalCard());
    expect(field(el, "ownerId").tagName).toBe("INPUT");
  });

  it("draws a picker for a property the card carries choices for, and sends the chosen value", async () => {
    const card = externalCard({
      input: { connection: "caos", tool: "caos.t", class: "write", arguments: { title: "t", ownerId: "u-2" } },
      externalCall: {
        label: "CAOS", host: "caos.endash.us", inputSchema: SCHEMA,
        options: { ownerId: [{ value: "u-1", label: "Ada" }, { value: "u-2", label: "Grace" }] },
      },
    });
    const { el, decide } = await draw(card);
    const picker = field(el, "ownerId");
    expect(picker.tagName).toBe("SELECT");
    expect([...picker.options].map((o) => o.textContent)).toEqual(["—", "Ada", "Grace"]);
    expect(picker.value).toBe("u-2");
    await choose(picker, "u-1");
    await click(approve(el));
    expect(decide.mock.calls[0][1].arguments).toEqual({ title: "t", ownerId: "u-1" });
  });

  it("keeps the agent's own value as a choice when the list does not hold it", async () => {
    const card = externalCard({
      input: { connection: "caos", tool: "caos.t", class: "write", arguments: { title: "t", ownerId: "u-9" } },
      externalCall: { label: "CAOS", inputSchema: SCHEMA, options: { ownerId: [{ value: "u-1", label: "Ada" }] } },
    });
    const { el } = await draw(card);
    expect(field(el, "ownerId").value).toBe("u-9");
    expect([...field(el, "ownerId").options].map((o) => o.value)).toEqual(["", "u-9", "u-1"]);
  });
});

describe("external-call card after the call", () => {
  it("shows a validation error's problems, and no form", async () => {
    const { el } = await draw(externalCard({
      status: "approved",
      carriedOut: { ok: false, problems: [{ field: "estimate", message: "must be positive" }, { message: "title too long" }] },
    }));
    const problems = el.querySelector(".sidecar-external-problems")!;
    expect(problems.getAttribute("role")).toBe("alert");
    expect(problems.textContent).toContain("2 problems");
    expect(problems.textContent).toContain("nothing was retried");
    expect([...problems.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["estimate must be positive", "title too long"]);
    expect(el.querySelector(".sidecar-external-form")).toBeNull();
  });

  it("shows no problems list for a call that succeeded", async () => {
    const { el } = await draw(externalCard({ status: "approved", carriedOut: { ok: true } }));
    expect(el.querySelector(".sidecar-external-problems")).toBeNull();
  });
});

describe("external-call form logic", () => {
  it("classifies a schema", () => {
    expect(fieldKind({ type: "string" })).toEqual({ kind: "scalar", type: "string" });
    expect(fieldKind({ type: "integer" })).toEqual({ kind: "scalar", type: "integer" });
    expect(fieldKind({ type: "string", enum: ["a", "b"] })).toEqual({ kind: "enum", values: ["a", "b"] });
    expect(fieldKind({ type: "array", items: { type: "number" } })).toEqual({ kind: "list", item: "number" });
    expect(fieldKind({ type: "object", properties: { a: { type: "string" } } })).toMatchObject({ kind: "object" });
    // One level only: an object inside an object is a JSON field.
    expect(fieldKind({ type: "object", properties: { a: { type: "string" } } }, true)).toEqual({ kind: "json" });
    for (const schema of [undefined, {}, { type: ["string", "null"] }, { anyOf: [{ type: "string" }] }, { type: "array", items: { type: "object" } }, { type: "array", items: { type: "string", enum: ["a"] } }]) {
      expect(fieldKind(schema)).toEqual({ kind: "json" });
    }
  });

  it("lists the schema's properties, then arguments it does not name, leaving out idempotency keys", () => {
    expect(formFields({ properties: { a: {}, requestId: {}, b: {} }, required: ["b"] }, { a: 1, z: 2, idempotencyKey: "k" }))
      .toEqual([{ name: "a", schema: {}, required: false }, { name: "b", schema: {}, required: true }, { name: "z", schema: undefined, required: false }]);
  });

  it("reads an idempotency key and names the workspace", () => {
    expect(idempotencyKey({ requestId: "r" })).toEqual({ name: "requestId", value: "r" });
    expect(idempotencyKey({ idempotencyKey: 7 })).toEqual({ name: "idempotencyKey", value: "7" });
    expect(idempotencyKey({ requestId: { x: 1 } })).toBeUndefined();
    expect(workspaceLine({ label: "CAOS", host: "caos.endash.us" })).toBe("CAOS · caos.endash.us");
    expect(workspaceLine({ label: "Local" })).toBe("Local");
  });

  it("parses numbers, lists and JSON text", () => {
    expect(parseNumber("", "number")).toBeUndefined();
    expect(parseNumber(" 2.5 ", "number")).toBe(2.5);
    expect(parseNumber("2.5", "integer")).toBeNull();
    expect(parseNumber("abc", "number")).toBeNull();
    expect(parseList("1\n2\n\n3", "integer")).toEqual([1, 2, 3]);
    expect(parseList("1\nx", "number")).toBeNull();
    expect(parseList("true\nfalse", "boolean")).toEqual([true, false]);
    expect(parseJsonField("")).toEqual({ ok: true, value: undefined });
    expect(parseJsonField("[1]")).toEqual({ ok: true, value: [1] });
    expect(parseJsonField("[1")).toEqual({ ok: false });
  });
});
