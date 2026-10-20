---
"@n-dx/lang-java": patch
---

Spring Boot rules pair their captures in one sweep instead of scanning every owner per capture, so a Java file with thousands of calls no longer costs time quadratic in its size. Routes and outbound calls are unchanged.
