/**
 * JS/TS outbound call-site detection — the queue, database and cache slice.
 *
 * Same detector, same two-field rule as the HTTP slice: `targetSource` says
 * where the call points, `confidence` says only how directly it was reached.
 * What differs is what counts as a target — a queue URL, a topic ARN, a
 * connection string or a broker host rather than a URL — and that the target is
 * often stated somewhere other than the first argument: on an AWS SDK v3
 * command object, on the client a channel came from, inside a broker array.
 *
 * Every family named in the task gets a case pinning file, line, kind and
 * client, because a detection without a location is not actionable.
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

describe("queue clients", () => {
  it("detects an AWS SDK v2 SQS send, with the queue URL off the request", () => {
    const found = detect(
      [
        `const AWS = require("aws-sdk");`,
        `const sqs = new AWS.SQS({ region: "us-east-1" });`,
        `await sqs.sendMessage({ QueueUrl: "https://sqs.us-east-1.amazonaws.com/1/orders", MessageBody: body });`,
      ].join("\n"),
      "src/queue.ts",
    );

    expect(found).toEqual([
      {
        file: "src/queue.ts",
        line: 2,
        kind: "queue",
        target: "",
        targetSource: "unknown",
        client: "aws-sdk",
        confidence: "certain",
      },
      {
        file: "src/queue.ts",
        line: 3,
        kind: "queue",
        target: "https://sqs.us-east-1.amazonaws.com/1/orders",
        targetSource: "literal",
        client: "aws-sdk",
        confidence: "likely",
      },
    ]);
  });

  it("detects an AWS SDK v2 SNS publish, with the topic ARN off the request", () => {
    const found = detect(
      [
        `import AWS from "aws-sdk";`,
        `const sns = new AWS.SNS({});`,
        `await sns.publish({ TopicArn: process.env.ALERTS_TOPIC_ARN, Message: m });`,
      ].join("\n"),
    );

    expect(found[1]).toMatchObject({
      line: 3,
      kind: "queue",
      client: "aws-sdk",
      target: "ALERTS_TOPIC_ARN",
      targetSource: "env",
    });
  });

  it("detects an AWS SDK v3 SQS send, reading the target off the command object", () => {
    // v3 states the destination on the Command, not on the client and not as an
    // argument to `send`. A detector that only read `send`'s first argument
    // would report every v3 queue call with an unknown target.
    const found = detect(
      [
        `import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";`,
        `const client = new SQSClient({ region: "us-east-1" });`,
        `await client.send(new SendMessageCommand({ QueueUrl: process.env.ORDERS_QUEUE_URL }));`,
      ].join("\n"),
      "src/v3.ts",
    );

    expect(found).toEqual([
      {
        file: "src/v3.ts",
        line: 2,
        kind: "queue",
        target: "",
        targetSource: "unknown",
        client: "@aws-sdk/client-sqs",
        confidence: "certain",
      },
      {
        file: "src/v3.ts",
        line: 3,
        kind: "queue",
        target: "ORDERS_QUEUE_URL",
        targetSource: "env",
        client: "@aws-sdk/client-sqs",
        confidence: "likely",
      },
    ]);
  });

  it("detects an AWS SDK v3 SNS publish", () => {
    const found = detect(
      [
        `import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";`,
        `const sns = new SNSClient({});`,
        `await sns.send(new PublishCommand({ TopicArn: "arn:aws:sns:us-east-1:1:alerts" }));`,
      ].join("\n"),
    );

    expect(found[1]).toMatchObject({
      line: 3,
      kind: "queue",
      client: "@aws-sdk/client-sns",
      target: "arn:aws:sns:us-east-1:1:alerts",
      targetSource: "literal",
    });
  });

  it("detects kafkajs through a producer, keeping the topic over the brokers", () => {
    const found = detect(
      [
        `import { Kafka } from "kafkajs";`,
        `const kafka = new Kafka({ clientId: "orders", brokers: ["kafka-1.internal:9092"] });`,
        `const producer = kafka.producer();`,
        `await producer.send({ topic: "orders.created", messages });`,
      ].join("\n"),
      "src/kafka.ts",
    );

    // The producer is not itself a destination, so it gets no row; the send is
    // reported against the topic it names, not the cluster it came from.
    expect(found).toEqual([
      {
        file: "src/kafka.ts",
        line: 2,
        kind: "queue",
        target: "kafka-1.internal:9092",
        targetSource: "literal",
        client: "kafkajs",
        confidence: "certain",
      },
      {
        file: "src/kafka.ts",
        line: 4,
        kind: "queue",
        target: "orders.created",
        targetSource: "literal",
        client: "kafkajs",
        confidence: "likely",
      },
    ]);
  });

  it("reads a kafka broker list built by splitting an environment variable", () => {
    expect(
      only(
        [
          `import { Kafka } from "kafkajs";`,
          `new Kafka({ brokers: process.env.KAFKA_BROKERS.split(",") });`,
        ].join("\n"),
      ),
    ).toMatchObject({ line: 2, client: "kafkajs", target: "KAFKA_BROKERS", targetSource: "env" });
  });

  it("detects amqplib through a connection and the channel it hands back", () => {
    const found = detect(
      [
        `import amqp from "amqplib";`,
        `const conn = await amqp.connect("amqp://rabbit.internal:5672");`,
        `const channel = await conn.createChannel();`,
        `channel.sendToQueue("orders.created", payload);`,
      ].join("\n"),
      "src/rabbit.ts",
    );

    expect(found).toEqual([
      {
        file: "src/rabbit.ts",
        line: 2,
        kind: "queue",
        target: "amqp://rabbit.internal:5672",
        targetSource: "literal",
        client: "amqplib",
        confidence: "certain",
      },
      {
        file: "src/rabbit.ts",
        line: 4,
        kind: "queue",
        target: "orders.created",
        targetSource: "literal",
        client: "amqplib",
        confidence: "likely",
      },
    ]);
  });
});

describe("database clients", () => {
  it("detects a pg pool with its connection string", () => {
    expect(
      only(
        [
          `import { Pool } from "pg";`,
          `export const pool = new Pool({ connectionString: process.env.DATABASE_URL });`,
        ].join("\n"),
        "src/db.ts",
      ),
    ).toEqual({
      file: "src/db.ts",
      line: 2,
      kind: "database",
      target: "DATABASE_URL",
      targetSource: "env",
      client: "pg",
      confidence: "certain",
    });
  });

  it("detects a pg client constructed off the module object", () => {
    expect(
      only(
        [`import pg from "pg";`, `const client = new pg.Client({ host: "db.internal" });`].join("\n"),
      ),
    ).toMatchObject({ line: 2, kind: "database", client: "pg", target: "db.internal" });
  });

  it("detects mysql", () => {
    expect(
      only(
        [
          `const mysql = require("mysql");`,
          `const connection = mysql.createConnection({ host: "db.internal", user: "app" });`,
        ].join("\n"),
      ),
    ).toMatchObject({
      line: 2,
      kind: "database",
      client: "mysql",
      target: "db.internal",
      targetSource: "literal",
      confidence: "certain",
    });
  });

  it("detects mysql2, including its promise entry point", () => {
    expect(
      only(
        [`import mysql from "mysql2/promise";`, `const pool = mysql.createPool(process.env.MYSQL_URL);`].join("\n"),
      ),
    ).toMatchObject({ line: 2, kind: "database", client: "mysql2", target: "MYSQL_URL", targetSource: "env" });
  });

  it("detects a mongodb client with its URI", () => {
    expect(
      only(
        [
          `import { MongoClient } from "mongodb";`,
          `const client = new MongoClient("mongodb://mongo.internal:27017/orders");`,
        ].join("\n"),
        "src/mongo.ts",
      ),
    ).toEqual({
      file: "src/mongo.ts",
      line: 2,
      kind: "database",
      target: "mongodb://mongo.internal:27017/orders",
      targetSource: "literal",
      client: "mongodb",
      confidence: "certain",
    });
  });

  it("detects mongoose connecting", () => {
    expect(
      only([`import mongoose from "mongoose";`, `await mongoose.connect(process.env.MONGO_URL);`].join("\n")),
    ).toMatchObject({
      line: 2,
      kind: "database",
      client: "mongoose",
      target: "MONGO_URL",
      targetSource: "env",
      confidence: "certain",
    });
  });
});

describe("cache clients", () => {
  it("detects node-redis built through createClient", () => {
    expect(
      only(
        [`import { createClient } from "redis";`, `const client = createClient({ url: process.env.REDIS_URL });`].join("\n"),
        "src/cache.ts",
      ),
    ).toEqual({
      file: "src/cache.ts",
      line: 2,
      kind: "cache",
      target: "REDIS_URL",
      targetSource: "env",
      client: "redis",
      confidence: "certain",
    });
  });

  it("detects ioredis however the default export is named locally", () => {
    // The constructor is the module's default export, so the local name carries
    // no information — a detector keyed on it would miss every importer who
    // chose something other than `Redis`.
    expect(
      only([`import IORedis from "ioredis";`, `const cache = new IORedis("redis://cache.internal:6379");`].join("\n")),
    ).toMatchObject({
      line: 2,
      kind: "cache",
      client: "ioredis",
      target: "redis://cache.internal:6379",
      targetSource: "literal",
      confidence: "certain",
    });
  });

  it("detects an ioredis client configured by host", () => {
    expect(
      only([`import Redis from "ioredis";`, `new Redis({ host: process.env.REDIS_HOST, port: 6379 });`].join("\n")),
    ).toMatchObject({ line: 2, client: "ioredis", target: "REDIS_HOST", targetSource: "env" });
  });
});

describe("targetSource across the three kinds", () => {
  it("records a connection string reached through a config object as config", () => {
    expect(
      only(
        [
          `import { Pool } from "pg";`,
          `export const pool = new Pool({ connectionString: config.database.primary });`,
        ].join("\n"),
      ),
    ).toMatchObject({
      kind: "database",
      target: "config.database.primary",
      targetSource: "config",
    });
  });

  it("grades a literal target and an env target identically, per kind", () => {
    // The property that keeps the two fields from encoding one fact twice.
    const pairs: Array<[string, string, OutboundDependency["kind"]]> = [
      [
        `import amqp from "amqplib";\namqp.connect("amqp://rabbit.internal:5672");`,
        `import amqp from "amqplib";\namqp.connect(process.env.RABBIT_URL);`,
        "queue",
      ],
      [
        `import { Pool } from "pg";\nnew Pool({ connectionString: "postgres://db/orders" });`,
        `import { Pool } from "pg";\nnew Pool({ connectionString: process.env.DATABASE_URL });`,
        "database",
      ],
      [
        `import Redis from "ioredis";\nnew Redis("redis://cache.internal:6379");`,
        `import Redis from "ioredis";\nnew Redis(process.env.REDIS_URL);`,
        "cache",
      ],
    ];

    for (const [literalSrc, envSrc, kind] of pairs) {
      const literal = only(literalSrc);
      const env = only(envSrc);
      expect([literal.kind, env.kind]).toEqual([kind, kind]);
      expect(literal.confidence).toBe(env.confidence);
      expect(literal.confidence).toBe("certain");
      expect([literal.targetSource, env.targetSource]).toEqual(["literal", "env"]);
    }
  });

  it("records an unresolvable connection target as unknown with an empty target", () => {
    expect(
      only([`import Redis from "ioredis";`, `new Redis(buildRedisUrl(region));`].join("\n")),
    ).toMatchObject({ target: "", targetSource: "unknown" });
  });
});

describe("confidence describes the call, not the target", () => {
  it("lowers an aliased client constructor below a direct one", () => {
    const direct = only(
      [`import Redis from "ioredis";`, `const cache = new Redis(process.env.REDIS_URL);`].join("\n"),
    );
    const aliased = only(
      [
        `import Redis from "ioredis";`,
        `const Cache = Redis;`,
        `const cache = new Cache(process.env.REDIS_URL);`,
      ].join("\n"),
    );

    expect(direct.confidence).toBe("certain");
    expect(aliased.confidence).toBe("likely");
    expect(aliased.line).toBe(3);
    // Only the confidence moved: the alias says nothing about where it points.
    expect(aliased.target).toBe(direct.target);
    expect(aliased.targetSource).toBe(direct.targetSource);
  });

  it("lowers a dynamic member access on a database client to inferred", () => {
    expect(
      only(
        [
          `import mongoose from "mongoose";`,
          `export const open = (how) => mongoose[how](process.env.MONGO_URL);`,
        ].join("\n"),
      ),
    ).toMatchObject({ line: 2, client: "mongoose", confidence: "inferred" });
  });
});

describe("structural detection, not text matching", () => {
  it("ignores queue- and cache-shaped methods on objects that are not clients", () => {
    // Every line here would match a regex hunting for `sendMessage(`, `.send(`,
    // `connect(` or `createClient(`. None reaches a client library, so the AST
    // walk never considers them.
    expect(
      detect(
        [
          `const bus = new EventEmitter();`,
          `bus.send({ QueueUrl: "https://sqs.example.com/1/orders" });`,
          `const cache = new Map();`,
          `cache.get("redis://not-a-connection.example.com");`,
          `socket.connect("amqp://not-rabbit.example.com");`,
          `const client = createClient({ url: "redis://unimported.example.com" });`,
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("falls back to the broker only when the send names no destination", () => {
    // axios resolves `/orders` against the baseURL it was built with, because a
    // bare path matches no producer. A queue name is a whole target, so the
    // broker must not displace it — the two rules share a code path, and this
    // pins both halves: the named topic wins, the unreadable one inherits.
    const found = detect(
      [
        `import { Kafka } from "kafkajs";`,
        `const kafka = new Kafka({ brokers: ["kafka-1.internal:9092"] });`,
        `const producer = kafka.producer();`,
        `await producer.send({ topic: "orders.created" });`,
        `await producer.send(buildPayload());`,
      ].join("\n"),
    );

    expect(found.map((d) => [d.line, d.target])).toEqual([
      [2, "kafka-1.internal:9092"],
      [4, "orders.created"],
      [5, "kafka-1.internal:9092"],
    ]);
  });
});
