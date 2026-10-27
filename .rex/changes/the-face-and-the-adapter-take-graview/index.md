---
id: "ddac7e70-2cec-46ae-91af-467e376f972e"
type: "change"
title: "The face and the adapter take Graview 0.1.22 and drop the workarounds it answers"
slug: "the-face-and-the-adapter-take-graview"
intent: "Graview 0.1.22 shipped every ask the n-dx run filed (block keys, resolveFor, document facts, field roles, a bar that folds empty kinds and keeps its places out, a JSON Schema and types from the document, graview preview/shots/doctor, a sync conflict policy, readonly resources, an MCP remote and door, a seat, and a snapshot format that says what it holds). Pin every @graview/* package and graview to 0.1.22 together and delete the workarounds in @n-dx/graview-face and @n-dx/graview that stood in for them."
acceptanceCriteria:
  - "Every @graview/* dependency, graview and GRAVIEW_VERSION name 0.1.22, and `graview doctor` passes in packages/graview-face"
  - "The sync engine is imported from @graview/core/sync with conflicts: \"theirs\", a version field on each synced resource and readonly resources with a because sentence; the hand pre-empt, seedLinks and the hand refusal table are gone and the engine guards the store"
  - "The dev door is mcpDoor over mcpClient and the page reaches it with doorClient; the remote is mcpRemote; the hand-written session, allowlist and same-origin code are gone"
  - "The store's acts are attributed to rememberedPrincipal()"
  - "The adapter writes the snapshot in Graview's line format (format 2) with generatedAt, held to @graview/core/snapshot's writer by a test, and the face reads it with fetchSnapshot, pulling only the synced kinds"
  - "The declaration names $schema, declares fieldRoles on run and commit, a document-level computed fact for the proposed map, a key on every titled block the face claims, per-kind wording on under, and sorts the change page's tasks by choices"
  - "The face resolves declared blocks with resolveFor and claims them by key; the ten as-never casts and the SWEEP budget are gone"
  - "The shell keeps the bar without its places (without: [\"undo\", \"places\"])"
  - "Types are generated from the document with graview types and the read models read through typedReader; the loose Node type and typeof field reads are gone from the models"
  - "shots.mjs, the fixture-drift test, the version-pin test and tests/fixtures/document.json are deleted; tests compile the declaration from its path with compileDocumentFiles; shots run through graview shots"
  - "UPSTREAM.md keeps only the workarounds still needed, and the docs and changeset say what changed"
touches:
  - "1fadb108-b5a8-405c-8699-bdba069663fc"
priority: "high"
source: "ndx-capture"
---
