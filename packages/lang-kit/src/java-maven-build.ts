/**
 * Maven build model: dependencies, versions, Java and Spring Boot versions
 * from `pom.xml`. Poms are parsed as XML, never with regular expressions, and
 * Maven is never run.
 *
 * Inheritance and BOM imports are followed only inside the repository. A
 * parent or BOM that is not in the repository would need the network, so any
 * version that depends on it is reported unresolved with the source named,
 * not guessed. Property placeholders resolve through the module's own and its
 * in-repository parents' properties (a child overrides its parent, as Maven
 * interpolates the effective model).
 *
 * @module lang-kit/java-maven-build
 */

import { join, posix } from "node:path";
import { oversizedNotice, readBuildFile } from "./build-file.js";
import type { BuildDependency, BuildValue, ModuleBuildModel } from "./build-model.js";
import type { JavaModule } from "./java-modules.js";
import { child, childText, childrenNamed, parseXml, XmlSyntaxError, type XmlElement } from "./xml-lite.js";

const SPRING_BOOT_GROUP = "org.springframework.boot";
const SPRING_BOOT_PARENT = "spring-boot-starter-parent";
const SPRING_BOOT_BOM = "spring-boot-dependencies";
/** Properties that declare the Java level, strongest first. */
const JAVA_VERSION_PROPERTIES = ["maven.compiler.release", "maven.compiler.source", "java.version"];

interface RawDep {
  group: string;
  artifact: string;
  version?: string;
  scope?: string;
  type?: string;
  classifier?: string;
}

interface PomFile {
  dir: string;
  group?: string;
  artifact: string;
  version?: string;
  parent?: RawDep & { relativePath?: string };
  props: Map<string, string>;
  managed: RawDep[];
  deps: RawDep[];
}

/** A managed version: raw text to interpolate in the consumer, or already resolved in its own BOM. */
interface Managed {
  raw?: string;
  fixed?: BuildValue;
  scope?: string;
}

interface Effective {
  props: Map<string, string>;
  managed: Map<string, Managed>;
  deps: Map<string, RawDep>;
  /** Out-of-repository parents and BOMs, as `g:a:v`. */
  external: string[];
  springBoot?: BuildValue;
  notices: string[];
}

/** Build models for the Maven `modules` of a project, in the order given. */
export async function readMavenBuildModels(
  projectDir: string,
  modules: readonly JavaModule[],
): Promise<ModuleBuildModel[]> {
  const reader = new MavenReader(projectDir);
  // Every module pom is loaded before any model is built: a BOM import is matched by
  // coordinates among loaded poms, so a BOM listed after its importer would read as external.
  for (const m of modules) await reader.load(m.dir);
  const models: ModuleBuildModel[] = [];
  for (const m of modules) models.push(await reader.model(m));
  return models;
}

class MavenReader {
  private readonly poms = new Map<string, PomFile | string>(); // dir → pom, or the reason it is unreadable
  private readonly effectives = new Map<string, Effective>();
  private readonly visiting = new Set<string>();

  constructor(private readonly projectDir: string) {}

  async model(module: JavaModule): Promise<ModuleBuildModel> {
    const pom = await this.load(module.dir);
    const base = { module: module.name, dir: module.dir, buildSystem: "maven" as const };
    if (typeof pom === "string") return { ...base, dependencies: [], notices: [pom] };

    const eff = await this.effective(pom);
    const ctx = this.context(pom, eff);
    const group = pom.group ?? pom.parent?.group;
    const version = pom.version ?? pom.parent?.version;
    const javaProp = JAVA_VERSION_PROPERTIES.find((p) => eff.props.has(p));

    return {
      ...base,
      ...(group !== undefined && { group: interpolate(group, ctx) }),
      ...(version !== undefined && { version: interpolate(version, ctx) }),
      dependencies: this.dependencies(eff, ctx),
      ...(javaProp && { javaVersion: interpolate(eff.props.get(javaProp)!, ctx) }),
      ...(eff.springBoot && { springBootVersion: eff.springBoot }),
      notices: eff.notices,
    };
  }

  private dependencies(eff: Effective, ctx: Context): BuildDependency[] {
    const out: BuildDependency[] = [];
    for (const dep of eff.deps.values()) {
      const group = textOf(interpolate(dep.group, ctx), dep.group);
      const artifact = textOf(interpolate(dep.artifact, ctx), dep.artifact);
      const type = dep.type ?? "jar";
      const classifier = effectiveClassifier(type, dep.classifier);
      const managed = eff.managed.get(mavenKey(group, artifact, type, classifier));
      out.push({
        group,
        artifact,
        ...(type !== "jar" && { type }),
        ...(classifier !== undefined && { classifier }),
        version: dep.version !== undefined ? interpolate(dep.version, ctx) : this.managedVersion(managed, eff, ctx),
        scope: dep.scope ?? managed?.scope ?? "compile",
      });
    }
    return out.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  }

  private managedVersion(managed: Managed | undefined, eff: Effective, ctx: Context): BuildValue {
    if (managed?.fixed) return managed.fixed;
    if (managed?.raw !== undefined) return interpolate(managed.raw, ctx);
    return eff.external.length
      ? { resolved: false, reason: `managed outside the repository by ${eff.external.join(", ")}` }
      : { resolved: false, reason: "no version declared and none managed in the repository" };
  }

  // ── Loading ────────────────────────────────────────────────────────────

  async load(dir: string): Promise<PomFile | string> {
    const cached = this.poms.get(dir);
    if (cached !== undefined) return cached;
    const path = join(this.projectDir, dir, "pom.xml");
    let result: PomFile | string;
    try {
      const text = await readBuildFile(path);
      result =
        typeof text === "string"
          ? toPom(dir, parseXml(text))
          : oversizedNotice(posix.join(dir, "pom.xml"), text.oversized);
    } catch (err) {
      if (err instanceof XmlSyntaxError) result = `${posix.join(dir, "pom.xml")} is not valid XML: ${err.message}`;
      else if ((err as NodeJS.ErrnoException).code === "ENOENT") result = `${posix.join(dir, "pom.xml")} not found`;
      else throw err;
    }
    this.poms.set(dir, result);
    return result;
  }

  /** The in-repository pom a `<parent>` names: via `relativePath` (default `../pom.xml`), coordinates checked. */
  private async findParent(pom: PomFile): Promise<PomFile | undefined> {
    const parent = pom.parent;
    if (!parent || parent.relativePath === "") return undefined;
    const target = posix.normalize(posix.join(pom.dir, parent.relativePath ?? "../pom.xml"));
    const dir = target.endsWith(".xml") ? posix.dirname(target) : target;
    if (dir === ".." || dir.startsWith("../") || posix.isAbsolute(dir)) return undefined;
    const found = await this.load(dir === "." ? "" : dir);
    if (typeof found === "string") return undefined;
    const sameGroup = (found.group ?? found.parent?.group) === parent.group;
    return found.artifact === parent.artifact && sameGroup ? found : undefined;
  }

  /** An in-repository pom by coordinates, among the poms already loaded. */
  private byCoordinates(group: string, artifact: string): PomFile | undefined {
    for (const pom of this.poms.values()) {
      if (typeof pom !== "string" && pom.artifact === artifact && (pom.group ?? pom.parent?.group) === group) return pom;
    }
    return undefined;
  }

  // ── Inheritance ────────────────────────────────────────────────────────

  private async effective(pom: PomFile): Promise<Effective> {
    const cached = this.effectives.get(pom.dir);
    if (cached) return cached;
    if (this.visiting.has(pom.dir)) {
      return { ...emptyEffective(), notices: [`${posix.join(pom.dir, "pom.xml")} is its own ancestor`] };
    }
    this.visiting.add(pom.dir);

    const inherited = await this.inherit(pom);
    const eff: Effective = {
      props: new Map([...inherited.props, ...pom.props]),
      managed: new Map(inherited.managed),
      deps: new Map(inherited.deps),
      external: [...inherited.external],
      springBoot: inherited.springBoot,
      notices: [...inherited.notices],
    };
    const ctx = this.context(pom, eff);

    if (pom.parent && isSpringBootParent(pom.parent)) {
      eff.springBoot = interpolate(pom.parent.version ?? "", ctx);
    }
    for (const m of pom.managed) {
      if (!isBomImport(m)) eff.managed.set(depKey(m, ctx), managedEntry(m));
    }
    for (const bom of pom.managed.filter(isBomImport)) await this.importBom(bom, eff, ctx);
    for (const d of pom.deps) eff.deps.set(depKey(d, ctx), d);

    this.visiting.delete(pom.dir);
    this.effectives.set(pom.dir, eff);
    return eff;
  }

  private async inherit(pom: PomFile): Promise<Effective> {
    if (!pom.parent) return emptyEffective();
    const parent = await this.findParent(pom);
    if (parent) return this.effective(parent);
    const out = emptyEffective();
    out.external.push(coordinates(pom.parent));
    return out;
  }

  /** Apply a `scope=import` BOM: in-repository ones contribute their managed versions, others are recorded. */
  private async importBom(bom: RawDep, eff: Effective, ctx: Context): Promise<void> {
    const group = textOf(interpolate(bom.group, ctx), bom.group);
    const artifact = textOf(interpolate(bom.artifact, ctx), bom.artifact);
    const version = interpolate(bom.version ?? "", ctx);
    const local = this.byCoordinates(group, artifact);
    if (local) {
      const imported = await this.effective(local);
      // Interpolated in the BOM's own context: its properties, not the importer's.
      const bomCtx = this.context(local, imported);
      for (const [key, m] of imported.managed) {
        if (eff.managed.has(key)) continue; // explicit entries and earlier imports win
        eff.managed.set(key, { ...m, fixed: m.fixed ?? (m.raw !== undefined ? interpolate(m.raw, bomCtx) : undefined) });
      }
      eff.external.push(...imported.external.filter((e) => !eff.external.includes(e)));
      if (!eff.springBoot && imported.springBoot) eff.springBoot = imported.springBoot;
    } else {
      eff.external.push(`${group}:${artifact}:${version.resolved ? version.value : "?"}`);
    }
    if (group === SPRING_BOOT_GROUP && artifact === SPRING_BOOT_BOM) eff.springBoot = version;
  }

  private context(pom: PomFile, eff: Effective): Context {
    const builtins = new Map<string, string>();
    const set = (names: string[], value: string | undefined): void => {
      if (value !== undefined) for (const n of names) builtins.set(n, value);
    };
    set(["project.version", "pom.version", "version"], pom.version ?? pom.parent?.version);
    set(["project.groupId", "pom.groupId", "groupId"], pom.group ?? pom.parent?.group);
    set(["project.artifactId", "pom.artifactId", "artifactId"], pom.artifact);
    set(["project.parent.version", "parent.version"], pom.parent?.version);
    set(["project.parent.groupId", "parent.groupId"], pom.parent?.group);
    return { props: eff.props, builtins, external: eff.external };
  }
}

// ── Pom → raw data ───────────────────────────────────────────────────────

function toPom(dir: string, project: XmlElement): PomFile {
  if (project.name !== "project") throw new XmlSyntaxError(`Root element is <${project.name}>, not <project>`, 0);
  const parentEl = child(project, "parent");
  const props = new Map<string, string>();
  for (const p of child(project, "properties")?.children ?? []) props.set(p.name, p.text.trim());
  return {
    dir,
    group: childText(project, "groupId"),
    artifact: childText(project, "artifactId") ?? "",
    version: childText(project, "version"),
    parent: parentEl && {
      ...rawDep(parentEl),
      relativePath: child(parentEl, "relativePath") ? (childText(parentEl, "relativePath") ?? "") : undefined,
    },
    props,
    managed: depsOf(childPath(project, "dependencyManagement", "dependencies")),
    deps: depsOf(child(project, "dependencies")),
  };
}

function childPath(el: XmlElement, ...names: string[]): XmlElement | undefined {
  let current: XmlElement | undefined = el;
  for (const name of names) current = current && child(current, name);
  return current;
}

function depsOf(container: XmlElement | undefined): RawDep[] {
  return container ? childrenNamed(container, "dependency").map(rawDep) : [];
}

function rawDep(el: XmlElement): RawDep {
  return {
    group: childText(el, "groupId") ?? "",
    artifact: childText(el, "artifactId") ?? "",
    version: childText(el, "version"),
    scope: childText(el, "scope"),
    type: childText(el, "type"),
    classifier: childText(el, "classifier"),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface Context {
  props: ReadonlyMap<string, string>;
  builtins: ReadonlyMap<string, string>;
  external: readonly string[];
}

function emptyEffective(): Effective {
  return { props: new Map(), managed: new Map(), deps: new Map(), external: [], notices: [] };
}

function isBomImport(d: RawDep): boolean {
  return d.scope === "import" && d.type === "pom";
}

function isSpringBootParent(p: RawDep): boolean {
  return p.group === SPRING_BOOT_GROUP && p.artifact === SPRING_BOOT_PARENT;
}

function coordinates(d: RawDep): string {
  return `${d.group}:${d.artifact}:${d.version ?? "?"}`;
}

/** Maven's management key: `group:artifact:type:classifier`, with no classifier as the empty string. */
function mavenKey(group: string, artifact: string, type: string, classifier: string | undefined): string {
  return `${group}:${artifact}:${type}:${classifier ?? ""}`;
}

/** A `test-jar` is the `tests` classifier unless one is declared. */
function effectiveClassifier(type: string, declared: string | undefined): string | undefined {
  return declared ?? (type === "test-jar" ? "tests" : undefined);
}

/** The management key of a declared dependency or managed entry. */
function depKey(d: RawDep, ctx: Context): string {
  const type = d.type ?? "jar";
  return mavenKey(
    textOf(interpolate(d.group, ctx), d.group),
    textOf(interpolate(d.artifact, ctx), d.artifact),
    type,
    effectiveClassifier(type, d.classifier),
  );
}

function sortKey(d: BuildDependency): string {
  return `${d.group}:${d.artifact}:${d.type ?? "jar"}:${d.classifier ?? ""}`;
}

function managedEntry(d: RawDep): Managed {
  return { raw: d.version, scope: d.scope };
}

/** The resolved text, or `fallback` (the raw placeholder text) when unresolved. */
function textOf(value: BuildValue, fallback: string): string {
  return value.resolved ? value.value : fallback;
}

/**
 * Replace every `${name}` in `text`. Built-ins (`project.version`, …) are
 * consulted first, then properties. A name found nowhere makes the whole
 * value unresolved; when an out-of-repository parent or BOM exists the reason
 * names it, since the property may be defined there.
 */
function interpolate(text: string, ctx: Context, seen: ReadonlySet<string> = new Set()): BuildValue {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("${", i);
    if (open < 0) return { resolved: true, value: out + text.slice(i) };
    const close = text.indexOf("}", open);
    if (close < 0) return { resolved: false, reason: `unterminated placeholder in "${text}"` };
    out += text.slice(i, open);
    const name = text.slice(open + 2, close);

    const raw = ctx.builtins.get(name) ?? ctx.props.get(name);
    if (raw === undefined) {
      const hint = ctx.external.length ? `; may be defined by ${ctx.external.join(", ")}` : "";
      return { resolved: false, reason: `property ${name} is not defined in the repository${hint}` };
    }
    if (seen.has(name)) return { resolved: false, reason: `property ${name} refers to itself` };
    const value = interpolate(raw, ctx, new Set([...seen, name]));
    if (!value.resolved) return value;
    out += value.value;
    i = close + 1;
  }
  return { resolved: true, value: out };
}
