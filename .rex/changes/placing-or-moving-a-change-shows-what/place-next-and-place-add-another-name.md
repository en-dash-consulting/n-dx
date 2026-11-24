---
id: "b069f972-2d1a-4573-a1c4-faf31b633acc"
type: "task"
title: "Place & next and Place & add another name their target"
slug: "place-next-and-place-add-another-name"
summary: "The secondary placement buttons say where the change will go, like the main button already does, so nobody places a change somewhere they didn't intend."
description: "Seen in placement-preview-amend.png (integration/plan-analyze-stack @ 7bb07a3d3): the primary button reads \"Amend &lt;capability&gt;\", but \"Place &amp; next\" and \"Place &amp; add another\" give no target."
acceptanceCriteria:
  - "'Place & next' and 'Place & add another' include the relation and target name (shortened where long), or carry it in an accessible label and tooltip"
  - "A test asserts each button's label names the selected target"
priority: "low"
source: "ndx-capture"
---
