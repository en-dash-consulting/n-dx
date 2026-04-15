---
layout: home

hero:
  name: n-dx
  text: AI-Powered Development Toolkit
  tagline: Analyze a codebase, build a PRD, execute tasks autonomously.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Architecture
      link: /architecture/overview
    - theme: alt
      text: GitHub
      link: https://github.com/en-dash-consulting/n-dx

features:
  - icon:
      src: /sourcevision-f.png
      alt: SourceVision
      width: 48
      height: 48
    title: SourceVision
    details: Static analysis engine — file inventory, import graph, zone detection via Louvain community detection, React component catalog. Produces AI-readable context files.
    link: /packages/sourcevision
  - icon:
      src: /rex-f.png
      alt: Rex
      width: 48
      height: 48
    title: Rex
    details: PRD management — hierarchical epics/features/tasks/subtasks, LLM-powered analysis that turns codebase findings into actionable work items.
    link: /packages/rex
  - icon:
      src: /hench-f.png
      alt: Hench
      width: 48
      height: 48
    title: Hench
    details: Autonomous agent — picks the next task, builds a brief with codebase context, runs an LLM tool-use loop to implement it, records everything.
    link: /packages/hench
  - icon: "🔄"
    title: Self-Healing Loop
    details: Iterative improvement — analyze, recommend fixes, execute tasks, acknowledge completed work. Fuzzy matching prevents fixed findings from regenerating.
    link: /guide/self-heal
  - icon: "🌐"
    title: Web Dashboard
    details: Browser-based project dashboard with zone maps, PRD status, and unified MCP HTTP server for AI tool integration.
    link: /packages/web
  - icon: "🔌"
    title: MCP Integration
    details: Rex and SourceVision expose MCP servers for Claude Code and Codex — use AI tools to query your codebase and manage your PRD directly.
    link: /guide/mcp
---
