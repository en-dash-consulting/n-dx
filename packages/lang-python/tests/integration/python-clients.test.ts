/**
 * The outbound-call rules (`src/python-clients.ts`) over their fixture
 * project (`tests/fixtures/python-clients`): every client, target and
 * confidence rule a hand check would look for, and how the pack entry runs
 * them only when outbound calls are wanted. The whole output is pinned by
 * the golden in `pack-golden.test.ts`.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import type { FactKind, FileFacts, OutboundCallFact } from "@n-dx/lang-kit";
import { createPackEntry, listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";

import { PYTHON_PACKAGE } from "../../src/package-paths.js";
import { pack } from "../../src/pack.js";
import { PYTHON_CLIENT_CALLEES, PYTHON_CLIENT_CONSTRUCTORS, pythonClients } from "../../src/python-clients.js";
import { pythonGrammarPath, pythonPack } from "../../src/python-pack.js";
import { PYTHON_SYMBOL_RULES } from "../../src/python-symbols.js";
import { PACK_FIXTURE_ROOT } from "../helpers/pack-fixtures.js";

type Ctx = Parameters<typeof skipUnlessGrammar>[0];

const FIXTURE = join(PACK_FIXTURE_ROOT, "..", "python-clients");

async function analyze(ctx: Ctx, kinds: readonly FactKind[] = ["outboundCalls"]) {
  skipUnlessGrammar(ctx, pythonGrammarPath());
  return pack.analyzeProject({ projectDir: FIXTURE, files: listFixtureFiles(FIXTURE, [".py"]), kinds });
}

/** `line kind client confidence source:target`. */
const call = (c: OutboundCallFact): string => `${c.position.line} ${c.kind} ${c.client} ${c.confidence} ${c.targetSource}:${c.target}`;
const callsOf = (facts: readonly FileFacts[], file: string): string[] | undefined => facts.find((f) => f.path === file)?.outboundCalls?.map(call);

describe("Python outbound calls", () => {
  it("reads HTTP clients: module functions, aliases, sessions, async with, and every target rule", async (ctx) => {
    const { facts, notices } = await analyze(ctx);
    expect(notices).toBeUndefined();
    expect(callsOf(facts, "app/http_calls.py")).toEqual([
      "16 http requests certain literal:https://api.example.com/items",
      "17 http requests certain literal:https://api.example.com/items",
      // request(method, url)
      "18 http requests certain literal:https://api.example.com/items/1",
      // An env lookup as the URL is also an env call.
      "19 http requests certain env:ITEMS_URL",
      "19 env os.environ certain env:ITEMS_URL",
      "20 http requests certain config:STATUS_URL",
      // An f-string takes its first part: a settings field, or the literal before the first field.
      "21 http requests certain config:API_BASE",
      "22 http requests certain literal:https://api.example.com/items/",
      // `+` takes its first operand.
      "23 http requests certain literal:https://api.example.com",
      "24 http requests certain env:SEARCH_URL",
      "24 env os.getenv certain env:SEARCH_URL",
      // A name, a call and an empty literal name nothing.
      "25 http requests certain unknown:",
      "26 http requests certain unknown:",
      "27 http requests certain unknown:",
      // A module-level Session used in a function, `from requests import Session`, `with … as`.
      "31 http requests certain literal:https://sessions.example.com/a",
      "33 http requests certain literal:https://sessions.example.com/b",
      "35 http requests certain literal:https://sessions.example.com/c",
      // `import httpx as hx`; a bound Client and an inline one.
      "39 http httpx certain literal:https://httpx.example.com/a",
      "40 http httpx certain config:HTTPX_URL",
      "42 http httpx certain literal:/b",
      "43 http httpx certain literal:https://httpx.example.com/c",
      "48 http httpx certain literal:https://httpx.example.com/async",
      "50 http aiohttp certain literal:https://aiohttp.example.com/a",
      "52 http aiohttp certain literal:https://aiohttp.example.com/b",
      // urlopen of a Request, inline or bound, is reported once, at the Request.
      "56 http urllib certain literal:https://urllib.example.com/a",
      "57 http urllib certain literal:https://urllib.example.com/b",
      "58 http urllib certain literal:https://urllib.example.com/c",
    ]);
  });

  it("reads gRPC channels, queue producers and consumers, and grades unknown receivers", async (ctx) => {
    const { facts } = await analyze(ctx);
    expect(callsOf(facts, "app/rpc.py")).toEqual([
      "8 grpc grpc certain literal:localhost:50051",
      "9 grpc grpc certain config:ORDERS_TARGET",
      "10 grpc grpc certain literal:inventory:50051",
      "11 grpc grpc certain config:PAYMENTS_HOST",
    ]);
    expect(callsOf(facts, "app/queues.py")).toEqual([
      "13 queue confluent_kafka certain literal:orders",
      // One call per subscribed topic.
      "15 queue confluent_kafka certain literal:payments",
      "15 queue confluent_kafka certain env:REFUNDS_TOPIC",
      "15 env os.environ certain env:REFUNDS_TOPIC",
      "16 queue confluent_kafka certain literal:audit",
      "21 queue kafka-python certain literal:clicks",
      "22 queue kafka-python certain literal:views",
      "22 queue kafka-python certain literal:searches",
      "24 queue kafka-python certain literal:signups",
      "25 queue kafka-python certain unknown:",
      // The routing key on the default exchange, else the exchange.
      "31 queue pika certain literal:emails",
      "32 queue pika certain literal:notifications",
      "33 queue pika certain literal:replies",
      // Receivers imported from elsewhere: likely for basic_publish and send_task, nothing for produce.
      "38 queue pika likely literal:events",
      "39 queue celery likely literal:reports.build",
    ]);
    expect(callsOf(facts, "app/celery_app.py")).toEqual(["7 queue celery certain literal:billing.charge", "8 queue celery certain unknown:"]);
  });

  it("reads environment lookups and leaves writes out", async (ctx) => {
    const { facts } = await analyze(ctx);
    expect(callsOf(facts, "app/config.py")).toEqual([
      "6 env os.environ certain env:DATABASE_URL",
      "7 env os.environ certain env:DEBUG",
      "8 env os.getenv certain env:SECRET_KEY",
      "9 env os.environ certain env:REGION",
      "10 env os.getenv certain env:ZONE",
      "11 env os.environ certain unknown:",
    ]);
  });

  it("places a call at its start", async (ctx) => {
    const { facts } = await analyze(ctx);
    expect(facts.find((f) => f.path === "app/rpc.py")?.outboundCalls?.[0]).toEqual({
      kind: "grpc",
      target: "localhost:50051",
      targetSource: "literal",
      client: "grpc",
      confidence: "certain",
      position: { line: 8, column: 4 },
    });
  });
});

describe("the python-clients framework", () => {
  it("is listed by the Python pack, with provenance for its query", () => {
    expect(pythonPack.produces).toContain("outboundCalls");
    expect(pythonPack.frameworks).toContain(pythonClients);
    for (const query of pythonClients.queries) expect(pythonClients.provenance[query.name], query.name).toBeDefined();
  });

  it("captures arguments and constructors for exactly the names its rules read", () => {
    const query = readFileSync(pythonClients.queries[0]!.path, "utf-8");
    const alternatives = (anchor: string): string[] =>
      [...query.matchAll(new RegExp(`#match\\? ${anchor} "\\(\\^\\|\\[\\.\\]\\)\\(([^)]*)\\)\\$"`, "g"))].map((m) => m[1]!);
    const sorted = (names: readonly string[]): string[] => [...names].sort();
    const callees = alternatives("@_function");
    expect(callees.length).toBeGreaterThan(0);
    for (const list of callees) expect(sorted(list.split("|"))).toEqual(sorted(PYTHON_CLIENT_CALLEES));
    const constructors = alternatives("@_constructor");
    expect(constructors.length).toBeGreaterThan(0);
    for (const list of constructors) expect(sorted(list.split("|"))).toEqual(sorted(PYTHON_CLIENT_CONSTRUCTORS));
  });

  it("runs only when outbound calls are wanted", async (ctx) => {
    skipUnlessGrammar(ctx, pythonGrammarPath());
    const read = vi.fn(pythonClients.read);
    const entry = createPackEntry({
      package: PYTHON_PACKAGE,
      pack: { ...pythonPack, frameworks: [{ ...pythonClients, queries: pythonClients.queries, read }] },
      symbolRules: PYTHON_SYMBOL_RULES,
    });
    const files = listFixtureFiles(FIXTURE, [".py"]);

    const routes = await entry.analyzeProject({ projectDir: FIXTURE, files, kinds: ["imports", "routes"] });
    expect(read).not.toHaveBeenCalled();
    expect(routes.facts.every((f) => f.outboundCalls === undefined)).toBe(true);

    const outbound = await entry.analyzeProject({ projectDir: FIXTURE, files, kinds: ["outboundCalls"] });
    expect(read).toHaveBeenCalledOnce();
    expect(outbound.facts.every((f) => Array.isArray(f.outboundCalls) && f.routes === undefined)).toBe(true);
  });
});
