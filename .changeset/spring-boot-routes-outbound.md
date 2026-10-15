---
"@n-dx/lang-kit": patch
"@n-dx/lang-runtime": patch
"@n-dx/lang-java": patch
"@n-dx/sourcevision": patch
---

The Java pack reads Spring Boot request routes and outbound calls (RestTemplate, WebClient, RestClient, Feign, `java.net.http`, Kafka, JMS, Rabbit, gRPC channels and `System.getenv`). With the pack installed, sourcevision records them in `components.json` server routes and `outbound.json`, reading them in the same parse as Java imports. lang-kit's outbound-call fact gains an optional `confidence`, and lang-runtime's framework-pack slot is implemented.
