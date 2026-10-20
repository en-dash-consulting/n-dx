/**
 * Resource type → coarse kind, for every IaC dialect.
 *
 * Matched as substrings against the resource type so this stays useful across
 * AWS, GCP and Azure without enumerating every provider's naming.
 *
 * One table, not one per parser: the patterns are written in Terraform's
 * underscore form and `classifyResource` normalizes the other dialects into it
 * (`AWS::SQS::Queue` → `aws_sqs_queue`). Two tables would disagree within a
 * release — which is how the skill script and the package came to disagree
 * about zone colours.
 *
 * Order matters (first match wins) and the table is readonly so no caller can
 * reorder or mutate it.
 */
export const IAC_KINDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/bucket|blob_container|storage_account/, "bucket"],
  [/sqs|_queue|servicebus_queue|pubsub_subscription/, "queue"],
  [/sns|pubsub_topic|eventgrid|event_bus|eventbridge/, "topic"],
  [/dynamodb|rds|_sql|spanner|firestore|bigtable|cosmosdb|documentdb|database/, "database"],
  [/elasticache|redis|memcache/, "cache"],
  [/kinesis|kafka|msk|firehose/, "stream"],
  [/cloudwatch_event_rule|events_rule|scheduler|cron|eventbridge_rule/, "scheduler"],
  [/secret|kms|vault|parameter/, "secrets"],
  [
    /lambda_function|serverless_function|cloud_run|cloudfunctions|container_app/,
    "compute",
  ],
];
