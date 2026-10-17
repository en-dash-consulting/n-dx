/**
 * Gradle build model: dependencies, plugins, Java and Spring Boot versions
 * from `build.gradle`, `build.gradle.kts` and `gradle/*.versions.toml`.
 * Gradle is never run.
 *
 * Two kinds of source, two levels of trust:
 *  - A version catalog is data and is read exactly; `libs.x.y` references in a
 *    script resolve through it and carry no flag.
 *  - A build script is a program. Literals read from it are marked
 *    `bestEffort`; anything computed at build time (variables, interpolation,
 *    conditionals, `buildSrc` logic) is left unresolved with the expression
 *    named, never guessed. Only top-level `plugins`, `dependencies`, `java`
 *    and `kotlin` blocks are read, so a value inside `if`, `subprojects` or
 *    `allprojects` is absent rather than approximated.
 *
 * @module lang-kit/java-gradle-build
 */

import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import type { BuildDependency, BuildValue, ModuleBuildModel, ProjectDependency } from "./build-model.js";
import {
  readVersionCatalogs,
  resolveCatalogRef,
  type CatalogLibrary,
  type VersionCatalog,
} from "./gradle-catalog.js";
import { GradleScript, leadingStringLiteral, stringLiteral, type Span } from "./gradle-script.js";
import { GRADLE_BUILD, type JavaModule } from "./java-modules.js";

const BOOT_GROUP = "org.springframework.boot";
const BOOT_PLUGIN = "org.springframework.boot";
const BOOT_GRADLE_PLUGIN = "spring-boot-gradle-plugin";
const BOOT_BOM = "spring-boot-dependencies";
const NO_VERSION = "no version in the script; a plugin or platform may manage it";
/** Dependency-block statements that name no external coordinate. */
const NON_COORDINATE = /^(?:project|files|fileTree|gradleApi|localGroovy|gradleTestKit|kotlin|testFixtures)\b/;
/** Statement heads that are declarations or control flow, not configurations. */
/** A plugin declaration's trailing `apply false` / `.apply(false)`. */
const APPLY_TAIL = /(?:\.\s*apply\s*\(\s*\w+\s*\)|\s+apply\s+\w+)\s*$/;
const LEVEL_WRAPPER =/^(?:JavaLanguageVersion\.of|JavaVersion\.toVersion)\(([\s\S]*)\)$/;
const NOT_A_CONFIGURATION =new Set(["val", "var", "def", "if", "else", "for", "while", "when", "try", "return"]);

interface PluginUse {
  id: string;
  version?: BuildValue;
}

interface ScriptFacts {
  plugins: PluginUse[];
  /** `buildscript { dependencies { classpath … } }` entries. */
  classpath: BuildDependency[];
  dependencies: BuildDependency[];
  /** `project(…)` dependencies of the top-level `dependencies` blocks. */
  projects: ProjectDependency[];
  group?: BuildValue;
  version?: BuildValue;
  javaVersion?: BuildValue;
  notices: string[];
}

/** Build models for the Gradle `modules` of a project, in the order given. */
export async function readGradleBuildModels(
  projectDir: string,
  modules: readonly JavaModule[],
): Promise<ModuleBuildModel[]> {
  const { catalogs, notices: catalogNotices } = await readVersionCatalogs(projectDir);
  const facts = new Map<string, ScriptFacts>();
  for (const m of modules) facts.set(m.dir, await readModuleScript(projectDir, m.dir, catalogs));
  const root = facts.get("");

  return modules.map((m) => {
    const f = facts.get(m.dir)!;
    const springBoot = springBootVersion(f, m.dir === "" ? undefined : root);
    return {
      module: m.name,
      dir: m.dir,
      buildSystem: "gradle" as const,
      ...(f.group && { group: f.group }),
      ...(f.version && { version: f.version }),
      dependencies: f.dependencies,
      ...(f.projects.length > 0 && { projects: f.projects }),
      ...(f.javaVersion && { javaVersion: f.javaVersion }),
      ...(springBoot && { springBootVersion: springBoot }),
      notices: m.dir === "" ? [...catalogNotices, ...f.notices] : f.notices,
    };
  });
}

async function readModuleScript(
  projectDir: string,
  dir: string,
  catalogs: ReadonlyMap<string, VersionCatalog>,
): Promise<ScriptFacts> {
  const empty = (notices: string[]): ScriptFacts => ({ plugins: [], classpath: [], dependencies: [], projects: [], notices });
  for (const name of GRADLE_BUILD) {
    const file = posix.join(dir, name);
    let text: string;
    try {
      text = await readFile(join(projectDir, dir, name), "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      // Read as absent, as module discovery does, so one unreadable script does not fail the whole build model.
      if (code === "EACCES" || code === "EPERM") return empty([`${file} is unreadable (${code}); skipped`]);
      throw err;
    }
    return new ScriptReader(file, new GradleScript(text), catalogs).facts();
  }
  return empty([]); // an aggregator with no build script
}

// ── Spring Boot ──────────────────────────────────────────────────────────

/**
 * The plugin's own version, else the root script's declaration (often
 * `apply false`), else a legacy `buildscript` classpath entry, else a Spring
 * Boot BOM dependency. A plugin applied with none of these is unresolved.
 */
function springBootVersion(own: ScriptFacts, root: ScriptFacts | undefined): BuildValue | undefined {
  const plugin = own.plugins.find((p) => p.id === BOOT_PLUGIN);
  if (plugin) {
    const declared = plugin.version ?? root?.plugins.find((p) => p.id === BOOT_PLUGIN)?.version;
    if (declared) return declared;
    const legacy = bootClasspath(own) ?? (root && bootClasspath(root));
    if (legacy) return legacy;
  }
  const bom = own.dependencies.find((d) => d.group === BOOT_GROUP && d.artifact === BOOT_BOM && d.version.resolved);
  if (bom) return bom.version;
  return plugin && { resolved: false, reason: `the ${BOOT_PLUGIN} plugin is applied without a version in the script; settings or a parent build may set it` };
}

function bootClasspath(facts: ScriptFacts): BuildValue | undefined {
  return facts.classpath.find((d) => d.group === BOOT_GROUP && d.artifact === BOOT_GRADLE_PLUGIN)?.version;
}

// ── One script ───────────────────────────────────────────────────────────

class ScriptReader {
  private readonly notices: string[] = [];

  constructor(
    private readonly file: string,
    private readonly script: GradleScript,
    private readonly catalogs: ReadonlyMap<string, VersionCatalog>,
  ) {}

  facts(): ScriptFacts {
    const s = this.script;
    const plugins = [...s.blocks("plugins").flatMap((b) => this.pluginBlock(b)), ...this.legacyApplies()];
    const classpath = s.blocks("buildscript").flatMap((b) => s.blocks("dependencies", b).flatMap((d) => this.dependencyBlock(d)));
    const projects: ProjectDependency[] = [];
    const dependencies = this.dedupe(s.blocks("dependencies").flatMap((d) => this.dependencyBlock(d, projects)));
    return {
      plugins,
      classpath,
      dependencies,
      projects,
      ...this.coordinates(),
      ...this.javaVersion(),
      notices: this.notices,
    };
  }

  private note(message: string): void {
    this.notices.push(`${this.file}: ${message}`);
  }

  // ── Plugins ──────────────────────────────────────────────────────────

  private pluginBlock(body: Span): PluginUse[] {
    const out: PluginUse[] = [];
    for (const s of this.script.statements(body)) {
      const plugin = this.plugin(this.script.text(s));
      if (plugin) out.push(plugin);
    }
    return out;
  }

  private plugin(statement: string): PluginUse | undefined {
    // `apply false` only defers applying; the declaration (and its version) still counts.
    const text = statement.replace(APPLY_TAIL, "").trim();
    const alias = /^alias\s*\(?\s*([\w.]+)\s*\)?$/.exec(text);
    if (alias) {
      const ref = resolveCatalogRef(this.catalogs, alias[1]);
      if (ref?.kind === "plugin") return { id: ref.plugin.id, ...(ref.plugin.version && { version: ref.plugin.version }) };
      this.note(ref?.kind === "missing" ? ref.reason : `plugin alias ${alias[1]} is not in a version catalog`);
      return undefined;
    }
    const m = /^(?:id\s*\(?\s*("[^"]*"|'[^']*')\s*\)?|kotlin\s*\(\s*("[^"]*"|'[^']*')\s*\))([\s\S]*)$/.exec(text);
    if (!m) return undefined; // `java`, `` `java-library` ``, … name no versioned plugin
    const name = stringLiteral(m[1] ?? m[2]);
    if (!name || name.interpolated) {
      this.note(`plugin id is computed: ${text}`);
      return undefined;
    }
    const id = m[2] !== undefined ? `org.jetbrains.kotlin.${name.value}` : name.value;
    const tail = m[3].trim();
    const declared = /^\.?\s*version\s*([\s\S]+)$/.exec(tail)?.[1].trim();
    if (declared === undefined) return { id };
    const expr = declared.startsWith("(") && declared.endsWith(")") ? declared.slice(1, -1) : declared;
    return { id, version: this.value(expr) };
  }

  /** `apply plugin: 'id'` and `apply(plugin = "id")`. */
  private legacyApplies(): PluginUse[] {
    const out: PluginUse[] = [];
    for (const s of this.script.statements()) {
      const m = /^apply\s*\(?\s*plugin\s*[:=]\s*("[^"]*"|'[^']*')\s*\)?$/.exec(this.script.text(s));
      const id = m && stringLiteral(m[1]);
      if (id && !id.interpolated) out.push({ id: id.value });
    }
    return out;
  }

  // ── Dependencies ─────────────────────────────────────────────────────

  /** Coordinates in a `dependencies` body; its `project(…)` dependencies go to `projects` when given. */
  private dependencyBlock(body: Span, projects?: ProjectDependency[]): BuildDependency[] {
    return this.script.statements(body).flatMap((s) => this.dependencyStatement(s, projects));
  }

  /** `implementation 'g:a:v'`, `implementation("g:a:v")`, `api(libs.x)`, `compileOnly(platform("g:a:v"))`, … */
  private dependencyStatement(s: Span, projects?: ProjectDependency[]): BuildDependency[] {
    const config = this.script.head(s);
    if (!config || NOT_A_CONFIGURATION.has(config)) return [];
    const masked = this.script.masked;
    let i = s.start + config.length;
    while (i < s.end && /[ \t]/.test(masked[i])) i++;
    if (i >= s.end || !/[("'\w`]/.test(masked[i])) return []; // `{ … }`, `= …`, `.x` are not dependency declarations
    const args = masked[i] === "(" ? this.script.arguments(i) : this.script.split({ start: i, end: s.end });
    return args ? this.dependencyArguments(config, args, projects) : [];
  }

  private dependencyArguments(config: string, args: Span[], projects?: ProjectDependency[]): BuildDependency[] {
    const first = args[0];
    if (!first) return [];
    const text = this.script.text(first);
    const make = (library: CatalogLibrary): BuildDependency => ({
      group: library.group,
      artifact: library.artifact,
      version: library.version ?? { resolved: false, reason: NO_VERSION },
      scope: config,
    });

    const named = this.namedCoordinate(config, args);
    if (named !== undefined) return named;

    const quoted = leadingStringLiteral(text);
    if (quoted) {
      // Groovy takes several coordinates in one call (`implementation 'a:b:1', 'c:d:2'`); a trailing closure is skipped.
      const rest = args.slice(1).map((a) => this.script.text(a)).filter((t) => leadingStringLiteral(t) === t);
      return [quoted, ...rest].flatMap((q) => this.stringCoordinate(config, q));
    }

    const wrapped = /^(?:platform|enforcedPlatform)\s*\(/.exec(text);
    if (wrapped) {
      const inner = this.script.arguments(first.start + wrapped[0].length - 1);
      return inner ? this.dependencyArguments(config, inner) : [];
    }
    const project = this.projectDependency(config, first);
    if (project) {
      projects?.push(project);
      return [];
    }
    if (NON_COORDINATE.test(text)) return [];

    const ref = resolveCatalogRef(this.catalogs, text);
    if (ref?.kind === "library") return [make(ref.library)];
    if (ref?.kind === "bundle") return ref.libraries.map(make);
    if (ref?.kind === "missing") this.note(ref.reason);
    else if (!ref) this.note(`dependency "${config} ${truncate(text)}" is computed in the build script`);
    return [];
  }

  /**
   * `project(':x')`, `project(path: ':x', configuration: 'tests')` (Groovy),
   * `project(":x", "tests")` or `project(path = ":x", configuration = "tests")`
   * (Kotlin), each optionally wrapped in `testFixtures(…)`. Undefined for any
   * other expression, including a project followed by more
   * (`project(':x').sourceSets…`); a computed path is also noted.
   */
  private projectDependency(config: string, span: Span): ProjectDependency | undefined {
    const fixtures = this.call(span, "testFixtures");
    if (fixtures) {
      const inner = fixtures.length === 1 ? this.projectDependency(config, fixtures[0]!) : undefined;
      return inner && !inner.configuration ? { ...inner, testFixtures: true } : undefined;
    }
    const args = this.call(span, "project");
    if (!args) return undefined;
    const named = new Map<string, string>();
    const positional: string[] = [];
    for (const a of args) {
      const text = this.script.text(a);
      const m = /^(\w+)\s*[:=]\s*([\s\S]+)$/.exec(text);
      if (m) named.set(m[1]!, m[2]!);
      else positional.push(text);
    }
    const path = this.plainString(named.get("path") ?? positional[0]);
    const configurationExpr = named.get("configuration") ?? positional[1];
    const configuration = this.plainString(configurationExpr);
    if (!path || (configurationExpr !== undefined && configuration === undefined)) {
      this.note(`project dependency "${config} ${truncate(this.script.text(span))}" is computed in the build script`);
      return undefined;
    }
    return {
      path: path.startsWith(":") ? path : `:${path}`,
      scope: config,
      ...(configuration !== undefined && { configuration }),
    };
  }

  /** Arguments of `span` when it is exactly one call of `name`, with nothing after its closing parenthesis. */
  private call(span: Span, name: string): Span[] | undefined {
    const m = new RegExp(`^${name}\\s*\\(`).exec(this.script.masked.slice(span.start, span.end));
    if (!m) return undefined;
    const open = span.start + m[0].length - 1;
    return this.script.matching(open) === span.end - 1 ? this.script.arguments(open) : undefined;
  }

  /** `group: 'g', name: 'a', version: 'v'` (Groovy) or `group = "g", name = "a"` (Kotlin); undefined when not that form. */
  private namedCoordinate(config: string, args: Span[]): BuildDependency[] | undefined {
    const named = new Map<string, string>();
    for (const a of args) {
      const m = /^(\w+)\s*[:=]\s*([\s\S]+)$/.exec(this.script.text(a));
      if (m) named.set(m[1], m[2]);
    }
    if (!named.has("name") && !named.has("group")) return undefined;
    const group = this.plainString(named.get("group"));
    const artifact = this.plainString(named.get("name"));
    if (!group || !artifact) {
      this.note(`dependency "${config} ${truncate(args.map((a) => this.script.text(a)).join(", "))}" has a computed group or name`);
      return [];
    }
    const version = named.get("version");
    return [{ group, artifact, version: version ? this.value(version) : { resolved: false, reason: NO_VERSION }, scope: config }];
  }

  private stringCoordinate(config: string, quoted: string): BuildDependency[] {
    const lit = stringLiteral(quoted);
    if (!lit) return [];
    const [group, artifact, version] = (lit.value.split("@")[0] ?? "").split(":");
    if (artifact === undefined) return []; // not a coordinate
    if (!group || !artifact || group.includes("$") || artifact.includes("$")) {
      this.note(`dependency "${config} ${truncate(quoted)}" has a computed group or name`);
      return [];
    }
    let resolved: BuildValue = { resolved: false, reason: NO_VERSION };
    if (version) resolved = lit.interpolated && version.includes("$") ? computed(version) : bestEffort(version);
    return [{ group, artifact, version: resolved, scope: config }];
  }

  /** First declaration of a group:artifact:configuration wins; sorted by coordinates, then configuration. */
  private dedupe(deps: BuildDependency[]): BuildDependency[] {
    const seen = new Map<string, BuildDependency>();
    for (const d of deps) {
      const key = `${d.group}:${d.artifact}:${d.scope}`;
      if (!seen.has(key)) seen.set(key, d);
    }
    return [...seen.values()].sort(
      (a, b) => `${a.group}:${a.artifact}`.localeCompare(`${b.group}:${b.artifact}`) || a.scope.localeCompare(b.scope),
    );
  }

  // ── Coordinates and Java level ───────────────────────────────────────

  /** Top-level `group = "g"` and `version = "v"`. */
  private coordinates(): Pick<ScriptFacts, "group" | "version"> {
    const out: { group?: BuildValue; version?: BuildValue } = {};
    for (const s of this.script.statements()) {
      const m = /^(group|version)\s*(?:=\s*|\s+)([\s\S]+)$/.exec(this.script.text(s));
      if (m && !(m[1] in out)) out[m[1] as "group" | "version"] = this.value(m[2]);
    }
    return out;
  }

  /**
   * A toolchain (`languageVersion`, `jvmToolchain`) beats `sourceCompatibility`,
   * the way Gradle compiles. Read from the top level and from `java`, `kotlin`
   * and their `toolchain` blocks only.
   */
  private javaVersion(): Pick<ScriptFacts, "javaVersion"> {
    const s = this.script;
    const scopes: Span[] = [s.all];
    for (const name of ["java", "kotlin"]) {
      for (const body of s.blocks(name)) scopes.push(body, ...s.blocks("toolchain", body));
    }
    let toolchain: BuildValue | undefined;
    let compat: BuildValue | undefined;
    for (const scope of scopes) {
      for (const stmt of s.statements(scope)) {
        const text = s.text(stmt);
        const tool =
          /^(?:(?:java\.)?toolchain\.)?languageVersion\s*=\s*([\s\S]+)$/.exec(text) ??
          /^(?:(?:java\.)?toolchain\.)?languageVersion\.set\(\s*([\s\S]+?)\s*\)$/.exec(text) ??
          /^(?:kotlin\.)?jvmToolchain\s*\(\s*([\s\S]+?)\s*\)$/.exec(text);
        if (tool) toolchain ??= this.javaLevel(tool[1]);
        const source = /^(?:java\.)?sourceCompatibility\s*(?:=\s*|\s+)([\s\S]+)$/.exec(text);
        if (source) compat ??= this.javaLevel(source[1]);
      }
    }
    const level = toolchain ?? compat;
    return level ? { javaVersion: level } : {};
  }

  /** `17`, `'17'`, `JavaVersion.VERSION_17`, `JavaLanguageVersion.of(17)`, `JavaVersion.toVersion("17")`, `libs.versions.java.get()`. */
  private javaLevel(expr: string): BuildValue {
    let e = expr.trim();
    for (let m = LEVEL_WRAPPER.exec(e); m; m = LEVEL_WRAPPER.exec(e)) e = m[1].trim();
    const constant = /^JavaVersion\.VERSION_(\d+(?:_\d+)*)$/.exec(e);
    return constant ? bestEffort(constant[1].replace(/_/g, ".")) : this.value(e);
  }

  // ── Values ───────────────────────────────────────────────────────────

  /** A version-like expression: a catalog reference (exact), a plain literal (best effort), else computed. */
  private value(expr: string): BuildValue {
    const e = expr.trim();
    const lit = stringLiteral(e);
    if (lit) return lit.interpolated ? computed(e) : bestEffort(lit.value);
    if (/^\d+(?:\.\d+)*$/.test(e)) return bestEffort(e);
    const ref = resolveCatalogRef(this.catalogs, e);
    if (ref?.kind === "version") return ref.version;
    if (ref?.kind === "missing") return { resolved: false, reason: ref.reason };
    return computed(e);
  }

  /** A string literal without interpolation, or undefined. */
  private plainString(expr: string | undefined): string | undefined {
    const lit = expr === undefined ? undefined : stringLiteral(expr);
    return lit && !lit.interpolated ? lit.value : undefined;
  }
}

function bestEffort(value: string): BuildValue {
  return { resolved: true, value, bestEffort: true };
}

function computed(expr: string): BuildValue {
  return { resolved: false, reason: `computed in the build script: ${truncate(expr)}` };
}

function truncate(text: string, max = 80): string {
  const one = text.replace(/\s+/g, " ");
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}
