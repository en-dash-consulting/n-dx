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
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Workflow", link: "/guide/workflow" },
            { text: "Commands", link: "/guide/commands" },
            { text: "Configuration", link: "/guide/configuration" },
            { text: "MCP Integration", link: "/guide/mcp" },
            { text: "Self-Heal Loop", link: "/guide/self-heal" },
            { text: "Run While You Sleep", link: "/guide/overnight" },
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
            { text: "Viewer Code Audit", link: "/contributing/viewer-code-audit" },
            { text: "Smart Add Dedup", link: "/contributing/smart-add-duplicate-detection" },
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
