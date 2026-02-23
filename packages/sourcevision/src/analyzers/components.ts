/**
 * Component & route analyzer.
 * Single AST pass over JSX/TSX files for component definitions,
 * JSX usage graph, and React Router v7 / Remix route detection.
 */

import { readFile } from "node:fs/promises";
import { join, relative, extname, basename } from "node:path";
import ts from "typescript";
import type {
  ComponentKind,
  ComponentDefinition,
  ComponentUsageEdge,
  RouteExportKind,
  RouteModule,
  RouteTreeNode,
  ServerRouteGroup,
  Components,
  ComponentsSummary,
  Inventory,
  Imports,
} from "../schema/index.js";
import { sortComponents } from "../util/sort.js";
import { toPosix } from "../util/paths.js";
import {
  ROUTE_EXPORT_NAMES,
  parseFileRoutePattern,
  buildRouteTree,
  findRoutesConfig,
  parseRoutesConfig,
  findRoutesDir,
} from "./route-detection.js";
import { detectServerRoutes } from "./server-route-detection.js";

const JSX_EXTENSIONS = new Set([".tsx", ".jsx"]);
const ALL_PARSEABLE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

// ── Helpers ─────────────────────────────────────────────────────────────────

function getScriptKind(filePath: string): ts.ScriptKind {
  const ext = extname(filePath);
  if (ext === ".tsx" || ext === ".jsx") return ts.ScriptKind.TSX;
  if (ext === ".ts") return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
}

function returnsJsx(node: ts.Node, sf: ts.SourceFile): boolean {
  let found = false;
  function walk(n: ts.Node) {
    if (found) return;
    if (
      ts.isJsxElement(n) ||
      ts.isJsxSelfClosingElement(n) ||
      ts.isJsxFragment(n)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  }
  walk(node);
  return found;
}

// ── extractComponentDefinitions ─────────────────────────────────────────────

export function extractComponentDefinitions(
  sourceText: string,
  filePath: string
): ComponentDefinition[] {
  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath)
  );

  const components: ComponentDefinition[] = [];

  // Track which declarations are default-exported
  let defaultExportedName: string | null = null;
  let hasDefaultExportDeclaration = false;

  // First pass: find default export identifier
  for (const stmt of sf.statements) {
    // export default function Foo() {}
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      hasDefaultExportDeclaration = true;
      if (stmt.name) {
        defaultExportedName = stmt.name.text;
      }
    }
    // export default class Foo {}
    if (
      ts.isClassDeclaration(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      hasDefaultExportDeclaration = true;
      if (stmt.name) {
        defaultExportedName = stmt.name.text;
      }
    }
    // export default Foo;
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      if (ts.isIdentifier(stmt.expression)) {
        defaultExportedName = stmt.expression.text;
      }
    }
  }

  // Track named exports
  const namedExports = new Set<string>();
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        namedExports.add(el.name.text);
      }
    }
  }

  function getModifiers(node: ts.Node): readonly ts.Modifier[] {
    if (ts.canHaveModifiers(node)) {
      return (ts.getModifiers(node) ?? []) as readonly ts.Modifier[];
    }
    return [];
  }

  function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return getModifiers(node).some((m) => m.kind === kind);
  }

  function isDefaultExport(name: string, node: ts.Node): boolean {
    if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
      return true;
    }
    return defaultExportedName === name;
  }

  function addComponent(
    name: string,
    kind: ComponentKind,
    line: number,
    node: ts.Node
  ) {
    const isDefault = isDefaultExport(name, node);
    components.push({
      file: filePath,
      name: isDefault && !isPascalCase(name) ? "default" : name,
      kind,
      line,
      isDefaultExport: isDefault,
      conventionExports: [],
    });
  }

  for (const stmt of sf.statements) {
    // function Foo() { return <div/> }
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      const name = stmt.name.text;
      if (isPascalCase(name) && returnsJsx(stmt.body, sf)) {
        const line = sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1;
        addComponent(name, "function", line, stmt);
      }
    }

    // const Foo = () => <div/>  or  const Foo = function() { return <div/> }
    // Also handles: export const Foo = ...
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const name = decl.name.text;
          if (!isPascalCase(name)) continue;

          let kind: ComponentKind | null = null;
          let bodyNode: ts.Node | null = null;

          if (ts.isArrowFunction(decl.initializer)) {
            kind = "arrow";
            bodyNode = decl.initializer.body;
          } else if (ts.isFunctionExpression(decl.initializer)) {
            kind = "function";
            bodyNode = decl.initializer.body;
          } else if (ts.isCallExpression(decl.initializer)) {
            // React.forwardRef(() => <div/>)  or  forwardRef(() => <div/>)
            const callee = decl.initializer.expression;
            const isForwardRef =
              (ts.isIdentifier(callee) && callee.text === "forwardRef") ||
              (ts.isPropertyAccessExpression(callee) &&
                ts.isIdentifier(callee.name) &&
                callee.name.text === "forwardRef");

            if (isForwardRef && decl.initializer.arguments.length > 0) {
              const arg = decl.initializer.arguments[0];
              if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
                kind = "forwardRef";
                bodyNode = arg.body;
              }
            }
          }

          if (kind && bodyNode && returnsJsx(bodyNode, sf)) {
            const line =
              sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1;
            addComponent(name, kind, line, stmt);
          }
        }
      }
    }

    // class Foo extends Component { render() { return <div/> } }
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const name = stmt.name.text;
      if (!isPascalCase(name)) continue;

      // Check if extends React.Component or Component
      if (stmt.heritageClauses) {
        for (const clause of stmt.heritageClauses) {
          if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
            for (const type of clause.types) {
              const expr = type.expression;
              const isComponent =
                (ts.isIdentifier(expr) &&
                  (expr.text === "Component" ||
                    expr.text === "PureComponent")) ||
                (ts.isPropertyAccessExpression(expr) &&
                  ts.isIdentifier(expr.name) &&
                  (expr.name.text === "Component" ||
                    expr.name.text === "PureComponent"));

              if (isComponent) {
                // Check for render method returning JSX
                for (const member of stmt.members) {
                  if (
                    ts.isMethodDeclaration(member) &&
                    ts.isIdentifier(member.name) &&
                    member.name.text === "render" &&
                    member.body &&
                    returnsJsx(member.body, sf)
                  ) {
                    const line =
                      sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1;
                    addComponent(name, "class", line, stmt);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return components;
}

// ── extractJsxUsages ────────────────────────────────────────────────────────

/** Names that represent React fragments, not real component usages. */
const FRAGMENT_NAMES = new Set(["Fragment", "React.Fragment"]);

export function extractJsxUsages(
  sourceText: string,
  filePath: string
): Array<{ componentName: string; count: number }> {
  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath)
  );

  const counts = new Map<string, number>();

  /** Recursively build a dotted name from a property access chain. */
  function resolveTagName(expr: ts.JsxTagNameExpression): string | null {
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr)) {
      const left = resolveTagName(expr.expression as ts.JsxTagNameExpression);
      if (left === null) return null;
      return `${left}.${expr.name.text}`;
    }
    return null;
  }

  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = resolveTagName(node.tagName);
      // Skip lowercase (HTML elements), null, and React fragments
      if (name && /^[A-Z]/.test(name) && !FRAGMENT_NAMES.has(name)) {
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);

  return Array.from(counts.entries())
    .map(([componentName, count]) => ({ componentName, count }))
    .sort((a, b) => b.count - a.count);
}

// ── extractConventionExports ────────────────────────────────────────────────

export function extractConventionExports(
  sourceText: string,
  filePath: string
): RouteExportKind[] {
  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath)
  );

  const exports: RouteExportKind[] = [];

  function stmtHasModifier(node: ts.Statement, kind: ts.SyntaxKind): boolean {
    if (ts.canHaveModifiers(node)) {
      return (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
    }
    return false;
  }

  for (const stmt of sf.statements) {
    // Handle export declarations (export { loader } from "...") or (export { loader })
    if (ts.isExportDeclaration(stmt)) {
      // export { default } from "./component.js"
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const exportedName = el.name.text;
          if (exportedName === "default") {
            exports.push("default");
          } else if (ROUTE_EXPORT_NAMES.has(exportedName)) {
            exports.push(exportedName as RouteExportKind);
          }
        }
      }
      continue;
    }

    const isExported = stmtHasModifier(stmt, ts.SyntaxKind.ExportKeyword);
    if (!isExported) continue;

    const isDefault = stmtHasModifier(stmt, ts.SyntaxKind.DefaultKeyword);

    if (isDefault) {
      exports.push("default");
      continue;
    }

    // export function loader() {}
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const name = stmt.name.text;
      if (ROUTE_EXPORT_NAMES.has(name)) {
        exports.push(name as RouteExportKind);
      }
    }

    // export const loader = () => {}
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          if (ROUTE_EXPORT_NAMES.has(name)) {
            exports.push(name as RouteExportKind);
          }
        }
      }
    }

    // export class ErrorBoundary {}
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const name = stmt.name.text;
      if (ROUTE_EXPORT_NAMES.has(name)) {
        exports.push(name as RouteExportKind);
      }
    }
  }

  return exports;
}

// ── analyzeComponents helpers ────────────────────────────────────────────────

function resolveUsageEdges(
  allUsages: Array<{ file: string; componentName: string; count: number }>,
  importMap: Map<string, Map<string, string>>,
): ComponentUsageEdge[] {
  const edgeMap = new Map<string, ComponentUsageEdge>();
  for (const usage of allUsages) {
    const fileImports = importMap.get(usage.file);
    if (!fileImports) continue;

    const sourceFile = fileImports.get(usage.componentName);
    if (!sourceFile) continue;

    const key = `${usage.file}\0${sourceFile}\0${usage.componentName}`;
    const existing = edgeMap.get(key);
    if (existing) {
      edgeMap.set(key, {
        ...existing,
        usageCount: existing.usageCount + usage.count,
      });
    } else {
      edgeMap.set(key, {
        from: usage.file,
        to: sourceFile,
        componentName: usage.componentName,
        usageCount: usage.count,
      });
    }
  }
  return Array.from(edgeMap.values());
}

interface RouteDetectionResult {
  routeModules: RouteModule[];
  routeTree: RouteTreeNode[];
}

async function detectRoutes(
  targetDir: string,
  inventory: Inventory,
  allComponents: ComponentDefinition[],
  canIncremental: boolean | "" | undefined,
  changedFiles: Set<string> | undefined,
  prevRouteModules: RouteModule[] | undefined,
): Promise<RouteDetectionResult> {
  const routeModules: RouteModule[] = [];

  // Build a set of previous route files for incremental reuse
  const prevRouteMap = new Map<string, RouteModule>();
  if (canIncremental && prevRouteModules) {
    for (const mod of prevRouteModules) {
      prevRouteMap.set(mod.file, mod);
    }
  }

  // Try config-based routing first (React Router v7 routes.ts)
  let usedConfigRoutes = false;
  const routesConfig = findRoutesConfig(targetDir);
  if (routesConfig) {
    const configFullPath = join(targetDir, routesConfig.file);
    let configSource: string | null = null;
    try {
      configSource = await readFile(configFullPath, "utf-8");
    } catch {
      // Can't read config — fall through to file-based
    }

    if (configSource) {
      const configRoutes = parseRoutesConfig(configSource, routesConfig.appDir);
      if (configRoutes) {
        usedConfigRoutes = true;

        for (const mod of configRoutes) {
          if (canIncremental && changedFiles && !changedFiles.has(mod.file) && prevRouteMap.has(mod.file)) {
            const prevMod = prevRouteMap.get(mod.file)!;
            routeModules.push(prevMod);
            const conventionNames = prevMod.exports.filter((e) => e !== "default");
            const compDefs = allComponents.filter((c) => c.file === mod.file);
            for (const def of compDefs) {
              def.conventionExports = conventionNames;
            }
            continue;
          }

          const routeFullPath = join(targetDir, mod.file);
          let routeSource: string;
          try {
            routeSource = await readFile(routeFullPath, "utf-8");
          } catch {
            routeModules.push(mod);
            continue;
          }

          const conventionExports = extractConventionExports(routeSource, mod.file);
          routeModules.push({
            ...mod,
            exports: conventionExports,
          });

          const compDefs = allComponents.filter((c) => c.file === mod.file);
          const conventionNames = conventionExports.filter((e) => e !== "default");
          for (const def of compDefs) {
            def.conventionExports = conventionNames;
          }
        }
      }
    }
  }

  // Fall back to file-based route detection
  if (!usedConfigRoutes) {
    const routesDir = findRoutesDir(
      targetDir,
      inventory.files.map((f) => f.path)
    );

    if (routesDir) {
      const routeFiles = inventory.files.filter((f) =>
        f.path.startsWith(routesDir + "/") && f.role !== "test"
      );

      for (const file of routeFiles) {
        if (canIncremental && changedFiles && !changedFiles.has(file.path) && prevRouteMap.has(file.path)) {
          const prevMod = prevRouteMap.get(file.path)!;
          routeModules.push(prevMod);

          const conventionNames = prevMod.exports.filter((e) => e !== "default");
          const compDefs = allComponents.filter((c) => c.file === file.path);
          for (const def of compDefs) {
            def.conventionExports = conventionNames;
          }
          continue;
        }

        const fullPath = join(targetDir, file.path);
        let sourceText: string;
        try {
          sourceText = await readFile(fullPath, "utf-8");
        } catch {
          continue;
        }

        const conventionExports = extractConventionExports(sourceText, file.path);
        const routePattern = parseFileRoutePattern(file.path, routesDir);

        const relToRoutes = toPosix(relative(routesDir, file.path));
        const dotSegments = relToRoutes.replace(extname(relToRoutes), "").split(".");
        let parentLayout: string | null = null;
        let isLayout = false;
        const isIndex = basename(file.path, extname(file.path)).endsWith("_index") ||
                        basename(file.path, extname(file.path)) === "index";

        if (dotSegments.length > 1) {
          const layoutPrefix = dotSegments[0];
          if (layoutPrefix.startsWith("_")) {
            const layoutFile = routeFiles.find((f) => {
              const fRel = toPosix(relative(routesDir, f.path));
              const fBase = fRel.replace(extname(fRel), "");
              return fBase === layoutPrefix;
            });
            if (layoutFile) {
              parentLayout = layoutFile.path;
            }
          }
        }

        if (dotSegments[0].startsWith("_") && dotSegments.length === 1) {
          isLayout = true;
        }

        const compDefs = allComponents.filter((c) => c.file === file.path);
        const conventionNames = conventionExports.filter((e) => e !== "default");
        for (const def of compDefs) {
          def.conventionExports = conventionNames;
        }

        routeModules.push({
          file: file.path,
          routePattern,
          exports: conventionExports,
          parentLayout,
          isLayout,
          isIndex,
        });
      }

      // Second pass: mark files as layouts if they are referenced as parentLayout
      const parentFiles = new Set(
        routeModules.filter((m) => m.parentLayout).map((m) => m.parentLayout!)
      );
      for (const mod of routeModules) {
        if (parentFiles.has(mod.file)) {
          mod.isLayout = true;
        }
      }
    }
  }

  const routeTree = buildRouteTree(routeModules);
  return { routeModules, routeTree };
}

function computeComponentsSummary(
  allComponents: ComponentDefinition[],
  usageEdges: ComponentUsageEdge[],
  routeModules: RouteModule[],
  routeTree: RouteTreeNode[],
  serverRoutes: ServerRouteGroup[],
): ComponentsSummary {
  const usageCounts = new Map<string, { name: string; file: string; count: number }>();
  for (const edge of usageEdges) {
    const key = `${edge.to}\0${edge.componentName}`;
    const existing = usageCounts.get(key);
    if (existing) {
      existing.count += edge.usageCount;
    } else {
      usageCounts.set(key, {
        name: edge.componentName,
        file: edge.to,
        count: edge.usageCount,
      });
    }
  }

  const mostUsedComponents = Array.from(usageCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map((c) => ({ name: c.name, file: c.file, usageCount: c.count }));

  const routeConventions: Partial<Record<RouteExportKind, number>> = {};
  for (const mod of routeModules) {
    for (const exp of mod.exports) {
      routeConventions[exp] = (routeConventions[exp] || 0) + 1;
    }
  }

  function measureDepth(nodes: RouteTreeNode[]): number {
    if (nodes.length === 0) return 0;
    return 1 + Math.max(...nodes.map((n) => measureDepth(n.children)));
  }
  const layoutDepth = measureDepth(routeTree);

  const totalServerRoutes = serverRoutes.reduce((sum, g) => sum + g.routes.length, 0);

  return {
    totalComponents: allComponents.length,
    totalRouteModules: routeModules.length,
    totalUsageEdges: usageEdges.length,
    totalServerRoutes,
    routeConventions,
    mostUsedComponents,
    layoutDepth,
  };
}

// ── analyzeComponents ───────────────────────────────────────────────────────

// ── Incremental types ────────────────────────────────────────────────────────

export interface ComponentsOptions {
  previousComponents?: Components;
  changedFiles?: Set<string>;
  fileSetChanged?: boolean;
}

export async function analyzeComponents(
  targetDir: string,
  inventory: Inventory,
  imports: Imports,
  options?: ComponentsOptions
): Promise<Components> {
  const prev = options?.previousComponents;
  const changedFiles = options?.changedFiles;
  const fileSetChanged = options?.fileSetChanged ?? true;
  const canIncremental = prev && changedFiles && !fileSetChanged;

  const allComponents: ComponentDefinition[] = [];
  const allUsages: Array<{ file: string; componentName: string; count: number }> = [];

  // Build import resolution map: file → { importedName → sourceFile }
  const importMap = new Map<string, Map<string, string>>();
  for (const edge of imports.edges) {
    if (!importMap.has(edge.from)) importMap.set(edge.from, new Map());
    const fileImports = importMap.get(edge.from)!;
    for (const sym of edge.symbols) {
      fileImports.set(sym, edge.to);
    }
  }

  // Track which files define which components (by name)
  const componentFileMap = new Map<string, Map<string, string>>(); // componentName → file → file

  // Incremental: keep definitions and usages from unchanged files
  if (canIncremental) {
    for (const def of prev.components) {
      if (!changedFiles.has(def.file)) {
        allComponents.push(def);
        if (!componentFileMap.has(def.name)) {
          componentFileMap.set(def.name, new Map());
        }
        componentFileMap.get(def.name)!.set(def.file, def.file);
      }
    }
    for (const edge of prev.usageEdges) {
      if (!changedFiles.has(edge.from)) {
        allUsages.push({
          file: edge.from,
          componentName: edge.componentName,
          count: edge.usageCount,
        });
      }
    }
  }

  // Parse files (all in full mode, only changed in incremental mode)
  const parseableFiles = inventory.files.filter((f) => {
    const ext = extname(f.path).toLowerCase();
    if (!ALL_PARSEABLE.has(ext)) return false;
    if (canIncremental) return changedFiles.has(f.path);
    return true;
  });

  for (const file of parseableFiles) {
    const fullPath = join(targetDir, file.path);
    let sourceText: string;
    try {
      sourceText = await readFile(fullPath, "utf-8");
    } catch {
      continue;
    }

    const ext = extname(file.path).toLowerCase();
    const isJsx = JSX_EXTENSIONS.has(ext);

    // Extract components (JSX files only for actual component detection,
    // but we can check any file for convention exports)
    if (isJsx) {
      const defs = extractComponentDefinitions(sourceText, file.path);
      for (const def of defs) {
        allComponents.push(def);
        // Track by name for usage resolution
        if (!componentFileMap.has(def.name)) {
          componentFileMap.set(def.name, new Map());
        }
        componentFileMap.get(def.name)!.set(file.path, file.path);
      }

      // Extract JSX usages
      const usages = extractJsxUsages(sourceText, file.path);
      for (const usage of usages) {
        allUsages.push({
          file: file.path,
          componentName: usage.componentName,
          count: usage.count,
        });
      }
    }

    // Also check .ts files for components (rare but possible with createElement)
    // and .tsx convention exports
  }

  const usageEdges = resolveUsageEdges(allUsages, importMap);

  const { routeModules, routeTree } = await detectRoutes(
    targetDir,
    inventory,
    allComponents,
    canIncremental,
    changedFiles,
    prev?.routeModules,
  );

  // ── Server-side API route detection ────────────────────────────────────────

  const serverRoutes: ServerRouteGroup[] = await detectServerRoutes(targetDir, inventory);

  const summary = computeComponentsSummary(
    allComponents,
    usageEdges,
    routeModules,
    routeTree,
    serverRoutes,
  );

  return sortComponents({
    components: allComponents,
    usageEdges,
    routeModules,
    routeTree,
    serverRoutes,
    summary,
  });
}
