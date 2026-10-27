---
id: "17a8312b-14b6-45c8-8908-a51dad483249"
type: "task"
title: "Apply added, modified and removed amendments to the product layer"
slug: "apply-added-modified-and-removed"
description: "added creates the capability under its target area or capability; modified adds, replaces or removes criteria by id, or writes the reviewed proposed statement and criteria when present; removed retires the node. Append a History line, stamp metAt (hash of statement plus criteria only, never the body) and appliedIn. A touches-only change writes nothing under product/."
acceptanceCriteria:
  - "Each delta kind has tests including replace and remove by criterion id"
  - "Editing a capability's prose body does not change its hash"
  - "Applying a touches-only change leaves product/ untouched"
priority: "high"
tags:
  - "pr-10"
  - "lane-rex-domain"
  - "rex"
source: "roadmap"
---
