---
id: "798897f5-34e7-4ade-87d5-bb81af19d6f7"
level: "task"
title: "Extend iso map IaC discovery beyond Terraform"
status: "deferred"
priority: "low"
tags:
  - "sourcevision"
  - "isometric"
  - "infrastructure"
acceptanceCriteria:
  - "CloudFormation YAML resource types are classified into the same coarse kinds as Terraform"
  - "The resource-type classification table is shared across IaC formats rather than duplicated per parser"
  - "A project using only CloudFormation produces infrastructure nodes without hand declaration"
description: "`discoverFromIaC` in `packages/sourcevision/src/export/iso-declared.ts` parses Terraform `resource \"type\" \"name\"` blocks only. CloudFormation (`Type: AWS::SQS::Queue` in YAML), Pulumi and CDK produce no infrastructure nodes, so teams on those stacks must declare everything by hand in `.n-dx.json`."
lastModified: "2026-09-09T19:34:38.219Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
