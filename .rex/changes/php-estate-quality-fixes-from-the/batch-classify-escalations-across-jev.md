---
id: "062e0a68-be5d-404b-907a-6a19938c7847"
type: "task"
title: "Batch classify escalations across Jev batches and escalate less"
slug: "batch-classify-escalations-across-jev"
description: "On a real legacy deep run, code.classify escalated 1-14 ambiguous files from nearly every 30-file Jev batch to the text model, one call per batch: 95 Haiku calls took about 19 minutes against about 35 s for Jev. Escalations are now queued across batches and sent 40 at a time, and a Jev 'none' at 0.45 or above is taken as the answer (was 0.6). Third-party and mirror-copy files no longer reach classification at all."
acceptanceCriteria:
  - "Ambiguous files from every Jev batch share text-model calls of up to 40 files, not one call per batch"
  - "A Jev none at probability 0.45 or above is not escalated"
priority: "high"
---
