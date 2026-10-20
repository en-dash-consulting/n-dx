import { describe, expect, it } from "vitest";
import { IAC_KINDS } from "../../src/index.js";

describe("IAC_KINDS", () => {
  it("holds the nine kinds, in order, with their exact patterns and flags", () => {
    expect(IAC_KINDS.map(([pattern, kind]) => [pattern.source, pattern.flags, kind])).toEqual([
      ["bucket|blob_container|storage_account", "", "bucket"],
      ["sqs|_queue|servicebus_queue|pubsub_subscription", "", "queue"],
      ["sns|pubsub_topic|eventgrid|event_bus|eventbridge", "", "topic"],
      ["dynamodb|rds|_sql|spanner|firestore|bigtable|cosmosdb|documentdb|database", "", "database"],
      ["elasticache|redis|memcache", "", "cache"],
      ["kinesis|kafka|msk|firehose", "", "stream"],
      ["cloudwatch_event_rule|events_rule|scheduler|cron|eventbridge_rule", "", "scheduler"],
      ["secret|kms|vault|parameter", "", "secrets"],
      ["lambda_function|serverless_function|cloud_run|cloudfunctions|container_app", "", "compute"],
    ]);
  });
});
