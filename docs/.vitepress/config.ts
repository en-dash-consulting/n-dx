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
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Workflow", link: "/guide/workflow" },
            { text: "Commands", link: "/guide/commands" },
            { text: "Configuration", link: "/guide/configuration" },
            { text: "MCP Integration", link: "/guide/mcp" },
            { text: "Self-Heal Loop", link: "/guide/self-heal" },
          ],
        },
      ],
      "/architecture/": [
        {
          text: "Architecture",
          items: [
            { text: "Overview", link: "/architecture/overview" },
            { text: "Gateway Modules", link: "/architecture/gateways" },
            { text: "Web Package Zones", link: "/architecture/web-zone-architecture" },
            { text: "Memory Management", link: "/architecture/memory-architecture" },
            { text: "Zone Naming", link: "/architecture/zone-naming-conventions" },
            { text: "Level System", link: "/architecture/level-system-reference" },
            { text: "PRD Steward Vision", link: "/architecture/prd-steward-vision" },
            { text: "Viewer Architecture", link: "/architecture/viewer-architecture" },
          ],
        },
        {
          text: "Audits & Analysis",
          collapsed: true,
          items: [
            { text: "Process Lifecycle", link: "/analysis/process-lifecycle-audit" },
            { text: "Signal Handling", link: "/analysis/signal-handling-audit" },
            { text: "Resource Allocation", link: "/analysis/resource-allocation-catalog" },
            { text: "Memory Risks", link: "/analysis/memory-risks-and-flaws" },
            { text: "Refresh Memory Analysis", link: "/analysis/refresh-orchestration-memory-analysis" },
            { text: "Viewer Audit", link: "/analysis/viewer-audit" },
          ],
        },
        {
          text: "Plans & Proposals",
          collapsed: true,
          items: [
            { text: "Level Refactor Plan", link: "/process/level-refactor-and-steward-plan" },
            { text: "Memory Improvements", link: "/process/memory-improvements" },
            { text: "Memory OS Behavior", link: "/process/memory-os-behavior" },
            { text: "Smart Add Duplicate Detection", link: "/process/rex-smart-add-duplicate-detection" },
          ],
        },
      ],
      "/packages/": [
        {
          text: "Packages",
          items: [
            { text: "Overview", link: "/packages/overview" },
            { text: "SourceVision", link: "/packages/sourcevision" },
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
