---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/web": patch
"@n-dx/llm-client": patch
"@n-dx/sourcevision": patch
---

### SourceVision
- Go language support: import graph analysis, zone detection, route extraction, archetype classification
- Multi-language project detection (Go + TypeScript coexistence)
- Database package detection and Architecture view panel (194 known packages across Go/Node/Python)
- Handler → Database flow tracing in Architecture view
- Architecture view layout improvements for long Go module paths

### Rex
- Go module scanner (`go.mod` dependency parsing)
- Go-aware analysis pipeline integration

### Hench
- Go test runner support
- Go-specific agent planning prompts
- Go guard defaults in schema

### Web Dashboard
- Database Layer panel in Architecture view
- Handler → DB Flows panel with BFS path tracing
- Bar chart label improvements (wider labels, SVG tooltips, smart truncation)
- Table cell overflow handling for long package names

### LLM Client
- Schema updates supporting Go language constructs
