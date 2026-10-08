---
id: "9c28bdc7-1d37-447c-bfde-3e1a356fed85"
level: "task"
title: "Read dependencies and versions from Maven pom files"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "phase-2"
  - "sourcevision"
  - "java"
source: "roadmap"
acceptanceCriteria:
  - "Dependencies are listed with coordinates, version and scope per module"
  - "Property placeholders resolve through in-repository parents; unresolvable ones stay marked unresolved"
  - "Versions managed by dependencyManagement and in-repository BOMs are applied; external ones are marked unresolved"
  - "The Java version and Spring Boot version are reported when declared"
  - "Fixture goldens cover a child module inheriting from a parent, a BOM import and an external parent"
description: "Extend the module reader for Maven. Parse each pom.xml as XML (no regex) and collect: parent coordinates; properties, with ${...} resolved through the module's own and its in-repository parents' properties; dependencyManagement entries, including imported BOMs; dependencies as groupId:artifactId:version with scope; the Java version from maven.compiler.release, maven.compiler.source or java.version; and the Spring Boot version from a spring-boot-starter-parent parent or a spring-boot-dependencies BOM import.\n\nA parent or BOM outside the repository cannot be read without the network, so versions that depend on it are marked unresolved, never guessed. Keep the result in the in-memory build model.\n\nNote from the language hub (2026-10-08): the Go branch's go.mod/go.work reader (task db21d009) will mirror this reader's output type so the packs do not drift. Define the build-model output as one exported type (module, dependency coordinates and versions, Java and Spring Boot versions, resolved/unresolved markers), and state its file, type name and fields in the rex log for this task."
lastModified: "2026-10-07T23:56:41.309Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
