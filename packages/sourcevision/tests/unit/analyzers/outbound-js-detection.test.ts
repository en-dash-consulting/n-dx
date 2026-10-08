/**
 * JS/TS outbound call-site detection — the HTTP and gRPC slice.
 *
 * Each client family gets its own case proving file and line, because a
 * detection without a location is not actionable. Beyond coverage, three
 * properties are pinned deliberately:
 *
 *  - `targetSource` and `confidence` answer different questions. A literal
 *    target and an env-var target on equally direct calls must grade the same,
 *    or the two fields have started encoding the same fact twice.
 *  - Indirection, and only indirection, lowers confidence.
 *  - The detector reads an AST, not source text. The `.get()`/`.post()` decoys
 *    here are the ones a regular expression cannot tell from a real client.
 *
 * @see src/analyzers/outbound-detection.ts
 */
import { describe, it, expect } from "vitest";

import { detectJsOutboundCalls } from "../../../src/analyzers/outbound-detection.js";
import type { OutboundDependency } from "../../../src/schema/index.js";

/** Detections for one source body, as `src/client.ts`. */
function detect(source: string, file = "src/client.ts"): OutboundDependency[] {
  return detectJsOutboundCalls(source, file);
}

/** The one detection a source is expected to produce. */
function only(source: string, file?: string): OutboundDependency {
  const found = detect(source, file);
  expect(found).toHaveLength(1);
  return found[0];
}

describe("HTTP client families", () => {
  it("detects the global fetch with its file and line", () => {
    const dep = only(
      [
        `export async function load() {`,
        `  return fetch("https://api.example.com/orders");`,
        `}`,
      ].join("\n"),
      "src/orders.ts",
    );

    expect(dep).toEqual({
      file: "src/orders.ts",
      line: 2,
      kind: "http",
      target: "https://api.example.com/orders",
      targetSource: "literal",
      client: "fetch",
      confidence: "certain",
    });
  });

  it("detects axios through its default export and its verb methods", () => {
    const found = detect(
      [
        `import axios from "axios";`,
        `axios("https://a.example.com/one");`,
        `axios.get("https://a.example.com/two");`,
        `axios.post("https://a.example.com/three", { body: 1 });`,
      ].join("\n"),
    );

    expect(found.map((d) => [d.line, d.client, d.target])).toEqual([
      [2, "axios", "https://a.example.com/one"],
      [3, "axios", "https://a.example.com/two"],
      [4, "axios", "https://a.example.com/three"],
    ]);
    expect(found.every((d) => d.kind === "http" && d.confidence === "certain")).toBe(true);
  });

  it("detects got", () => {
    const dep = only(
      [`import got from "got";`, `const res = await got.post("https://g.example.com/x");`].join("\n"),
    );
    expect(dep).toMatchObject({
      line: 2,
      client: "got",
      kind: "http",
      target: "https://g.example.com/x",
      targetSource: "literal",
    });
  });

  it("detects undici's named request export", () => {
    const dep = only(
      [`import { request } from "undici";`, `await request("https://u.example.com/x");`].join("\n"),
    );
    expect(dep).toMatchObject({ line: 2, client: "undici", kind: "http", targetSource: "literal" });
  });

  it("detects an undici connection pool built on a constructor", () => {
    const dep = only(
      [`import { Pool } from "undici";`, `const pool = new Pool("https://u.example.com");`].join("\n"),
    );
    expect(dep).toMatchObject({
      line: 2,
      client: "undici",
      target: "https://u.example.com",
      confidence: "certain",
    });
  });

  it("detects ky", () => {
    const dep = only([`import ky from "ky";`, `await ky.get("https://k.example.com/x");`].join("\n"));
    expect(dep).toMatchObject({ line: 2, client: "ky", kind: "http" });
  });

  it("detects node-fetch, and names it apart from the global", () => {
    const dep = only(
      [`import fetch from "node-fetch";`, `await fetch("https://n.example.com/x");`].join("\n"),
    );
    expect(dep).toMatchObject({ line: 2, client: "node-fetch", kind: "http" });
  });

  it("detects a CommonJS client bound through require", () => {
    const dep = only(
      [`const axios = require("axios");`, `axios.get("https://a.example.com/x");`].join("\n"),
    );
    expect(dep).toMatchObject({ line: 2, client: "axios", confidence: "certain" });
  });
});

describe("gRPC clients", () => {
  it("detects a client constructed on the grpc module object", () => {
    const dep = only(
      [
        `import * as grpc from "@grpc/grpc-js";`,
        `const client = new grpc.Client("orders.internal:50051", grpc.credentials.createInsecure());`,
      ].join("\n"),
      "src/grpc.ts",
    );

    expect(dep).toEqual({
      file: "src/grpc.ts",
      line: 2,
      kind: "grpc",
      target: "orders.internal:50051",
      targetSource: "literal",
      client: "grpc",
      confidence: "certain",
    });
  });

  it("detects a stub reached through loadPackageDefinition", () => {
    const dep = only(
      [
        `import * as grpc from "@grpc/grpc-js";`,
        `const proto = grpc.loadPackageDefinition(packageDefinition);`,
        `const client = new proto.orders.OrderService("orders.internal:50051", creds);`,
      ].join("\n"),
    );
    expect(dep).toMatchObject({
      line: 3,
      kind: "grpc",
      client: "grpc",
      target: "orders.internal:50051",
      confidence: "certain",
    });
  });

  it("grades a generated stub recognized only by its name as likely", () => {
    // Nothing in the source says this constructor is gRPC except that a gRPC
    // module is imported and the name ends in `Client`. That is an inference,
    // and it is graded as one.
    const dep = only(
      [
        `import { credentials } from "@grpc/grpc-js";`,
        `import { OrderServiceClient } from "./gen/orders_grpc_pb.js";`,
        `const client = new OrderServiceClient("orders.internal:50051", credentials.createInsecure());`,
      ].join("\n"),
    );
    expect(dep).toMatchObject({ line: 3, kind: "grpc", client: "grpc", confidence: "likely" });
  });

  it("ignores a *Client constructor in a file with no gRPC import", () => {
    expect(
      detect([`import { OrderServiceClient } from "./gen.js";`, `new OrderServiceClient("x:1");`].join("\n")),
    ).toEqual([]);
  });
});

describe("targetSource", () => {
  it("records a URL literal as literal", () => {
    expect(only(`import axios from "axios";\naxios.get("https://a.example.com/x");`)).toMatchObject({
      target: "https://a.example.com/x",
      targetSource: "literal",
    });
  });

  it("records a process.env read as env, carrying the variable's name", () => {
    expect(only(`import axios from "axios";\naxios.get(process.env.ORDERS_URL);`)).toMatchObject({
      target: "ORDERS_URL",
      targetSource: "env",
    });
    expect(only(`fetch(process.env["BILLING_URL"]);`)).toMatchObject({
      target: "BILLING_URL",
      targetSource: "env",
    });
  });

  it("prefers the env variable inside an interpolated URL over its literal tail", () => {
    expect(only("fetch(`${process.env.ORDERS_URL}/v1/orders`);")).toMatchObject({
      target: "ORDERS_URL",
      targetSource: "env",
    });
  });

  it("records a config read as config, carrying the key path", () => {
    expect(only(`import got from "got";\ngot.get(config.services.orders);`)).toMatchObject({
      target: "config.services.orders",
      targetSource: "config",
    });
  });

  it("keeps the literal head of an interpolated URL when it names a host", () => {
    expect(only("fetch(`http://127.0.0.1:${port}/api/status`);")).toMatchObject({
      target: "http://127.0.0.1:",
      targetSource: "literal",
    });
  });

  it("rejects a head that is only a scheme, which names nothing", () => {
    // `http://` as a target would say only that this is an HTTP call, which
    // the `http` kind already said. Observed on real sources before the guard.
    expect(only("fetch(`http://${host}:${port}/api/status`);")).toMatchObject({
      target: "",
      targetSource: "unknown",
    });
  });

  it("records an unresolvable target as unknown with an empty target", () => {
    expect(only(`import ky from "ky";\nky.get(buildUrl(id));`)).toMatchObject({
      target: "",
      targetSource: "unknown",
    });
  });

  it("resolves a target named once through a file-local const", () => {
    expect(
      only(
        [
          `import axios from "axios";`,
          `const ORDERS = process.env.ORDERS_URL;`,
          `axios.get(ORDERS);`,
        ].join("\n"),
      ),
    ).toMatchObject({ line: 3, target: "ORDERS_URL", targetSource: "env" });
  });
});

describe("confidence describes the call, not the target", () => {
  it("grades a literal target and an env target identically", () => {
    // The property that keeps the two fields from encoding one fact twice: the
    // calls are equally direct, so they are equally confident, and only
    // targetSource distinguishes them.
    const literal = only(`import axios from "axios";\naxios.get("https://a.example.com/x");`);
    const env = only(`import axios from "axios";\naxios.get(process.env.ORDERS_URL);`);

    expect(literal.confidence).toBe(env.confidence);
    expect(literal.confidence).toBe("certain");
    expect([literal.targetSource, env.targetSource]).toEqual(["literal", "env"]);
  });

  it("holds across client families, including the global fetch", () => {
    const pairs = [
      [`fetch("https://x.example.com/a");`, `fetch(process.env.X_URL);`],
      [
        `import got from "got";\ngot("https://g.example.com/a");`,
        `import got from "got";\ngot(process.env.G_URL);`,
      ],
      [
        `import * as grpc from "@grpc/grpc-js";\nnew grpc.Client("h:1", c);`,
        `import * as grpc from "@grpc/grpc-js";\nnew grpc.Client(process.env.GRPC_ADDR, c);`,
      ],
    ];

    for (const [literalSrc, envSrc] of pairs) {
      const literal = only(literalSrc);
      const env = only(envSrc);
      expect(literal.confidence).toBe(env.confidence);
      expect(literal.targetSource).toBe("literal");
      expect(env.targetSource).toBe("env");
    }
  });

  it("lowers an aliased call below a direct one", () => {
    const direct = only(`import axios from "axios";\naxios.get("https://a.example.com/x");`);
    const aliased = only(
      [
        `import axios from "axios";`,
        `const http = axios;`,
        `http.get("https://a.example.com/x");`,
      ].join("\n"),
    );

    expect(direct.confidence).toBe("certain");
    expect(aliased.confidence).toBe("likely");
    expect(aliased.line).toBe(3);
  });

  it("lowers a call made on a wrapped instance below a direct one", () => {
    const found = detect(
      [
        `import axios from "axios";`,
        `const api = axios.create({ baseURL: process.env.ORDERS_URL });`,
        `export const list = () => api.get("/orders");`,
      ].join("\n"),
    );

    // The create() is itself a direct, certain statement of where this
    // repository points; the call made through the instance is a hop further
    // out. Both carry the host, because the path alone matches no producer.
    expect(found).toEqual([
      {
        file: "src/client.ts",
        line: 2,
        kind: "http",
        target: "ORDERS_URL",
        targetSource: "env",
        client: "axios",
        confidence: "certain",
      },
      {
        file: "src/client.ts",
        line: 3,
        kind: "http",
        target: "ORDERS_URL",
        targetSource: "env",
        client: "axios",
        confidence: "likely",
      },
    ]);
  });

  it("lowers a dynamic member access to inferred", () => {
    const dep = only(
      [
        `import axios from "axios";`,
        `export const call = (verb) => axios[verb]("https://a.example.com/x");`,
      ].join("\n"),
    );
    expect(dep).toMatchObject({ line: 2, client: "axios", confidence: "inferred" });
  });

  it("treats a string-literal member access as the static call it is", () => {
    const dep = only(`import axios from "axios";\naxios["get"]("https://a.example.com/x");`);
    expect(dep.confidence).toBe("certain");
  });
});

describe("structural detection, not text matching", () => {
  it("ignores verb-named methods on objects that are not clients", () => {
    // Every line here would match a regex for `\.get\(` or `\.post\(`. None of
    // them is an outbound call, and the AST walk never considers them because
    // no binding reaches a client library.
    expect(
      detect(
        [
          `const cache = new Map();`,
          `cache.get("https://not-a-request.example.com");`,
          `params.get("url");`,
          `router.post("/webhooks", handler);`,
          `const url = "https://a.example.com/x";`,
          `// fetch("https://commented-out.example.com")`,
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("ignores a URL that merely appears in a string", () => {
    expect(detect(`export const DOCS = "https://docs.example.com/api";`)).toEqual([]);
  });

  it("finds a call nested inside a class method, not only at the top level", () => {
    const dep = only(
      [
        `import axios from "axios";`,
        `export class Orders {`,
        `  async list() {`,
        `    return axios.get("https://a.example.com/orders");`,
        `  }`,
        `}`,
      ].join("\n"),
    );
    expect(dep.line).toBe(4);
  });

  it("parses TSX without tripping on the generic-versus-tag ambiguity", () => {
    const dep = only(
      [
        `import axios from "axios";`,
        `export const View = () => <div onClick={() => axios.get("https://a.example.com/x")} />;`,
      ].join("\n"),
      "src/View.tsx",
    );
    expect(dep).toMatchObject({ file: "src/View.tsx", line: 2, client: "axios" });
  });
});
