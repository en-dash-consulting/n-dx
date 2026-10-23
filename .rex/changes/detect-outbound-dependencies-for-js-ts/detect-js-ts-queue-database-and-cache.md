---
id: "a61c6f61-5069-4c3b-b202-abca08639522"
type: "task"
title: "Detect JS/TS queue, database and cache clients"
slug: "detect-js-ts-queue-database-and-cache"
description: "Third slice: JS/TS queue, database and cache clients, same compiler-API path and the same targetSource and confidence rules as the HTTP slice.\n\nQueues (kind \"queue\"): SQS and SNS from the AWS SDK (v2 and v3 client shapes), Kafka (kafkajs), RabbitMQ (amqplib). Databases (kind \"database\"): pg, mysql and mysql2, mongodb and mongoose. Caches (kind \"cache\"): redis and ioredis. The target is the queue URL or topic ARN, the connection string or host, or the env variable name feeding it, with targetSource set accordingly.\n\nAcceptance criteria:\n- Each client family above has a unit test proving detection with file, line, kind and client.\n- Literal and env targets are each covered for at least one queue, one database and one cache client.\n- A connection string passed through a config object records targetSource \"config\".\n- The confidence rule from the HTTP slice applies unchanged; a test proves an aliased client constructor lowers confidence."
priority: "high"
---
