---
"@n-dx/sourcevision": patch
---

Detect JS/TS queue, database and cache clients into `outbound.json`.

The third outbound slice completes JS/TS coverage. `analyzers/outbound-detection.ts` now reports SQS and SNS through both AWS SDK generations, Kafka (`kafkajs`) and RabbitMQ (`amqplib`) as `kind: "queue"`; `pg`, `mysql`, `mysql2`, `mongodb` and `mongoose` as `kind: "database"`; and `redis` and `ioredis` as `kind: "cache"`. Same compiler-API path and the same two-field rule as the HTTP slice — a connection string, a queue URL, a topic ARN or the environment variable's name in `targetSource`, and nothing but reach in `confidence`.

Four shapes needed more than a row in the client table, because these libraries do not put the destination where an HTTP client does:

- **AWS SDK v3 states the target on a command object**, not on the client and not as an argument to `send`. A constructed object's options are now read through, so `send(new SendMessageCommand({ QueueUrl }))` reports the queue rather than an unknown target.
- **A connection is often awaited**, and a channel comes from the connection, so `await` is no longer counted as a hop and a factory inherits the target its source was configured with. `amqp.connect(url)` reports the broker, and the channel's `sendToQueue` reports the queue.
- **A broker list is an array**, sometimes built by splitting an environment variable, so both resolve to the one fact a cross-repo matcher can use.
- **`ioredis` exports its constructor as the default**, so the local name carries no information. The spec says the default is constructible once, rather than keying on whatever the importer called it — which also makes an aliased constructor resolve, at `likely`, as the alias rule already required.

The base-fallback rule that made `api.get("/orders")` report the host it was configured with is now explicit rather than universal. A bare path matches no producer and needs the base; a queue name is a whole target, so the broker never displaces it. The fallback still applies to any client whose call names nothing at all.
