---
"@n-dx/web": patch
---

Dashboard routes that spawn from repository content (command triggers, run commands, hench execute and prep, rex analysis, the LLM probes) answer 403 with `hint: "ndx trust accept ."` while the repository's execution config is not accepted, and CLIs are always resolved from the server's own install. Side-effect GETs refuse foreign-site requests and `/api/commands/auth` is now a POST. Every response carries `nosniff`, `X-Frame-Options: DENY` and a Content-Security-Policy; `/data/*` serves only the known data files, confined to `.sourcevision/`. The hub spawns project servers from its own binary and forwards an untrusted `Origin` unchanged.
