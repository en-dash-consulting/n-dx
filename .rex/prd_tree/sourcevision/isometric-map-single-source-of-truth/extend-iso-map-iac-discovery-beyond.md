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
startedAt: "2026-09-04T21:35:05.392Z"
completedAt: "2026-09-04T21:48:19.222Z"
endedAt: "2026-09-04T21:48:19.222Z"
resolutionType: "code-change"
resolutionDetail: "CloudFormation and SAM templates now produce infrastructure nodes. One classification table serves both dialects: classifyResource normalizes AWS::SQS::Queue to aws_sqs_queue so the existing Terraform patterns match, with events_rule and serverless_function added. findIaCFiles walks the tree once with separate .tf and .yaml budgets; isCloudFormation requires a top-level Resources: block plus a namespaced Type: so CI workflows and k8s manifests are never mistaken for IaC or allowed to flip sawIaC; parseCloudFormation is a line scan that reads logical name, type and name-ish properties, rejecting !Ref/!Sub/Fn:: values. Pulumi and CDK stay out of scope and are documented as a limit. 8 new tests (36 in iso-declared.test.ts), sourcevision 1896 / root 2283 / web 3508 pass, skill bundle regenerated, docs and the two Terraform-only gap messages updated. Smoke-tested with the generated bundle against a CloudFormation-only project holding no .n-dx.json."
acceptanceCriteria:
  - "CloudFormation YAML resource types are classified into the same coarse kinds as Terraform"
  - "The resource-type classification table is shared across IaC formats rather than duplicated per parser"
  - "A project using only CloudFormation produces infrastructure nodes without hand declaration"
description: "`discoverFromIaC` in `packages/sourcevision/src/export/iso-declared.ts` parses Terraform `resource \"type\" \"name\"` blocks only. CloudFormation (`Type: AWS::SQS::Queue` in YAML), Pulumi and CDK produce no infrastructure nodes, so teams on those stacks must declare everything by hand in `.n-dx.json`."
lastModified: "2026-09-04T21:48:19.251Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
