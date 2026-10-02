---
"@n-dx/hench": patch
---

Record a structured progress event stream for every run, not only verbose ones.

Every run now appends typed progress events as JSON Lines to `.hench/runs/<runId>.events.jsonl` as they happen, and records the path on the new additive `RunRecord.eventsPath`. A reader can tail the file while the run is in progress; each line parses as one event on its own, which a single JSON array would not allow until the run was over.

The vocabulary is small and closed — brief loaded, files read (batched per turn), file edited, tests run, retry, gate, review started, review report, run finished — with a plain-language `summary` plus optional `turn`, `detail` and named `counts`, so the viewer renders a run without parsing log text.

This is distinct from both existing surfaces. `logPath` is the run's terminal output, which a viewer would have to parse back into facts. `RunRecord.events` is the raw `RuntimeEvent` stream, kept only in verbose mode and only written when the run ends. Neither suits a live view.

No LLM calls are added and no turn latency: every summary is formatted from values the caller already holds, the events reuse the tool-call and turn hooks both agent loops already run, and writes are handed to Node's stream buffer rather than awaited. Verbose output is unchanged. Records without `eventsPath` load normally.

Retention now removes a run's event stream along with the run file. `listRunFiles` matches only `.json`/`.json.gz`, so without this the sidecar would have outlived the record it describes indefinitely.
