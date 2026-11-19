---
id: "ec36a246-db57-4541-a4d4-28895bc10caf"
type: "task"
title: "Release the PHP config and outbound framework captures per file, as dynamic code now does"
slug: "release-the-php-config-and-outbound"
summary: "After the dynamic-code fix, the PHP pack's memory peak on large repositories comes from other readers keeping every file's parse results at once; releasing them file by file would roughly halve it again."
description: "Found while fixing P1 (5ebf7eba). On a generated 900 KB PHP class file, the php-config query yields ~65k captures (~11 MB), outbound/legacy ~11k each, and the language queries (imports, calls, guards, sql) ~82k (~15 MB); all are held for every file until the frameworks read. With every kind enabled 20 MB of PHP still needs ~1 GB heap. Adopt lang-runtime's FrameworkPack.digest for php-config (its read takes the resolver context, so the digest must keep what read resolves through it), php-outbound and php-legacy, measuring with tests/helpers/memory-probe.mjs; facts must be byte-identical on fixtures."
acceptanceCriteria:
  - "Peak heap with every kind on 20 MB of generated PHP measured before and after and reported"
  - "Config, outbound and legacy facts identical on existing fixtures"
priority: "medium"
tags:
  - "lang-php"
  - "performance"
---
