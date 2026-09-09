---
id: "798897f5-34e7-4ade-87d5-bb81af19d6f7"
level: "task"
title: "Extend iso map IaC discovery beyond Terraform"
status: "completed"
priority: "low"
tags:
  - "sourcevision"
  - "isometric"
  - "infrastructure"
startedAt: "2026-09-09T19:58:49.146Z"
completedAt: "2026-09-09T20:15:17.336Z"
endedAt: "2026-09-09T20:15:17.336Z"
resolutionType: "code-change"
resolutionDetail: "CloudFormation YAML templates produce infrastructure nodes with no hand declaration, identified by content signature so unrelated YAML is skipped. One shared classification table serves both formats via separator normalisation (AWS::S3::Bucket == aws_s3_bucket) rather than a per-parser copy; only Events::Rule and ECS::Service needed new patterns. Shallow line scanner, no new dependency, so the portable skill bundle stays self-contained. 12 new tests; full suite 6/6. Commits ab682434, 18d3ab54."
acceptanceCriteria:
  - "CloudFormation YAML resource types are classified into the same coarse kinds as Terraform"
  - "The resource-type classification table is shared across IaC formats rather than duplicated per parser"
  - "A project using only CloudFormation produces infrastructure nodes without hand declaration"
description: "`discoverFromIaC` in `packages/sourcevision/src/export/iso-declared.ts` parses Terraform `resource \"type\" \"name\"` blocks only. CloudFormation (`Type: AWS::SQS::Queue` in YAML), Pulumi and CDK produce no infrastructure nodes, so teams on those stacks must declare everything by hand in `.n-dx.json`."
lastModified: "2026-09-09T20:15:17.359Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
