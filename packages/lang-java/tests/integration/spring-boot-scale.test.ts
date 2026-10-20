/**
 * Spring Boot's rules on one large generated method: pairing captures with
 * their owners and following call chains must stay near-linear in the number
 * of calls. Work is counted, not timed: every read of a capture's position is
 * tallied, so the result is exact and machine-independent. A per-capture scan
 * of every owner, call or declaration reads positions n × m times and fails
 * the bound.
 */

import { describe, expect, it } from "vitest";
import { createTreeSitterRunner, skipUnlessGrammar, type Capture } from "@n-dx/lang-runtime";

import { javaGrammarPath, javaPack } from "../../src/java-pack.js";
import { readSpringFile, springBoot } from "../../src/spring-boot.js";

/**
 * One method with `calls` statements (client calls, a chain, plain calls and a
 * nested call), each after a local declaration, so declarations grow with calls.
 */
function generated(calls: number): string {
  const lines: string[] = [];
  for (let i = 0; i < calls; i++) {
    // The RestTemplate call goes through its own local, so its type comes from that declaration.
    lines.push(i % 4 === 0 ? `    RestTemplate r${i} = rest;` : `    String s${i} = "v${i}";`);
    lines.push(
      i % 4 === 0
        ? `    r${i}.getForObject("http://svc/${i}", String.class);`
        : i % 4 === 1
          ? `    client.get().uri("/x/${i}").retrieve();`
          : i % 4 === 2
            ? `    log.info("step ${i}", value, other(${i}));`
            : `    kafka.send("topic-${i}", payload);`,
    );
  }
  return [
    "package com.example;",
    "@RestController",
    '@RequestMapping("/api")',
    "class Big {",
    "  private RestTemplate rest;",
    "  private WebClient client;",
    "  private KafkaTemplate<String, String> kafka;",
    '  @GetMapping({"/a", "/b"})',
    "  void run() {",
    ...lines,
    "  }",
    "}",
    "",
  ].join("\n");
}

/** `captures` with every `start` and `end` read counted in `reads.count`. */
function counted(captures: Readonly<Record<string, readonly Capture[]>>, reads: { count: number }): Record<string, Capture[]> {
  const wrap = (c: Capture): Capture => ({
    name: c.name,
    nodeType: c.nodeType,
    text: c.text,
    get start() {
      reads.count++;
      return c.start;
    },
    get end() {
      reads.count++;
      return c.end;
    },
  });
  return Object.fromEntries(Object.entries(captures).map(([query, list]) => [query, list.map(wrap)]));
}

describe("Spring Boot rules on a large generated file", () => {
  it("read positions near-linearly in the number of calls, with the same facts per call", async (ctx) => {
    skipUnlessGrammar(ctx, javaGrammarPath());
    const runner = createTreeSitterRunner({ maxFileBytes: 16 * 1024 * 1024 });
    const target = { pack: { ...javaPack, queries: [...javaPack.queries, ...springBoot.queries] }, grammarPath: javaGrammarPath() };
    try {
      const measure = async (calls: number) => {
        const parsed = await runner.parseSource(target, "Big.java", generated(calls));
        if (parsed.status !== "parsed") throw new Error(`not parsed: ${parsed.status}`);
        const reads = { count: 0 };
        const facts = readSpringFile({ path: "Big.java", captures: counted(parsed.captures, reads) });
        return { reads: reads.count, facts };
      };
      const small = await measure(1_000);
      const large = await measure(8_000);

      // Three outbound facts per four calls (RestTemplate, WebClient, Kafka); the routes do not grow.
      expect(small.facts.outboundCalls).toHaveLength(750);
      expect(large.facts.outboundCalls).toHaveLength(6_000);
      expect(large.facts.routes.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /api/a", "GET /api/b"]);
      expect(new Set(large.facts.outboundCalls.map((c) => `${c.client} ${c.confidence}`))).toEqual(
        new Set(["RestTemplate certain", "WebClient certain", "KafkaTemplate certain"]),
      );

      // An 8x step: sorting adds a log factor (about 1.3x here); a scan per capture would be 64x.
      expect(large.reads / small.reads).toBeLessThan(8 * 1.6);
    } finally {
      runner.dispose();
    }
  });
});
