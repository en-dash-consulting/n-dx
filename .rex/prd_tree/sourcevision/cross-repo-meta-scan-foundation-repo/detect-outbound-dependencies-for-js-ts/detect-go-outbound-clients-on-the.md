---
id: "6a3f7a2d-3f57-4449-81df-c01d4e7bf585"
level: "subtask"
title: "Detect Go outbound clients on the existing Go parser"
status: "in_progress"
priority: "high"
startedAt: "2026-10-08T16:28:53.683Z"
description: "Fourth slice: Go outbound clients on the existing Go parsing used by go-route-detection.ts, producing the same OutboundDependency records.\n\nDetect net/http client calls (http.Get, http.Post, client.Do with a request) as kind \"http\"; grpc.Dial and generated client calls as \"grpc\"; aws-sdk SQS/SNS clients as \"queue\" along with sarama (Kafka); go-redis as \"cache\"; database/sql Open as \"database\". A string literal target records targetSource \"literal\"; a target through os.Getenv(\"X\") records \"env\" with X; a struct field or viper/config read records \"config\"; else \"unknown\". confidence follows the same call-not-target rule as the JS/TS slices.\n\nAcceptance criteria:\n- Each of net/http, grpc, aws-sdk, sarama, go-redis and database/sql has a unit test proving detection with file and line.\n- Literal and os.Getenv targets are each covered for at least two families.\n- The Go detector reuses the existing Go parsing; no second Go parser is introduced.\n- Mixed JS/TS and Go repositories produce one canonically sorted outbound.json containing both languages, in a test."
lastModified: "2026-10-08T16:28:54.204Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
