/**
 * `ask_choice`: the agent asks the operator to pick between options. It raises
 * a choice card that is never allow-listable and writes nothing; the
 * operator's answer, sent with the approval, is the tool result. Through a
 * real broker and MCP client.
 */

import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrokerMcpServer } from "../../src/server/sidecar/broker-mcp.js";
import { allowListKey, BROKER_SCOPE_TOOLS, BROKER_TOOL_POLICY } from "../../src/server/sidecar/broker-policy.js";
import { BrokerDecisionError, SidecarBroker, type SidecarCard } from "../../src/server/sidecar/broker.js";
import { readChoiceAnswer, readChoiceCall } from "../../src/server/sidecar/choice-card.js";
import { DESCRIBE_INSTRUCTIONS, DIAGNOSE_BRANCH_INSTRUCTIONS, DIAGNOSE_RUN_INSTRUCTIONS, EXPLAIN_INSTRUCTIONS, GUIDE_INSTRUCTIONS, PLACE_INSTRUCTIONS } from "../../src/server/sidecar/lens-instructions.js";
import { removeTestDir } from "../helpers/server-route-test-support.js";

const INPUT = { question: "Which store?", options: [{ label: "SQLite", description: "one file" }, { label: "Postgres" }] };

let root: string;
let raised: SidecarCard[];
let broker: SidecarBroker;
let clients: Client[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sidecar-choice-"));
  mkdirSync(join(root, "sidecar"), { recursive: true });
  raised = [];
  clients = [];
  broker = new SidecarBroker({ dir: join(root, "sidecar"), onCard: (card) => { if (card.status === "pending") raised.push(card); } });
});

afterEach(async () => {
  for (const client of clients) await client.close();
  await removeTestDir(root);
});

async function connect(): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  // No actions: a question needs none.
  await createBrokerMcpServer(broker, "s1").connect(serverSide);
  const client = new Client({ name: "test-cli", version: "0" });
  await client.connect(clientSide);
  clients.push(client);
  return client;
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>): string => (result.content as Array<{ text: string }>)[0]!.text;
const tick = () => new Promise((r) => setTimeout(r, 20));

describe("ask_choice policy", () => {
  it("raises a choice card that can never be allow-listed, for a worktree session only", () => {
    expect(BROKER_TOOL_POLICY.ask_choice).toEqual({ card: "choice", allowList: "never" });
    expect(allowListKey("ask_choice", INPUT)).toBeNull();
    expect(BROKER_SCOPE_TOOLS.worktree).toContain("ask_choice");
    expect(BROKER_SCOPE_TOOLS.hub).not.toContain("ask_choice");
  });
});

describe("ask_choice call", () => {
  it("reads the question and options, and refuses a call with no real choice", () => {
    expect(readChoiceCall(INPUT)).toEqual({ question: "Which store?", multiSelect: false, options: [{ label: "SQLite", description: "one file" }, { label: "Postgres" }] });
    expect(readChoiceCall({ ...INPUT, multiSelect: true })).toMatchObject({ multiSelect: true });
    expect(readChoiceCall({ ...INPUT, question: " " })).toMatch(/question/);
    expect(readChoiceCall({ ...INPUT, options: [{ label: "A" }] })).toMatch(/at least two/);
    expect(readChoiceCall({ ...INPUT, options: [{ label: "A" }, { label: " A " }] })).toMatch(/listed twice/);
    expect(readChoiceCall({ ...INPUT, options: [{ label: "A" }, { label: "" }] })).toMatch(/label/);
  });

  it("accepts an answer that is an option or Other text, and refuses the rest", () => {
    const choice = readChoiceCall(INPUT) as Exclude<ReturnType<typeof readChoiceCall>, string>;
    expect(readChoiceAnswer(choice, { selected: ["SQLite"] })).toEqual({ selected: ["SQLite"] });
    expect(readChoiceAnswer(choice, { other: " Redis " })).toEqual({ selected: [], other: "Redis" });
    expect(readChoiceAnswer(choice, {})).toMatch(/picks an option/);
    expect(readChoiceAnswer(choice, { selected: ["Mongo"] })).toMatch(/not an option/);
    expect(readChoiceAnswer(choice, { selected: ["SQLite", "Postgres"] })).toMatch(/one answer/);
    expect(readChoiceAnswer(choice, { selected: ["SQLite"], other: "Redis" })).toMatch(/one answer/);
    expect(readChoiceAnswer({ ...choice, multiSelect: true }, { selected: ["SQLite", "Postgres"], other: "Redis" }))
      .toEqual({ selected: ["SQLite", "Postgres"], other: "Redis" });
  });
});

describe("ask_choice", () => {
  it("holds the call on a card and returns the operator's pick as the tool result", async () => {
    const client = await connect();
    const call = client.callTool({ name: "ask_choice", arguments: INPUT });
    await tick();
    expect(raised).toHaveLength(1);
    const card = raised[0]!;
    expect(card).toMatchObject({ kind: "choice", tool: "ask_choice", allowListKey: null, status: "pending" });
    expect(card.choice).toEqual({ question: "Which store?", multiSelect: false, options: INPUT.options });
    broker.decide("s1", card.id, { approve: true, answer: { selected: ["Postgres"] } });
    const result = await call;
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('The operator answered "Which store?": chose "Postgres".');
    expect(broker.cards("s1")[0]!.choice?.answer).toEqual({ selected: ["Postgres"] });
  });

  it("returns Other free text as the answer", async () => {
    const client = await connect();
    const call = client.callTool({ name: "ask_choice", arguments: { ...INPUT, multiSelect: true } });
    await tick();
    broker.decide("s1", raised[0]!.id, { approve: true, answer: { selected: ["SQLite"], other: "and Redis for sessions" } });
    expect(textOf(await call)).toContain('chose "SQLite"; wrote in (Other): "and Redis for sessions".');
  });

  it("refuses an approval without a valid answer and leaves the card waiting", async () => {
    const client = await connect();
    const call = client.callTool({ name: "ask_choice", arguments: INPUT });
    await tick();
    const id = raised[0]!.id;
    expect(() => broker.decide("s1", id, { approve: true })).toThrow(BrokerDecisionError);
    expect(() => broker.decide("s1", id, { approve: true, answer: { selected: ["Mongo"] } })).toThrow(/not an option/);
    expect(() => broker.decide("s1", id, { approve: false, answer: { selected: ["SQLite"] } })).toThrow(/Only an approval carries an answer/);
    expect(broker.cards("s1")[0]!.status).toBe("pending");
    broker.decide("s1", id, { approve: false, reason: "later" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No answer was given.");
  });

  it("raises no card for a call with no real choice", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "ask_choice", arguments: { question: "Which?", options: [{ label: "A" }, { label: "A" }] } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No card was raised");
    expect(raised).toHaveLength(0);
  });

  it("takes no answer on any other card", async () => {
    const client = await connect();
    const call = client.callTool({ name: "run_command", arguments: { argv: ["ndx", "ci", "."] } });
    await tick();
    expect(() => broker.decide("s1", raised[0]!.id, { approve: true, answer: { selected: ["x"] } })).toThrow(/takes no answer/);
    broker.decide("s1", raised[0]!.id, { approve: false });
    await call;
  });
});

describe("lens instructions", () => {
  it("tell every worktree lens to ask a decision with ask_choice", () => {
    for (const instructions of [EXPLAIN_INSTRUCTIONS, DIAGNOSE_RUN_INSTRUCTIONS, GUIDE_INSTRUCTIONS, DIAGNOSE_BRANCH_INSTRUCTIONS, PLACE_INSTRUCTIONS, DESCRIBE_INSTRUCTIONS]) {
      expect(instructions).toContain("`ask_choice`");
    }
  });
});
