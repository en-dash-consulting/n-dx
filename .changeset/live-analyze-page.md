---
"@n-dx/web": patch
"@n-dx/sourcevision": patch
---

Add the analysis page at `/live/analyze`: the six phases with what each does, its result once done and its time against the previous run of the same mode; enrichment passes 0 to 4 under Zones with the current batch and judgment-cache reuse; the stdout tail with follow (dashboard-started runs); model calls by task class and cost so far; the `.sourcevision/` files written; notes and recent analyses. Terminal- and dashboard-started analyses update within two seconds. `GET /api/live/analyze` serves the page, and `POST /api/live/analyze/stop` stops a terminal-started analysis by its recorded pid. `sv analyze` now records its command and the last error line in `analyze-progress.json`, and on SIGTERM or SIGINT marks the open phase as an error in the manifest, records the run as failed and exits 128 + the signal, so a stopped analysis names the phase it stopped in.
