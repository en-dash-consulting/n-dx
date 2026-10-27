---
id: "798897f5-34e7-4ade-87d5-bb81af19d6f7"
type: "change"
title: "Extend iso map IaC discovery beyond Terraform"
slug: "extend-iso-map-iac-discovery-beyond"
intent: "`discoverFromIaC` in `packages/sourcevision/src/export/iso-declared.ts` parses Terraform `resource \"type\" \"name\"` blocks only. CloudFormation (`Type: AWS::SQS::Queue` in YAML), Pulumi and CDK produce no infrastructure nodes, so teams on those stacks must declare everything by hand in `.n-dx.json`."
acceptanceCriteria:
  - "CloudFormation YAML resource types are classified into the same coarse kinds as Terraform"
  - "The resource-type classification table is shared across IaC formats rather than duplicated per parser"
  - "A project using only CloudFormation produces infrastructure nodes without hand declaration"
amends: [{"target":"79ff43cf-43e9-4615-9227-31eb90b2d10f","delta":"modified","summary":"Extend iso map IaC discovery beyond Terraform","base":"f9ad8d6a389cedd9b6f4edcce809dd34816abb260a728baee43ef1c45e0aa408"}]
priority: "low"
tags:
  - "sourcevision"
  - "isometric"
  - "infrastructure"
---
