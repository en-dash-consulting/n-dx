# Measuring the Java resolver against scip-java (gate G2)

`java-scip-compare.mjs` compares the resolver's file-to-file edges with a
scip-java index and prints precision, recall and the top unmatched targets in
each direction. scip-java, a JDK and Maven or Gradle are **operator tools**:
none is an n-dx dependency, the script never clones, builds or downloads, and it
is not part of the test run. Run these commands yourself, outside an agent
session (hench refuses network git, and the build needs network access).

All paths below are machine-local, under `~/.cache/ndx-java-corpus/`
(override with `NDX_JAVA_CORPUS_DIR`).

## 1. Clone the pinned corpus

```sh
node packages/sourcevision/scripts/java-corpus-clone.mjs
```

## 2. Install scip-java

Needs a JDK (the repositories' own build decides which; `mise` provides
Temurin 17, 21 and 25) and [coursier](https://get-coursier.io/):

```sh
cs install --contrib scip-java
scip-java --help   # confirm it is on PATH
```

Without coursier: `cs launch com.sourcegraph:scip-java_2.13:latest.release -- index`
in place of `scip-java index` below, or the `sourcegraph/scip-java` Docker image
(see the scip-java README for the invocation).

## 3. Index each repository that builds

The index must be written to `<corpus>/<repo>/index.scip`, which is where the
script looks. scip-java compiles the project, so each repository must build.

```sh
cd ~/.cache/ndx-java-corpus/spring-petclinic && scip-java index --output index.scip
cd ~/.cache/ndx-java-corpus/thingsboard      && scip-java index --output index.scip
cd ~/.cache/ndx-java-corpus/junit-framework  && scip-java index --output index.scip
```

A repository that does not build (thingsboard is large; junit-framework needs a
recent JDK and its Gradle toolchain) is simply left without an index and
reported as skipped. Do not hand-edit its build to force one.

## 4. Compare

```sh
pnpm --filter @n-dx/lang-java... build
pnpm --filter @n-dx/sourcevision build
pnpm --filter @n-dx/lang-java build:grammars
node packages/sourcevision/scripts/java-scip-compare.mjs [--json]
```

Exit 2 means a prerequisite is missing and the script printed what.

## Measured results

Resolver as of 2026-10-12 (after constructor references count as type references).

| Repository | Pinned SHA | Files compared | Precision | Recall | Date |
|---|---|---|---|---|---|
| spring-petclinic | `500158f73241` | 50 | 100.0% | 100.0% | 2026-10-12 |
| thingsboard | `0439df09f31b` | 6694 (297 build output, 191 not in the index left out) | 100.0% | 99.9% | 2026-10-12 |
| junit-framework | `99a00b9bb827` | not built | — | — | 2026-10-12 |

junit-framework has no index: scip-java 0.12.3 (the latest release) injects its
Gradle init script into junit's Kotlin build-logic included builds
(`gradle/base`, `gradle/plugins`), and Gradle 9.8 then fails reading
`compileKotlin` `freeCompilerArgs` before `generatePrecompiledScriptPluginAccessors`
has run. Its build is not edited to force one.

thingsboard needs Maven 3.9.x (3.10 rejects the duplicate byte-buddy
`dependencyManagement` entries in its root pom) and trailing scip-java arguments
`package --batch-mode -DskipTests -Dskip.ui.build=true -Dskip.yarn=true -Dpkg.skip=true -Dlicense.skip=true`.

Proposed G2 floors: precision ≥ 98.0%, recall ≥ 97.0%.

## How the numbers are defined

- **SCIP edges:** every non-definition occurrence of a *type* symbol (descriptor
  ending in `#`) in file A whose definition is in another repository `.java`
  file B gives edge A→B. A constructor symbol (`T#`<init>`(...).`, including
  overloads) counts as a reference to its type `T#`, since `new T()` is
  recorded that way. Other method and field symbols are ignored: the resolver
  models type references. Symbols defined outside the repository (JDK,
  dependencies) and `local` symbols never produce an edge.
- **Files compared:** the `.java` files under the repository that (1) are not
  build output and (2) have a document in the SCIP index, on both sides. Build
  output is a `target/` directory beside a `pom.xml` or a `build/` directory
  beside a `build.gradle(.kts)`: `sourcevision analyze` never inventories it
  (gitignored), so generated sources would otherwise enter both edge sets.
  scip-java indexes only what the build compiled (a module behind an inactive
  profile is not), so a file outside the index would turn every resolver edge
  from it into a false positive. The script prints how many walked files were
  left out and why.
- **Resolver edges:** `buildPackImportGraph` over the compared files, limited
  to targets among them.
- **Precision** = matched / resolver edges. **Recall** = matched / SCIP edges.
- **Unmatched patterns:** resolver-only and SCIP-only edges, split into
  `same-directory` and `cross-directory`, with the target files involved in the
  most edges and one sample source each.
- **Proposed G2 floors:** the lowest measured value across repositories, less
  2 points, rounded down. Record them in the task's rex log with `append_log`.
