---
id: "a7025860-7f9b-4d87-bd36-5a8524670679"
level: "subtask"
title: "Detect JS/TS HTTP and gRPC clients through the TypeScript compiler API"
status: "in_progress"
priority: "high"
startedAt: "2026-10-08T16:02:59.490Z"
description: "Second slice: JS/TS HTTP and gRPC clients through the TypeScript compiler API, inside analyzers/outbound-detection.ts from the first slice.\n\nDetect calls to fetch, axios, got, undici, ky and node-fetch (kind \"http\") and gRPC client construction and calls (kind \"grpc\"), recording file, line, client name, target and targetSource. A URL literal records targetSource \"literal\" with the URL as target; a target reaching the call through process.env.X records targetSource \"env\" with X as target; a target read from a config object or module records \"config\"; anything else \"unknown\".\n\nconfidence describes the call, not the target: a direct client call is \"certain\" whether its target is a literal or an env name; a call reached through an alias, a wrapper function, or a dynamic member access lowers it to \"likely\" or \"inferred\". The two fields must never encode the same fact twice.\n\nAcceptance criteria:\n- Each of fetch, axios, got, undici, ky, node-fetch and a gRPC client has a unit test under tests/unit/analyzers/ proving detection with file and line.\n- Literal and env targets are each covered by a test for at least two client families.\n- A test pins a literal-target call and an env-target call at the same confidence.\n- An aliased or wrapped call is detected at a lower confidence than a direct call, in a test.\n- Detection uses the TypeScript compiler API, not regular expressions over source text."
lastModified: "2026-10-08T16:02:59.987Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
