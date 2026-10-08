/**
 * Go outbound call-site detection — the fourth and last slice.
 *
 * Same record and same two-field rule as the JS/TS slices: `targetSource` says
 * where the call points, `confidence` says only how directly the call itself
 * was reached. Every family the task names gets a case pinning file, line, kind
 * and client, because a detection without a location is not actionable, and
 * literal and `os.Getenv` targets are each covered for more than one family so
 * the two paths cannot quietly diverge.
 *
 * @see src/analyzers/go-outbound-detection.ts
 */
import { describe, it, expect } from "vitest";

import { detectGoOutboundCalls } from "../../../src/analyzers/go-outbound-detection.js";
import type { OutboundDependency } from "../../../src/schema/index.js";

/** Detections for one Go source body, as `internal/client.go`. */
function detect(source: string, file = "internal/client.go"): OutboundDependency[] {
  return detectGoOutboundCalls(source, file);
}

/** The one detection a source is expected to produce. */
function only(source: string, file?: string): OutboundDependency {
  const found = detect(source, file);
  expect(found).toHaveLength(1);
  return found[0];
}

/** A Go file with the given imports and a body inside `func main()`. */
function goFile(imports: string[], body: string[]): string {
  return [
    "package main",
    "",
    "import (",
    ...imports.map((i) => `\t${i}`),
    ")",
    "",
    "func main() {",
    ...body.map((b) => `\t${b}`),
    "}",
  ].join("\n");
}

describe("net/http", () => {
  it("detects http.Get with a literal URL, at its line", () => {
    const found = only(
      goFile([`"net/http"`], [`resp, err := http.Get("https://orders.internal/api/v1")`]),
    );

    expect(found).toEqual({
      file: "internal/client.go",
      line: 8,
      kind: "http",
      target: "https://orders.internal/api/v1",
      targetSource: "literal",
      client: "net/http",
      confidence: "certain",
    });
  });

  it("detects http.Post pointed at os.Getenv, recording the variable name", () => {
    const found = only(goFile([`"net/http"`, `"os"`], [
      `http.Post(os.Getenv("BILLING_URL"), "application/json", body)`,
    ]));

    expect(found).toMatchObject({
      kind: "http",
      target: "BILLING_URL",
      targetSource: "env",
      client: "net/http",
      confidence: "certain",
    });
  });

  it("carries a request's URL to the client.Do that issues it", () => {
    const found = detect(goFile([`"net/http"`], [
      `client := &http.Client{Timeout: 5 * time.Second}`,
      `req, _ := http.NewRequest("GET", "https://inventory.internal/stock", nil)`,
      `resp, err := client.Do(req)`,
    ]));

    expect(found).toEqual([
      {
        file: "internal/client.go",
        line: 9,
        kind: "http",
        target: "https://inventory.internal/stock",
        targetSource: "literal",
        client: "net/http",
        confidence: "certain",
      },
      {
        file: "internal/client.go",
        line: 10,
        kind: "http",
        target: "https://inventory.internal/stock",
        targetSource: "literal",
        client: "net/http",
        confidence: "likely",
      },
    ]);
  });

  it("reads the URL out of http.NewRequestWithContext's third argument", () => {
    const found = only(goFile([`"net/http"`], [
      `req, _ := http.NewRequestWithContext(ctx, "POST", "https://pay.internal/charge", body)`,
    ]));

    expect(found).toMatchObject({
      line: 8,
      target: "https://pay.internal/charge",
      targetSource: "literal",
      confidence: "certain",
    });
  });
});

describe("grpc", () => {
  it("detects grpc.Dial with a literal address", () => {
    const found = only(goFile([`"google.golang.org/grpc"`], [
      `conn, err := grpc.Dial("orders.svc.cluster.local:50051", grpc.WithInsecure())`,
    ]));

    expect(found).toEqual({
      file: "internal/client.go",
      line: 8,
      kind: "grpc",
      target: "orders.svc.cluster.local:50051",
      targetSource: "literal",
      client: "grpc",
      confidence: "certain",
    });
  });

  it("detects grpc.DialContext with an os.Getenv address", () => {
    const found = only(goFile([`"google.golang.org/grpc"`, `"os"`], [
      `conn, err := grpc.DialContext(ctx, os.Getenv("ORDERS_GRPC_ADDR"))`,
    ]));

    expect(found).toMatchObject({
      kind: "grpc",
      target: "ORDERS_GRPC_ADDR",
      targetSource: "env",
      confidence: "certain",
    });
  });

  it("grades a generated stub as likely and gives it the connection's address", () => {
    const found = detect(goFile(
      [`"google.golang.org/grpc"`, `pb "example.com/gen/orders"`],
      [
        `conn, err := grpc.Dial("orders.svc:50051", grpc.WithInsecure())`,
        `client := pb.NewOrderServiceClient(conn)`,
      ],
    ));

    expect(found).toEqual([
      {
        file: "internal/client.go",
        line: 9,
        kind: "grpc",
        target: "orders.svc:50051",
        targetSource: "literal",
        client: "grpc",
        confidence: "certain",
      },
      {
        file: "internal/client.go",
        line: 10,
        kind: "grpc",
        target: "orders.svc:50051",
        targetSource: "literal",
        client: "grpc",
        confidence: "likely",
      },
    ]);
  });
});

describe("aws-sdk", () => {
  it("detects an SQS send with the queue URL off the request struct", () => {
    const found = only(goFile(
      [`"github.com/aws/aws-sdk-go/service/sqs"`, `"github.com/aws/aws-sdk-go/aws"`],
      [
        `svc := sqs.New(sess)`,
        `out, err := svc.SendMessage(&sqs.SendMessageInput{`,
        `\tQueueUrl:    aws.String("https://sqs.us-east-1.amazonaws.com/1/orders"),`,
        `\tMessageBody: aws.String(body),`,
        `})`,
      ],
    ));

    expect(found).toEqual({
      file: "internal/client.go",
      line: 10,
      kind: "queue",
      target: "https://sqs.us-east-1.amazonaws.com/1/orders",
      targetSource: "literal",
      client: "aws-sdk",
      confidence: "likely",
    });
  });

  it("detects an SNS publish with the topic ARN from os.Getenv", () => {
    const found = only(goFile(
      [`"github.com/aws/aws-sdk-go-v2/service/sns"`, `"os"`],
      [
        `client := sns.NewFromConfig(cfg)`,
        `_, err := client.Publish(ctx, &sns.PublishInput{`,
        `\tTopicArn: aws.String(os.Getenv("EVENTS_TOPIC_ARN")),`,
        `})`,
      ],
    ));

    expect(found).toMatchObject({
      line: 10,
      kind: "queue",
      target: "EVENTS_TOPIC_ARN",
      targetSource: "env",
      client: "aws-sdk",
      confidence: "likely",
    });
  });

  it("grades an SQS send on an unbound receiver as inferred", () => {
    // `s.queue` is a struct field this file never assigns. The sqs import plus
    // the method name is the whole case for calling it an outbound send.
    const found = only(goFile([`"github.com/aws/aws-sdk-go/service/sqs"`], [
      `queue.SendMessage(&sqs.SendMessageInput{QueueUrl: aws.String("https://sqs/q")})`,
    ]));

    expect(found).toMatchObject({
      kind: "queue",
      target: "https://sqs/q",
      targetSource: "literal",
      client: "aws-sdk",
      confidence: "inferred",
    });
  });
});

describe("sarama", () => {
  it("detects a sync producer against a literal broker list", () => {
    const found = only(goFile([`"github.com/Shopify/sarama"`], [
      `producer, err := sarama.NewSyncProducer([]string{"kafka-1:9092", "kafka-2:9092"}, config)`,
    ]));

    expect(found).toEqual({
      file: "internal/client.go",
      line: 8,
      kind: "queue",
      target: "kafka-1:9092",
      targetSource: "literal",
      client: "sarama",
      confidence: "certain",
    });
  });

  it("follows brokers through strings.Split on os.Getenv", () => {
    const found = only(goFile(
      [`"github.com/IBM/sarama"`, `"os"`, `"strings"`],
      [`c, err := sarama.NewConsumerGroup(strings.Split(os.Getenv("KAFKA_BROKERS"), ","), "g", cfg)`],
    ));

    expect(found).toMatchObject({
      kind: "queue",
      target: "KAFKA_BROKERS",
      targetSource: "env",
      client: "sarama",
      confidence: "certain",
    });
  });
});

describe("go-redis", () => {
  it("detects NewClient with the Addr option", () => {
    const found = only(goFile([`"github.com/go-redis/redis/v8"`], [
      `rdb := redis.NewClient(&redis.Options{Addr: "cache.internal:6379", DB: 0})`,
    ]));

    expect(found).toEqual({
      file: "internal/client.go",
      line: 8,
      kind: "cache",
      target: "cache.internal:6379",
      targetSource: "literal",
      client: "go-redis",
      confidence: "certain",
    });
  });

  it("resolves the moved module path and an Addr from os.Getenv", () => {
    // `github.com/redis/go-redis/v9` binds the package as `redis`, not
    // `go-redis` — the module was renamed, the package was not.
    const found = only(goFile([`"github.com/redis/go-redis/v9"`, `"os"`], [
      `rdb := redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_ADDR")})`,
    ]));

    expect(found).toMatchObject({
      kind: "cache",
      target: "REDIS_ADDR",
      targetSource: "env",
      client: "go-redis",
      confidence: "certain",
    });
  });
});

describe("database/sql", () => {
  it("detects sql.Open and reads the DSN, not the driver name", () => {
    const found = only(goFile([`"database/sql"`], [
      `db, err := sql.Open("postgres", "postgres://user@db.internal:5432/orders")`,
    ]));

    expect(found).toEqual({
      file: "internal/client.go",
      line: 8,
      kind: "database",
      target: "postgres://user@db.internal:5432/orders",
      targetSource: "literal",
      client: "database/sql",
      confidence: "certain",
    });
  });

  it("leaves the target unknown rather than reporting the driver name", () => {
    // Found by probing the detector against this repository's Go fixtures: with
    // `dsn` a function parameter, scanning the other arguments for a literal
    // reported `"postgres"` — the driver — as the address of the database.
    const found = only(goFile([`"database/sql"`], [`return sql.Open("postgres", dsn)`]));

    expect(found).toMatchObject({
      kind: "database",
      target: "",
      targetSource: "unknown",
      client: "database/sql",
      confidence: "certain",
    });
  });

  it("records a DSN read from os.Getenv as env", () => {
    const found = only(goFile([`"database/sql"`, `"os"`], [
      `db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))`,
    ]));

    expect(found).toMatchObject({
      kind: "database",
      target: "DATABASE_URL",
      targetSource: "env",
      client: "database/sql",
      confidence: "certain",
    });
  });
});

describe("target sources", () => {
  it("records a struct field read as config, naming the path", () => {
    const found = only(goFile([`"database/sql"`], [
      `db, err := sql.Open("postgres", cfg.Database.DSN)`,
    ]));

    expect(found).toMatchObject({ target: "cfg.Database.DSN", targetSource: "config" });
  });

  it("records a viper read as config, naming the key", () => {
    const found = only(goFile([`"github.com/go-redis/redis/v8"`], [
      `rdb := redis.NewClient(&redis.Options{Addr: viper.GetString("redis.addr")})`,
    ]));

    expect(found).toMatchObject({ target: "redis.addr", targetSource: "config" });
  });

  it("resolves a target declared once as a file-local constant", () => {
    const source = [
      "package main",
      "",
      `import "net/http"`,
      "",
      `const ordersURL = "https://orders.internal/v1"`,
      "",
      "func main() {",
      "\thttp.Get(ordersURL)",
      "}",
    ].join("\n");

    expect(only(source)).toMatchObject({
      line: 8,
      target: "https://orders.internal/v1",
      targetSource: "literal",
    });
  });

  it("leaves a target it cannot account for unknown rather than guessing", () => {
    const found = only(goFile([`"net/http"`], [`http.Get(buildURL(ctx, id))`]));
    expect(found).toMatchObject({ target: "", targetSource: "unknown", confidence: "certain" });
  });
});

describe("confidence is about the call, not the target", () => {
  it("grades a literal target and an env target on the same call identically", () => {
    const literal = only(goFile([`"net/http"`], [`http.Get("https://orders.internal/v1")`]));
    const env = only(goFile([`"net/http"`, `"os"`], [`http.Get(os.Getenv("ORDERS_URL"))`]));

    expect(literal.confidence).toBe("certain");
    expect(env.confidence).toBe("certain");
    expect(literal.targetSource).toBe("literal");
    expect(env.targetSource).toBe("env");
  });

  it("keeps an aliased import certain — a rename is not indirection", () => {
    const found = only(goFile([`nethttp "net/http"`], [
      `nethttp.Get("https://orders.internal/v1")`,
    ]));
    expect(found.confidence).toBe("certain");
  });
});

describe("what is not reported", () => {
  it("reports nothing from a file importing no client package", () => {
    expect(detect(goFile([`"fmt"`], [`fmt.Println(client.Do(req))`]))).toEqual([]);
  });

  it("ignores a call inside a comment", () => {
    const found = detect(goFile([`"net/http"`], [
      `// http.Get("https://commented-out.example.com")`,
      `http.Get("https://real.internal/v1")`,
    ]));

    expect(found).toHaveLength(1);
    expect(found[0].target).toBe("https://real.internal/v1");
  });

  it("keeps line numbers correct after a multi-line block comment", () => {
    const source = [
      "package main",
      "",
      `import "net/http"`,
      "",
      "/*",
      " a block comment",
      " spanning three lines",
      "*/",
      "func main() {",
      `\thttp.Get("https://orders.internal/v1")`,
      "}",
    ].join("\n");

    expect(only(source).line).toBe(10);
  });

  it("does not report a vocabulary method shared by two imported families", () => {
    // `Get` belongs to both net/http and go-redis. On an unbound receiver there
    // is nothing to choose between them, so nothing is claimed.
    const found = detect(goFile(
      [`"net/http"`, `"github.com/go-redis/redis/v8"`],
      [`val, err := store.Get(ctx, "session:1")`],
    ));
    expect(found).toEqual([]);
  });

  it("does not read a server-side header as an outbound call", () => {
    // Found by probing the detector against this repository's Go fixtures: the
    // inference tier fired on `Get` in a file importing only net/http, turning
    // a middleware's header read into an HTTP dependency. `Get` is a method
    // name on everything, so net/http declares nothing inferable.
    const source = [
      "package middleware",
      "",
      `import "net/http"`,
      "",
      "func Auth(next http.Handler) http.Handler {",
      "\treturn http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {",
      `\t\ttoken := r.Header.Get("Authorization")`,
      "\t\t_ = token",
      "\t})",
      "}",
    ].join("\n");

    expect(detect(source)).toEqual([]);
  });

  it("still reports a bound client's Get, which the import cannot be wrong about", () => {
    // The flip side of the rule above: once the file binds the receiver to an
    // http.Client there is no ambiguity left, so the detection stands.
    const found = only(goFile([`"net/http"`], [
      `client := &http.Client{}`,
      `resp, err := client.Get("https://orders.internal/v1")`,
    ]));

    expect(found).toMatchObject({
      line: 9,
      kind: "http",
      target: "https://orders.internal/v1",
      targetSource: "literal",
      confidence: "likely",
    });
  });
});
