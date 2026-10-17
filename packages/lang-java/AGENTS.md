## lang-java

`@n-dx/lang-java` is the Java pack: the pinned tree-sitter-java grammar, `queries/java`, the pack definition and its symbol rules (`src/java-pack.ts`), the Java resolver, the embedded-SQL reader and the Java goldens. It is opt-in: without it, Java files get inventory only.

### Rules

- **Imports only `@n-dx/lang-kit` and `@n-dx/lang-runtime` from n-dx.** No pack imports another pack.
- **Loaded, never imported.** sourcevision finds this package at run time (`src/language/pack-loader.ts`: the per-user pack directory, then module resolution) and imports it dynamically; nothing in a package's `src` imports it statically. Its version must equal sourcevision's, or sourcevision refuses it.
- **Returns facts.** `pack` (`src/pack.ts`) is a lang-kit `LanguagePackEntry` built with lang-runtime's `createPackEntry`, and it is the only export sourcevision reads; no tree-sitter type crosses into sourcevision. The other exports (the tree-sitter pack, resolver, symbol rules, SQL reader, `javaGrammarPath`) serve the corpus scripts in `packages/sourcevision/scripts` and tests in the workspace.
- **Finds its assets from its own root** (`src/package-paths.ts`): the grammar in `build/grammars`, queries in `queries/java`, the Spring Boot query in `queries/spring-boot`.
- **Externals are namespaced.** The resolver names every external `java:<package>`, and a JDK package (`java.*`, `jdk.*`, `javax.xml` and the JDK's own `javax` packages, `JDK_JAVAX_PACKAGES`) `java:stdlib:<package>`; the rest of `javax` (`javax.inject`, `javax.persistence`) ships as separate artifacts and stays `java:`.
- **Spring Boot is a framework pack** (`src/spring-boot.ts`, lang-runtime's `FrameworkPack`): `routes` and `outboundCalls`, provenance per rule. Its query runs in the Java parse only when one of those kinds is asked for, so asking for imports alone costs nothing, and it is not in `javaPack.queries`, so the Java golden and the Java corpus report do not see it. A mapping path that is not a string literal is skipped and counted in the entry's `notices`; a target that is not a literal is `unknown`, a leading `${key}` placeholder is `config`. Confidence is `certain` on a receiver declared as the client type (or the class itself), `likely` only for a method name no other client shares; nothing else is guessed. Out of scope: WebFlux router functions, JAX-RS, Spring Cloud Gateway, database and cache clients.
- **No language SDK at run time.** Grammars ship prebuilt as WASM; nothing here may require a toolchain (JDK, Go, Terraform) on the user's machine.
- **One public entry**, `.` (`src/index.ts`). There is no `./dist/*` escape hatch.

### Scripts

`build:grammars` builds the grammar into `build/grammars` (CI and release run every package's before tests and publish); the grammar tests skip without it unless `SV_REQUIRE_GRAMMARS=1`. `test:update-goldens` rewrites `tests/fixtures/language-packs/java/golden.json` and the Spring Boot facts golden `tests/fixtures/spring-boot/facts.json`; review the diff. `packages/sourcevision/scripts/spring-corpus-report.mjs` prints the Spring rules' counts and a seeded sample over the Java corpus.
