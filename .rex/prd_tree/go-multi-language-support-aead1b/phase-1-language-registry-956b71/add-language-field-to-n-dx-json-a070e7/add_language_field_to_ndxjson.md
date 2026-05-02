---
id: "a070e70d-af05-40aa-b6e7-0f06eea257ea"
level: "task"
title: "Add language field to .n-dx.json schema and wire config support"
status: "completed"
priority: "high"
tags:
  - "config"
  - "sourcevision"
  - "go"
  - "schema"
source: "smart-add"
startedAt: "2026-03-25T21:35:00.413Z"
completedAt: "2026-03-25T21:50:17.784Z"
acceptanceCriteria:
  - ".n-dx.json schema accepts an optional 'language' field with enum values: 'typescript', 'javascript', 'go', 'auto'"
  - "config.js reads the language field and includes it in the unified config view"
  - "ndx config language go sets the language field to 'go' in .n-dx.json"
  - "detectLanguage() reads .n-dx.json and returns the corresponding LanguageConfig when language is explicitly set"
  - "Setting language to 'auto' (or omitting the field) triggers the marker-based detection chain"
  - "Invalid language values produce a validation error with the list of valid options"
  - ".sourcevision/manifest.json records the resolved language after analysis"
description: "Add an optional language field to the .n-dx.json project config schema with valid values: 'typescript', 'javascript', 'go', 'auto' (default). Update config.js to read, validate, and expose this field. This allows users to explicitly override language detection for edge cases (e.g. mixed repos, unusual layouts). The field must be respected by detectLanguage() as the highest-priority signal."
---
