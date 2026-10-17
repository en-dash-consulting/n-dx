---
id: "e4c27923-11e2-48f9-b89c-ea4d177fd5b0"
level: "task"
title: "Correct the Terraform model changeset now that infrastructure.json gains fields"
status: "pending"
priority: "high"
source: "review"
acceptanceCriteria:
  - "The changeset describes the optional infrastructure.json fields and the database-engine signal, and no longer says nothing is written"
description: "Stack review (#780): .changeset/terraform-model-pack.md ends with Nothing is written to infrastructure.json yet, which 0797434a8's enrichTerraformInfrastructure made false: with the Terraform pack installed, Terraform resources gain optional module, provider ({name, version?}), references and attributes, and Terraform database resources become a database-engine candidate source. Rewrite the note to say so; Sterling H (the infrastructure.json consumer) reads it. Changeset file only."
lastModified: "2026-10-17T01:21:49.007Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
