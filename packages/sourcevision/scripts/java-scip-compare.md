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
pnpm --filter @n-dx/sourcevision build
node packages/sourcevision/scripts/build-grammars.mjs
node packages/sourcevision/scripts/java-scip-compare.mjs [--json]
```

Exit 2 means a prerequisite is missing and the script printed what.

## How the numbers are defined

- **SCIP edges:** every non-definition occurrence of a *type* symbol (descriptor
  ending in `#`) in file A whose definition is in another repository `.java`
  file B gives edge A→B. Method and field symbols are ignored: the resolver
  models type references. Symbols defined outside the repository (JDK,
  dependencies) and `local` symbols never produce an edge.
- **Resolver edges:** `buildPackImportGraph` over the same `.java` files,
  limited to targets inside the repository.
- **Precision** = matched / resolver edges. **Recall** = matched / SCIP edges.
- **Unmatched patterns:** resolver-only and SCIP-only edges, split into
  `same-directory` and `cross-directory`, with the target files involved in the
  most edges and one sample source each.
- **Proposed G2 floors:** the lowest measured value across repositories, less
  2 points, rounded down. Record them in the task's rex log with `append_log`.
