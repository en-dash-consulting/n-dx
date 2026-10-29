---
id: "bcedb846-0028-43f6-95d3-7e2376bf06cc"
type: "change"
title: "Complete the experimental extension contract and stack review fixes"
slug: "complete-the-experimental-extension"
intent: "Resolve review findings from PRs #881–#889: declare the experimental extension contract, authenticate and revoke sidecars, handle hub death, repair discovery/config and validation coverage, and align authoring guidance and release notes."
acceptanceCriteria:
  - "The extension contract has standing product requirements and accurately describes the experimental surface."
  - "Sidecar authentication, approval revocation, process lifetime and config/discovery regressions are covered by tests."
  - "The nine-PR extension stack builds and passes its affected checks."
amends: [{"target":"4ca9aac4-cd85-4af3-96d9-c4274e2d9f83","delta":"modified","summary":"Complete the experimental extension contract and stack review fixes","criteria":{"add":[{"id":"extensions-manifest","text":"Separately installed packages declare commands, sidecars, links and config through an experimental versioned ndx.extension manifest; n-dx never imports extension code."},{"id":"extensions-approval","text":"Extensions run only after approval bound to the installed copy, version and manifest; revocation stops running sidecars and closes their connections."},{"id":"extensions-dispatch","text":"Built-ins take precedence and approved extension commands receive the documented environment, arguments, terminal signals and exit handling."},{"id":"extensions-sidecar","text":"The hub mounts enabled sidecars under /x/<name>/ with per-launch authentication, stripped hub credentials, approval revalidation and parent-lifetime shutdown."}]},"base":"678aaba7115dbf710f1a02f92432a547314e285d62780199d232a063a64fd5cd"},{"target":"1fadb108-b5a8-405c-8699-bdba069663fc","delta":"modified","summary":"Complete the experimental extension contract and stack review fixes","criteria":{"replace":[{"id":"c34","text":"When the graview-face extension is enabled, ndx graview serve . opens the product app on the fresh project projection; otherwise it runs the bare Graview store. The retired graview.app setting only warns."}]},"base":"d289a23f3b316760e2e3ec1c4372db3b9466a09dc36c2a8d862223a50463d748"}]
source: "pr-review"
---
