/**
 * The in-memory build model: what a build file says about one module. One
 * type for every ecosystem's reader (Maven today; Gradle and Go's
 * `go.mod`/`go.work` mirror it) so the packs do not drift. Held in memory
 * only; nothing here is persisted into analysis artifacts.
 *
 * @module sourcevision/language/build-model
 */

/**
 * A value a build file declares. A value that depends on something outside
 * the repository (a remote parent, an imported BOM) or on an undefined
 * property is `resolved: false` with the reason, never a guess.
 *
 * `bestEffort: true` marks a value read from a build *script* (Gradle's
 * `build.gradle(.kts)`), which is a program: the literal was there, but the
 * script may override it. Values from data files (a pom, a version catalog)
 * are exact and carry no flag.
 */
export type BuildValue =
  | { readonly resolved: true; readonly value: string; readonly bestEffort?: true }
  | { readonly resolved: false; readonly reason: string };

export interface BuildDependency {
  /** Maven groupId, Go module path prefix, Gradle group. */
  readonly group: string;
  /** Maven artifactId, Gradle name; Go uses the last path element. */
  readonly artifact: string;
  readonly version: BuildValue;
  /** Maven scope (`compile` when none is declared) or the Gradle configuration name (`implementation`, `testImplementation`, …). */
  readonly scope: string;
  /** Maven packaging type (`test-jar`, `pom`, …); absent for the default `jar`. */
  readonly type?: string;
  /** Maven classifier (`tests`, `sources`, …); absent when none. */
  readonly classifier?: string;
}

export interface ModuleBuildModel {
  /** Matches `JavaModule.name` for the same directory. */
  readonly module: string;
  /** Module directory relative to the project root, POSIX; "" is the root. */
  readonly dir: string;
  readonly buildSystem: "maven" | "gradle" | "go";
  /** The module's own coordinates, when it declares them. */
  readonly group?: BuildValue;
  readonly version?: BuildValue;
  /** Direct and inherited dependencies, sorted by `group:artifact`, then type and classifier. */
  readonly dependencies: readonly BuildDependency[];
  /** Language level, e.g. `17`. Present only when declared. */
  readonly javaVersion?: BuildValue;
  readonly springBootVersion?: BuildValue;
  /** Build files that could not be read (malformed XML, unreadable). */
  readonly notices: readonly string[];
}
