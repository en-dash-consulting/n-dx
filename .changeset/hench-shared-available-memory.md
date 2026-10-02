---
"@n-dx/hench": patch
---

hench's memory throttle and pre-spawn check now read available memory through the shared llm-client reading, so they agree with the dashboard and hub. On macOS the throttle no longer reads `os.freemem()`, which counted only free pages and rejected runs on a healthy Mac. An unknown reading never delays, rejects or blocks a spawn; run memory stats record it as -1 and the end-of-run line says "available memory unknown".
