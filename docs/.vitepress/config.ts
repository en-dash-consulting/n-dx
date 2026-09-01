import { defineConfig } from "vitepress";

export default defineConfig({
  title: "n-dx",
  description: "AI-powered development toolkit",
  base: "/",

  head: [
    ["link", { rel: "icon", type: "image/png", href: "/n-dx-logo.png" }],
    ["script", { async: "", src: "https://www.googletagmanager.com/gtag/js?id=G-C1ZPPSFEZD" }],
    ["script", {}, "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-C1ZPPSFEZD')"],
  ],

  themeConfig: {
    logo: "/n-dx-logo.png",
    siteTitle: "n-dx",

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Architecture", link: "/architecture/overview" },
      { text: "Packages", link: "/packages/overview" },
      { text: "Contributing", link: "/contributing/testing" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Quickstart", link: "/guide/quickstart" },
            { text: "Existing Project Onboarding", link: "/guide/existing-project" },
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Workflow", link: "/guide/workflow" },
            { text: "Commands", link: "/guide/commands" },
            { text: "Configuration", link: "/guide/configuration" },
            { text: "Skills Reference", link: "/guide/skills" },
            { text: "MCP Integration", link: "/guide/mcp" },
            { text: "Self-Heal Loop", link: "/guide/self-heal" },
            { text: "PRD Storage Layout", link: "/guide/prd-storage" },
            { text: "Codebase Onboarding", link: "/guide/onboarding" },
            { text: "Run While You Sleep", link: "/guide/overnight" },
            { text: "Spec-Driven Development", link: "/guide/spec-driven" },
            { text: "n-dx vs Spec Kit", link: "/guide/n-dx-vs-spec-kit" },
            { text: "Cleaning Up a Vibe-Coded App", link: "/guide/vibe-cleanup" },
            { text: "Keeping Your PRD Alive", link: "/guide/change-management" },
            { text: ".gitignore Setup", link: "/guide/gitignore" },
            { text: "Troubleshooting", link: "/guide/troubleshooting" },
          ],
        },
      ],
      "/architecture/": [
        {
          text: "Architecture",
          items: [
            { text: "Overview", link: "/architecture/overview" },
            { text: "Gateway Modules", link: "/architecture/gateways" },
            { text: "Memory Management", link: "/architecture/memory-architecture" },
            { text: "Zone Naming", link: "/architecture/zone-naming-conventions" },
            { text: "Level System", link: "/architecture/level-system-reference" },
            { text: "Viewer Architecture", link: "/architecture/viewer-architecture" },
            { text: "PRD Folder-Tree Schema", link: "/architecture/prd-folder-tree-schema" },
          ],
        },
        {
          text: "Languages",
          collapsed: true,
          items: [
            { text: "Multi-Language Architecture", link: "/architecture/multi-language-architecture" },
            { text: "Go Integration", link: "/architecture/go-integration" },
            { text: "Go Zone Detection", link: "/architecture/go-zone-detection" },
          ],
        },
        {
          text: "Roadmap",
          collapsed: true,
          items: [
            { text: "PRD Steward Vision", link: "/architecture/prd-steward-vision" },
            { text: "Level Refactor Plan", link: "/process/level-refactor-and-steward-plan" },
          ],
        },
        {
          text: "Technical Reference",
          collapsed: true,
          items: [
            { text: "Process Lifecycle", link: "/analysis/process-lifecycle-audit" },
            { text: "Signal Handling", link: "/analysis/signal-handling-audit" },
            { text: "Memory OS Behavior", link: "/process/memory-os-behavior" },
            { text: "Install Path Validation", link: "/process/install-path-validation" },
          ],
        },
      ],
      "/packages/": [
        {
          text: "Packages",
          items: [
            { text: "Overview", link: "/packages/overview" },
            { text: "SourceVision", link: "/packages/sourcevision" },
            { text: "Analysis Deep Dive", link: "/packages/sourcevision-analysis" },
            { text: "Rex", link: "/packages/rex" },
            { text: "Hench", link: "/packages/hench" },
            { text: "LLM Client", link: "/packages/llm-client" },
            { text: "Web Dashboard", link: "/packages/web" },
          ],
        },
      ],
      "/archive/": [
        {
          text: "Archive",
          items: [{ text: "Overview", link: "/archive/" }],
        },
      ],
      "/contributing/": [
        {
          text: "Contributing",
          items: [
            { text: "Testing Conventions", link: "/contributing/testing" },
            { text: "Package Guidelines", link: "/contributing/package-guidelines" },
            { text: "Enforcement Map", link: "/contributing/enforcement" },
          ],
        },
        {
          text: "Implementation Reference",
          collapsed: true,
          items: [
            { text: "Web Zone Governance", link: "/contributing/web-zone-governance" },
            { text: "Resource Allocation", link: "/contributing/resource-allocation-reference" },
            { text: "Memory System Risks", link: "/contributing/memory-system-risks" },
            { text: "Memory Improvements", link: "/contributing/memory-system-improvements" },
            { text: "Refresh Memory Analysis", link: "/contributing/refresh-memory-analysis" },
            { text: "Smart Add Dedup", link: "/contributing/smart-add-duplicate-detection" },
            { text: "Accessibility", link: "/accessibility" },
            { text: "CLI ↔ Dashboard Coverage", link: "/cli-ui-gap" },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/en-dash-consulting/n-dx" },
    ],

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/en-dash-consulting/n-dx/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    footer: {
      message: "Released under the Elastic License 2.0.",
      copyright: "Copyright 2025-2026 En Dash Consulting",
    },
  },
});
