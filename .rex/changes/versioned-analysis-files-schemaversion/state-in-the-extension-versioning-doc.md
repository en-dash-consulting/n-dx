---
id: "c9c861a1-86d1-470a-bb0c-cdcf9cfbb5d5"
type: "task"
title: "State in the extension versioning doc whether the next minor changes the ndx.extension contract"
slug: "state-in-the-extension-versioning-doc"
summary: "Tell extension authors ahead of the next minor release whether their extension keeps working, so they can widen their supported range in time."
description: "docs/extensions/versioning.md tells authors to pin ndxVersion to tested releases (for example `>=0.10.0 <0.12.0`) and says a minor may change the contract. An extension pinned below the next minor turns itself off when that minor ships. Add a short \"Upcoming releases\" section that says, for each planned minor, whether `apiVersion` or anything in the declared extension contract (manifest, environment, /x/<name>/ proxy, hub endpoints) changes, and if not, that authors may widen to `<0.13.0` once they have tested. This is the owner's decision: if the change carries no recorded answer when this runs, write the section with the current apiVersion and state that no contract change is planned only if the extensions docs and code show none in flight; otherwise stop and ask."
acceptanceCriteria:
  - "docs/extensions/versioning.md has an Upcoming releases section naming the next minor and whether the extension contract changes"
  - "The current apiVersion is stated and matches the code"
  - "Docs build passes"
priority: "medium"
tags:
  - "docs"
  - "extensions"
source: "ndx-capture"
---
