import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractComponentDefinitions,
  extractJsxUsages,
  extractConventionExports,
  analyzeComponents,
} from "../../../src/analyzers/components.js";
import {
  parseFileRoutePattern,
  buildRouteTree,
  findRoutesConfig,
  parseRoutesConfig,
} from "../../../src/analyzers/route-detection.js";
import { analyzeInventory } from "../../../src/analyzers/inventory.js";
import { analyzeImports } from "../../../src/analyzers/imports.js";

// ── extractComponentDefinitions ─────────────────────────────────────────────

describe("extractComponentDefinitions", () => {
  it("detects function component", () => {
    const source = `export function Button() { return <div>click</div>; }`;
    const result = extractComponentDefinitions(source, "Button.tsx");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Button");
    expect(result[0].kind).toBe("function");
    expect(result[0].isDefaultExport).toBe(false);
  });

  it("detects arrow function component", () => {
    const source = `export const Card = () => <div>card</div>;`;
    const result = extractComponentDefinitions(source, "Card.tsx");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Card");
    expect(result[0].kind).toBe("arrow");
  });

  it("detects default exported function component", () => {
    const source = `export default function Page() { return <main />; }`;
    const result = extractComponentDefinitions(source, "Page.tsx");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Page");
    expect(result[0].isDefaultExport).toBe(true);
  });

  it("detects class component", () => {
    const source = `
      import { Component } from "react";
      export class MyWidget extends Component {
        render() { return <div />; }
      }
    `;
    const result = extractComponentDefinitions(source, "MyWidget.tsx");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("MyWidget");
    expect(result[0].kind).toBe("class");
  });

  it("detects React.Component class", () => {
    const source = `
      import React from "react";
      export class MyWidget extends React.Component {
        render() { return <div />; }
      }
    `;
    const result = extractComponentDefinitions(source, "MyWidget.tsx");
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("class");
  });

  it("detects forwardRef component", () => {
    const source = `
      import { forwardRef } from "react";
      export const Input = forwardRef((props, ref) => <input ref={ref} />);
    `;
    const result = extractComponentDefinitions(source, "Input.tsx");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Input");
    expect(result[0].kind).toBe("forwardRef");
  });

  it("detects React.forwardRef component", () => {
    const source = `
      import React from "react";
      export const Input = React.forwardRef((props, ref) => <input ref={ref} />);
    `;
    const result = extractComponentDefinitions(source, "Input.tsx");
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("forwardRef");
  });

  it("ignores non-component functions", () => {
    const source = `
      export function fetchData() { return fetch("/api"); }
      export const utils = { parse: (s: string) => s };
    `;
    const result = extractComponentDefinitions(source, "utils.tsx");
    expect(result).toHaveLength(0);
  });

  it("ignores lowercase function returning JSX", () => {
    const source = `export function renderItem() { return <li>item</li>; }`;
    const result = extractComponentDefinitions(source, "helpers.tsx");
    expect(result).toHaveLength(0);
  });

  it("detects multiple components in one file", () => {
    const source = `
      export function Header() { return <header />; }
      export const Footer = () => <footer />;
    `;
    const result = extractComponentDefinitions(source, "layout.tsx");
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.name).sort()).toEqual(["Footer", "Header"]);
  });

  it("detects default export via export default Identifier", () => {
    const source = `
      function MyPage() { return <div />; }
      export default MyPage;
    `;
    const result = extractComponentDefinitions(source, "page.tsx");
    expect(result).toHaveLength(1);
    expect(result[0].isDefaultExport).toBe(true);
  });

  it("reports correct line numbers", () => {
    const source = `// comment\n\nexport function App() { return <div />; }`;
    const result = extractComponentDefinitions(source, "App.tsx");
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(3);
  });
});

// ── extractJsxUsages ────────────────────────────────────────────────────────

describe("extractJsxUsages", () => {
  it("detects custom component usage", () => {
    const source = `
      export function App() {
        return <div><Button /><Card>content</Card></div>;
      }
    `;
    const result = extractJsxUsages(source, "App.tsx");
    expect(result).toHaveLength(2);
    expect(result.find((u) => u.componentName === "Button")?.count).toBe(1);
    expect(result.find((u) => u.componentName === "Card")?.count).toBe(1);
  });

  it("skips lowercase HTML elements", () => {
    const source = `
      export function App() {
        return <div><span>text</span><p /></div>;
      }
    `;
    const result = extractJsxUsages(source, "App.tsx");
    expect(result).toHaveLength(0);
  });

  it("counts multiple usages of same component", () => {
    const source = `
      export function App() {
        return <div><Button /><Button /><Button /></div>;
      }
    `;
    const result = extractJsxUsages(source, "App.tsx");
    expect(result).toHaveLength(1);
    expect(result[0].componentName).toBe("Button");
    expect(result[0].count).toBe(3);
  });

  it("detects self-closing and opening elements", () => {
    const source = `
      export function App() {
        return <div><Icon /><Panel>stuff</Panel></div>;
      }
    `;
    const result = extractJsxUsages(source, "App.tsx");
    expect(result).toHaveLength(2);
  });

  it("handles JSX fragments", () => {
    const source = `
      export function App() {
        return <><Button /><Card /></>;
      }
    `;
    const result = extractJsxUsages(source, "App.tsx");
    expect(result).toHaveLength(2);
  });

  it("detects property access components (Foo.Bar)", () => {
    const source = `
      export function App() {
        return <div><Icons.Arrow /><Form.Input>text</Form.Input></div>;
      }
    `;
    const result = extractJsxUsages(source, "App.tsx");
    expect(result).toHaveLength(2);
    expect(result.find((u) => u.componentName === "Icons.Arrow")?.count).toBe(1);
    expect(result.find((u) => u.componentName === "Form.Input")?.count).toBe(1);
  });

  it("handles deep property access (A.B.C)", () => {
    const source = `
      export function App() {
        return <Motion.div.animated />;
      }
    `;
    const result = extractJsxUsages(source, "App.tsx");
    expect(result).toHaveLength(1);
    expect(result[0].componentName).toBe("Motion.div.animated");
  });

  it("skips React.Fragment as a component usage", () => {
    const source = `
      import React from 'react';
      export function App() {
        return <React.Fragment><Button /><Card /></React.Fragment>;
      }
    `;
    const result = extractJsxUsages(source, "App.tsx");
    expect(result).toHaveLength(2);
    expect(result.map((u) => u.componentName)).not.toContain("React.Fragment");
  });

  it("skips Fragment import used as JSX tag", () => {
    const source = `
      import { Fragment } from 'react';
      export function App() {
        return <Fragment><Button /></Fragment>;
      }
    `;
    const result = extractJsxUsages(source, "App.tsx");
    expect(result).toHaveLength(1);
    expect(result[0].componentName).toBe("Button");
  });

  it("counts components across nested JSX expressions", () => {
    const source = `
      export function App() {
        return (
          <div>
            {condition && <Alert />}
            {items.map(i => <Card key={i} />)}
            <Alert />
          </div>
        );
      }
    `;
    const result = extractJsxUsages(source, "App.tsx");
    expect(result).toHaveLength(2);
    expect(result.find((u) => u.componentName === "Alert")?.count).toBe(2);
    expect(result.find((u) => u.componentName === "Card")?.count).toBe(1);
  });

  it("sorts results by count descending", () => {
    const source = `
      export function App() {
        return (
          <div>
            <A /><A /><A />
            <B /><B />
            <C />
          </div>
        );
      }
    `;
    const result = extractJsxUsages(source, "App.tsx");
    expect(result).toEqual([
      { componentName: "A", count: 3 },
      { componentName: "B", count: 2 },
      { componentName: "C", count: 1 },
    ]);
  });
});

// ── extractConventionExports ────────────────────────────────────────────────

describe("extractConventionExports", () => {
  it("detects loader export", () => {
    const source = `export function loader() { return null; }`;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toContain("loader");
  });

  it("detects action export", () => {
    const source = `export const action = async () => null;`;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toContain("action");
  });

  it("detects default export", () => {
    const source = `export default function Route() { return <div />; }`;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toContain("default");
  });

  it("detects meta export", () => {
    const source = `export function meta() { return [{ title: "Page" }]; }`;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toContain("meta");
  });

  it("detects ErrorBoundary export", () => {
    const source = `export function ErrorBoundary() { return <div>Error</div>; }`;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toContain("ErrorBoundary");
  });

  it("detects multiple convention exports", () => {
    const source = `
      export function loader() { return null; }
      export function action() { return null; }
      export function meta() { return []; }
      export default function Route() { return <div />; }
    `;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toContain("loader");
    expect(result).toContain("action");
    expect(result).toContain("meta");
    expect(result).toContain("default");
    expect(result).toHaveLength(4);
  });

  it("returns empty for no convention exports", () => {
    const source = `export function helper() { return 42; }`;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toHaveLength(0);
  });

  it("detects shouldRevalidate", () => {
    const source = `export const shouldRevalidate = () => true;`;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toContain("shouldRevalidate");
  });

  it("detects handle export", () => {
    const source = `export const handle = { breadcrumb: () => "Home" };`;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toContain("handle");
  });

  it("detects class ErrorBoundary export", () => {
    const source = `
      import { Component } from "react";
      export class ErrorBoundary extends Component {
        render() { return <div>Error</div>; }
      }
    `;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toContain("ErrorBoundary");
  });

  it("detects export-from", () => {
    const source = `
      export { loader } from "./loader.js";
      export { action } from "./actions.js";
    `;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toContain("loader");
    expect(result).toContain("action");
    expect(result).toHaveLength(2);
  });

  it("detects re-export without from", () => {
    const source = `
      function loader() { return null; }
      function action() { return null; }
      export { loader, action };
    `;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toContain("loader");
    expect(result).toContain("action");
    expect(result).toHaveLength(2);
  });

  it("detects default export in export-from", () => {
    const source = `export { default } from "./component.js";`;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toContain("default");
  });

  it("detects mixed export-from and regular exports", () => {
    const source = `
      export { loader } from "./loader.js";
      export function action() { return null; }
      export const meta = () => [];
    `;
    const result = extractConventionExports(source, "route.tsx");
    expect(result).toContain("loader");
    expect(result).toContain("action");
    expect(result).toContain("meta");
    expect(result).toHaveLength(3);
  });
});

// ── parseFileRoutePattern ───────────────────────────────────────────────────

describe("parseFileRoutePattern", () => {
  const routesDir = "app/routes";

  it("parses index route", () => {
    expect(parseFileRoutePattern("app/routes/_index.tsx", routesDir)).toBe("/");
  });

  it("parses simple route", () => {
    expect(parseFileRoutePattern("app/routes/users.tsx", routesDir)).toBe("/users");
  });

  it("parses dynamic segment", () => {
    expect(parseFileRoutePattern("app/routes/users.$id.tsx", routesDir)).toBe("/users/:id");
  });

  it("parses trailing underscore escape", () => {
    expect(parseFileRoutePattern("app/routes/users.$id_.edit.tsx", routesDir)).toBe("/users/:id/edit");
  });

  it("parses pathless layout (leading underscore)", () => {
    expect(parseFileRoutePattern("app/routes/_auth.tsx", routesDir)).toBeNull();
  });

  it("parses route nested under layout", () => {
    expect(parseFileRoutePattern("app/routes/_auth.login.tsx", routesDir)).toBe("/login");
  });

  it("parses dot-delimited segments", () => {
    expect(parseFileRoutePattern("app/routes/a.b.c.tsx", routesDir)).toBe("/a/b/c");
  });

  it("parses splat route", () => {
    expect(parseFileRoutePattern("app/routes/$.tsx", routesDir)).toBe("/*");
  });

  it("parses optional dynamic segment", () => {
    expect(parseFileRoutePattern("app/routes/lang.($lang).tsx", routesDir)).toBe("/lang/:lang?");
  });

  it("parses nested index route", () => {
    expect(parseFileRoutePattern("app/routes/users._index.tsx", routesDir)).toBe("/users");
  });

  it("returns null for files outside routes dir", () => {
    expect(parseFileRoutePattern("app/components/Button.tsx", routesDir)).toBeNull();
  });
});

// ── buildRouteTree ──────────────────────────────────────────────────────────

describe("buildRouteTree", () => {
  it("builds flat route tree", () => {
    const modules = [
      { file: "app/routes/_index.tsx", routePattern: "/", exports: ["default" as const], parentLayout: null, isLayout: false, isIndex: true },
      { file: "app/routes/about.tsx", routePattern: "/about", exports: ["default" as const], parentLayout: null, isLayout: false, isIndex: false },
    ];
    const tree = buildRouteTree(modules);
    expect(tree).toHaveLength(2);
    expect(tree[0].routePattern).toBe("/");
    expect(tree[0].children).toEqual([]);
    expect(tree[1].routePattern).toBe("/about");
    expect(tree[1].children).toEqual([]);
  });

  it("builds nested route tree with layout", () => {
    const modules = [
      { file: "app/routes/_auth.tsx", routePattern: null, exports: ["default" as const], parentLayout: null, isLayout: true, isIndex: false },
      { file: "app/routes/_auth.login.tsx", routePattern: "/login", exports: ["default" as const], parentLayout: "app/routes/_auth.tsx", isLayout: false, isIndex: false },
      { file: "app/routes/_auth.register.tsx", routePattern: "/register", exports: ["default" as const], parentLayout: "app/routes/_auth.tsx", isLayout: false, isIndex: false },
      { file: "app/routes/_index.tsx", routePattern: "/", exports: ["default" as const], parentLayout: null, isLayout: false, isIndex: true },
    ];
    const tree = buildRouteTree(modules);
    // Pathless layout is filtered out, but its children are promoted to root
    expect(tree).toHaveLength(3);
    expect(tree[0].routePattern).toBe("/");
    expect(tree[1].routePattern).toBe("/login");
    expect(tree[2].routePattern).toBe("/register");
  });

  it("promotes children through multiple levels of pathless layouts", () => {
    const modules = [
      { file: "app/routes/_outer.tsx", routePattern: null, exports: ["default" as const], parentLayout: null, isLayout: true, isIndex: false },
      { file: "app/routes/_outer._inner.tsx", routePattern: null, exports: ["default" as const], parentLayout: "app/routes/_outer.tsx", isLayout: true, isIndex: false },
      { file: "app/routes/_outer._inner.page.tsx", routePattern: "/page", exports: ["default" as const], parentLayout: "app/routes/_outer._inner.tsx", isLayout: false, isIndex: false },
    ];
    const tree = buildRouteTree(modules);
    // Both pathless layouts filtered out, /page promoted to root
    expect(tree).toHaveLength(1);
    expect(tree[0].routePattern).toBe("/page");
  });

  it("nests children under a routed parent", () => {
    const modules = [
      { file: "app/routes/users.tsx", routePattern: "/users", exports: ["default" as const], parentLayout: null, isLayout: false, isIndex: false },
      { file: "app/routes/users._index.tsx", routePattern: "/users", exports: ["default" as const], parentLayout: "app/routes/users.tsx", isLayout: false, isIndex: true },
      { file: "app/routes/users.$id.tsx", routePattern: "/users/:id", exports: ["default" as const], parentLayout: "app/routes/users.tsx", isLayout: false, isIndex: false },
    ];
    const tree = buildRouteTree(modules);
    expect(tree).toHaveLength(1);
    expect(tree[0].routePattern).toBe("/users");
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].routePattern).toBe("/users");
    expect(tree[0].children[1].routePattern).toBe("/users/:id");
  });

  it("promotes pathless layout children into their routed grandparent", () => {
    // /dashboard parent has a pathless _sidebar layout with children
    const modules = [
      { file: "app/routes/dashboard.tsx", routePattern: "/dashboard", exports: ["default" as const], parentLayout: null, isLayout: false, isIndex: false },
      { file: "app/routes/dashboard._sidebar.tsx", routePattern: null, exports: ["default" as const], parentLayout: "app/routes/dashboard.tsx", isLayout: true, isIndex: false },
      { file: "app/routes/dashboard._sidebar.stats.tsx", routePattern: "/dashboard/stats", exports: ["default" as const], parentLayout: "app/routes/dashboard._sidebar.tsx", isLayout: false, isIndex: false },
      { file: "app/routes/dashboard._sidebar.settings.tsx", routePattern: "/dashboard/settings", exports: ["default" as const], parentLayout: "app/routes/dashboard._sidebar.tsx", isLayout: false, isIndex: false },
    ];
    const tree = buildRouteTree(modules);
    expect(tree).toHaveLength(1);
    expect(tree[0].routePattern).toBe("/dashboard");
    // Children promoted from pathless _sidebar layout
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].routePattern).toBe("/dashboard/settings");
    expect(tree[0].children[1].routePattern).toBe("/dashboard/stats");
  });

  it("sorts children by route pattern", () => {
    const modules = [
      { file: "app/routes/z.tsx", routePattern: "/z", exports: ["default" as const], parentLayout: null, isLayout: false, isIndex: false },
      { file: "app/routes/a.tsx", routePattern: "/a", exports: ["default" as const], parentLayout: null, isLayout: false, isIndex: false },
      { file: "app/routes/m.tsx", routePattern: "/m", exports: ["default" as const], parentLayout: null, isLayout: false, isIndex: false },
    ];
    const tree = buildRouteTree(modules);
    expect(tree[0].routePattern).toBe("/a");
    expect(tree[1].routePattern).toBe("/m");
    expect(tree[2].routePattern).toBe("/z");
  });

  it("sorts nested children by route pattern", () => {
    const modules = [
      { file: "app/routes/users.tsx", routePattern: "/users", exports: ["default" as const], parentLayout: null, isLayout: false, isIndex: false },
      { file: "app/routes/users.profile.tsx", routePattern: "/users/profile", exports: ["default" as const], parentLayout: "app/routes/users.tsx", isLayout: false, isIndex: false },
      { file: "app/routes/users.admin.tsx", routePattern: "/users/admin", exports: ["default" as const], parentLayout: "app/routes/users.tsx", isLayout: false, isIndex: false },
      { file: "app/routes/about.tsx", routePattern: "/about", exports: ["default" as const], parentLayout: null, isLayout: false, isIndex: false },
    ];
    const tree = buildRouteTree(modules);
    // Root level sorted
    expect(tree[0].routePattern).toBe("/about");
    expect(tree[1].routePattern).toBe("/users");
    // Nested level sorted
    expect(tree[1].children[0].routePattern).toBe("/users/admin");
    expect(tree[1].children[1].routePattern).toBe("/users/profile");
  });
});

// ── analyzeComponents integration ───────────────────────────────────────────

describe("analyzeComponents", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("analyzes components and usages in a small project", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-comp-"));
    await mkdir(join(tmpDir, "src", "components"), { recursive: true });
    await mkdir(join(tmpDir, "src", "pages"), { recursive: true });

    // Component file
    await writeFile(
      join(tmpDir, "src", "components", "Button.tsx"),
      `export function Button() { return <button>click</button>; }\n`
    );

    // Page file that uses Button
    await writeFile(
      join(tmpDir, "src", "pages", "Home.tsx"),
      `import { Button } from "../components/Button.js";\nexport default function Home() { return <div><Button /><Button /></div>; }\n`
    );

    const inventory = await analyzeInventory(tmpDir);
    const imports = await analyzeImports(tmpDir, inventory);
    const components = await analyzeComponents(tmpDir, inventory, imports);

    // Should find 2 components: Button and Home
    expect(components.components).toHaveLength(2);
    expect(components.components.map((c) => c.name).sort()).toEqual(["Button", "Home"]);

    // Should find usage edge: Home → Button
    expect(components.usageEdges.length).toBeGreaterThanOrEqual(1);
    const edge = components.usageEdges.find((e) => e.componentName === "Button");
    expect(edge).toBeDefined();
    expect(edge!.from).toBe("src/pages/Home.tsx");
    expect(edge!.to).toBe("src/components/Button.tsx");
    expect(edge!.usageCount).toBe(2);

    // Summary
    expect(components.summary.totalComponents).toBe(2);
  });

  it("analyzes Remix-style route modules", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-remix-"));
    await mkdir(join(tmpDir, "app", "routes"), { recursive: true });

    // Index route
    await writeFile(
      join(tmpDir, "app", "routes", "_index.tsx"),
      `
        export function loader() { return null; }
        export function meta() { return [{ title: "Home" }]; }
        export default function Index() { return <main>Home</main>; }
      `
    );

    // Users route with dynamic segment
    await writeFile(
      join(tmpDir, "app", "routes", "users.$id.tsx"),
      `
        export function loader() { return null; }
        export function action() { return null; }
        export default function UserPage() { return <div>User</div>; }
      `
    );

    const inventory = await analyzeInventory(tmpDir);
    const imports = await analyzeImports(tmpDir, inventory);
    const components = await analyzeComponents(tmpDir, inventory, imports);

    // Route modules
    expect(components.routeModules).toHaveLength(2);

    const indexRoute = components.routeModules.find((m) => m.file.endsWith("_index.tsx"));
    expect(indexRoute).toBeDefined();
    expect(indexRoute!.routePattern).toBe("/");
    expect(indexRoute!.isIndex).toBe(true);
    expect(indexRoute!.exports).toContain("loader");
    expect(indexRoute!.exports).toContain("meta");
    expect(indexRoute!.exports).toContain("default");

    const userRoute = components.routeModules.find((m) => m.file.includes("users.$id"));
    expect(userRoute).toBeDefined();
    expect(userRoute!.routePattern).toBe("/users/:id");
    expect(userRoute!.exports).toContain("loader");
    expect(userRoute!.exports).toContain("action");

    // Summary
    expect(components.summary.totalRouteModules).toBe(2);
    expect(components.summary.routeConventions.loader).toBe(2);
  });
});

// ── parseRoutesConfig ───────────────────────────────────────────────────────

describe("parseRoutesConfig", () => {
  it("parses route() + index() basic config", () => {
    const source = `
      import { route, index } from "@react-router/dev/routes";
      export default [
        index("routes/home.tsx"),
        route("about", "routes/about.tsx"),
        route("users/:id", "routes/users/profile.tsx"),
      ];
    `;
    const result = parseRoutesConfig(source, "app");
    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);

    expect(result![0].file).toBe("app/routes/home.tsx");
    expect(result![0].routePattern).toBe("/");
    expect(result![0].isIndex).toBe(true);

    expect(result![1].file).toBe("app/routes/about.tsx");
    expect(result![1].routePattern).toBe("/about");
    expect(result![1].isIndex).toBe(false);

    expect(result![2].file).toBe("app/routes/users/profile.tsx");
    expect(result![2].routePattern).toBe("/users/:id");
  });

  it("parses layout() with nested children and sets parentLayout", () => {
    const source = `
      import { route, index, layout } from "@react-router/dev/routes";
      export default [
        layout("routes/layout.tsx", [
          index("routes/home.tsx"),
          route("settings", "routes/settings.tsx"),
        ]),
      ];
    `;
    const result = parseRoutesConfig(source, "app");
    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);

    // Layout itself
    expect(result![0].file).toBe("app/routes/layout.tsx");
    expect(result![0].isLayout).toBe(true);
    expect(result![0].routePattern).toBeNull();
    expect(result![0].parentLayout).toBeNull();

    // Children have parentLayout set to the layout file
    expect(result![1].file).toBe("app/routes/home.tsx");
    expect(result![1].parentLayout).toBe("app/routes/layout.tsx");
    expect(result![1].isIndex).toBe(true);

    expect(result![2].file).toBe("app/routes/settings.tsx");
    expect(result![2].parentLayout).toBe("app/routes/layout.tsx");
    expect(result![2].routePattern).toBe("/settings");
  });

  it("parses ...prefix() and prepends path to children", () => {
    const source = `
      import { route, index, prefix } from "@react-router/dev/routes";
      export default [
        ...prefix("api", [
          index("routes/api/index.tsx"),
          route("users", "routes/api/users.tsx"),
        ]),
      ];
    `;
    const result = parseRoutesConfig(source, "app");
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);

    expect(result![0].file).toBe("app/routes/api/index.tsx");
    expect(result![0].routePattern).toBe("/api");
    expect(result![0].isIndex).toBe(true);

    expect(result![1].file).toBe("app/routes/api/users.tsx");
    expect(result![1].routePattern).toBe("/api/users");
  });

  it("unwraps satisfies RouteConfig wrapper", () => {
    const source = `
      import type { RouteConfig } from "@react-router/dev/routes";
      import { route } from "@react-router/dev/routes";
      export default [
        route("home", "routes/home.tsx"),
      ] satisfies RouteConfig;
    `;
    const result = parseRoutesConfig(source, "app");
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].file).toBe("app/routes/home.tsx");
    expect(result![0].routePattern).toBe("/home");
  });

  it("returns null for flatRoutes() call", () => {
    const source = `
      import { flatRoutes } from "@react-router/fs-routes";
      export default flatRoutes();
    `;
    const result = parseRoutesConfig(source, "app");
    expect(result).toBeNull();
  });

  it("skips unparseable entries gracefully", () => {
    const source = `
      import { route } from "@react-router/dev/routes";
      const dynamic = createRoute("foo");
      export default [
        route("about", "routes/about.tsx"),
        dynamic,
        42,
        route("contact", "routes/contact.tsx"),
      ];
    `;
    const result = parseRoutesConfig(source, "app");
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].routePattern).toBe("/about");
    expect(result![1].routePattern).toBe("/contact");
  });

  it("returns null when no default export", () => {
    const source = `
      import { route } from "@react-router/dev/routes";
      export const routes = [route("about", "routes/about.tsx")];
    `;
    const result = parseRoutesConfig(source, "app");
    expect(result).toBeNull();
  });

  it("nests children of route() under the parent route", () => {
    const source = `
      import { route, index } from "@react-router/dev/routes";
      export default [
        route("users", "routes/users.tsx", [
          index("routes/users/index.tsx"),
          route(":id", "routes/users/profile.tsx"),
          route(":id/edit", "routes/users/edit.tsx"),
        ]),
        route("about", "routes/about.tsx"),
      ];
    `;
    const result = parseRoutesConfig(source, "app");
    expect(result).not.toBeNull();
    expect(result).toHaveLength(5);

    // Parent route
    expect(result![0].file).toBe("app/routes/users.tsx");
    expect(result![0].parentLayout).toBeNull();

    // Children have parentLayout set to the parent route file
    expect(result![1].file).toBe("app/routes/users/index.tsx");
    expect(result![1].parentLayout).toBe("app/routes/users.tsx");
    expect(result![1].isIndex).toBe(true);

    expect(result![2].file).toBe("app/routes/users/profile.tsx");
    expect(result![2].parentLayout).toBe("app/routes/users.tsx");
    expect(result![2].routePattern).toBe("/:id");

    expect(result![3].file).toBe("app/routes/users/edit.tsx");
    expect(result![3].parentLayout).toBe("app/routes/users.tsx");

    // Sibling is still at root
    expect(result![4].file).toBe("app/routes/about.tsx");
    expect(result![4].parentLayout).toBeNull();

    // Build tree to verify nesting
    const tree = buildRouteTree(result!);
    expect(tree).toHaveLength(2); // /users and /about at root
    const usersNode = tree.find((n) => n.routePattern === "/users");
    expect(usersNode).toBeDefined();
    expect(usersNode!.children).toHaveLength(3); // index + :id + :id/edit
  });

  it("handles configDir of . correctly", () => {
    const source = `
      import { route } from "@react-router/dev/routes";
      export default [route("home", "routes/home.tsx")];
    `;
    const result = parseRoutesConfig(source, ".");
    expect(result).not.toBeNull();
    expect(result![0].file).toBe("routes/home.tsx");
  });
});

// ── findRoutesConfig ────────────────────────────────────────────────────────

describe("findRoutesConfig", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("finds app/routes.ts first in priority order", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-rc-"));
    await mkdir(join(tmpDir, "app"), { recursive: true });
    await writeFile(join(tmpDir, "app", "routes.ts"), "export default [];");
    // Also create a src/routes.ts to verify priority
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src", "routes.ts"), "export default [];");

    const result = findRoutesConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.file).toBe("app/routes.ts");
    expect(result!.appDir).toBe("app");
  });

  it("falls back to src/routes.ts when app/ not present", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-rc-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src", "routes.ts"), "export default [];");

    const result = findRoutesConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.file).toBe("src/routes.ts");
    expect(result!.appDir).toBe("src");
  });

  it("finds routes.tsx variant", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-rc-"));
    await mkdir(join(tmpDir, "app"), { recursive: true });
    await writeFile(join(tmpDir, "app", "routes.tsx"), "export default [];");

    const result = findRoutesConfig(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.file).toBe("app/routes.tsx");
  });

  it("returns null when no routes config exists", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-rc-"));
    await mkdir(join(tmpDir, "app"), { recursive: true });

    const result = findRoutesConfig(tmpDir);
    expect(result).toBeNull();
  });
});
