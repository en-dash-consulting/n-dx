---
id: "efc731f2-9b83-4d5f-8964-6098a729f72b"
type: "task"
title: "Write each PHP file's namespace and declared types with their lines"
slug: "write-each-php-file-s-namespace-and"
summary: "Record what classes and other types each PHP file defines, so a class nothing references is still visible."
description: "php-symbols.ts already reads declarations from queries/php/definitions.scm. Expose per file: namespace (or none), and each declared class, interface, trait and enum with its short name, fully qualified name and line; declarations inside conditional blocks count, anonymous classes do not. Carry it through the lang-kit contract as a language-neutral \"declarations\" fact (other packs may fill it later) and write it as a small fact file keyed by pack id (or as a per-file field in inventory.json if that fits the schema better; record the choice in the run summary). Not callgraph.json. schemaVersion, canonical output."
acceptanceCriteria:
  - "On a fixture with a namespaced file declaring two classes, an interface and a trait, the output lists all four with fully qualified names and correct lines"
  - "A class declared inside an if block is listed; an anonymous class is not"
  - "A file with no namespace reports none"
  - "Repos without PHP produce no declarations output"
  - "Output is byte-stable across two runs"
priority: "medium"
tags:
  - "lang-php"
  - "lang-kit"
  - "sourcevision"
source: "ndx-capture"
blockedBy:
  - "7f4713b1-ab9e-4b67-bf59-19b5aa16284a"
---
