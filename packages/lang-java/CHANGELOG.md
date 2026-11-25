# @n-dx/lang-java

## 0.10.5

### Patch Changes

- [#1096](https://github.com/en-dash-consulting/n-dx/pull/1096) [`f5b87db`](https://github.com/en-dash-consulting/n-dx/commit/f5b87db435673ff2b7cd145a5b97bd436d081a95) Thanks [@endash-shal](https://github.com/endash-shal)! - Test-only: every package suite can measure line, branch and function coverage with per-line hit counts, and fails below its recorded coverage floor.
  
  `pnpm test:coverage` runs each package's new `test:coverage` script, which writes HTML, lcov and JSON reports to `packages/<pkg>/coverage/`. `pnpm coverage:lines <pkg>` prints how many times the suite executed each line. Shared settings live in `tests/vitest-coverage.mjs`; see TESTING.md, "Code Coverage".

- [#1065](https://github.com/en-dash-consulting/n-dx/pull/1065) [`1dc0110`](https://github.com/en-dash-consulting/n-dx/commit/1dc01107170e5152c4874798bacd765fa490b8f8) Thanks [@endash-shal](https://github.com/endash-shal)! - Internal: refactor llm-client and the language packs without changing behaviour: shared HTTP retry and child-process settling, one merged project-config loader, vendor failover as a table, and shared span helpers in the packs.
- Updated dependencies [[`966597b`](https://github.com/en-dash-consulting/n-dx/commit/966597bab5a972213e5a2a12edffee0092445a6d), [`a01e575`](https://github.com/en-dash-consulting/n-dx/commit/a01e5753f70be4774dab4e2a0bcc673e48d13d0c), [`8aefbe2`](https://github.com/en-dash-consulting/n-dx/commit/8aefbe2a7f24f8ffc67cd1ba86e28ca93ebf33f1), [`f5b87db`](https://github.com/en-dash-consulting/n-dx/commit/f5b87db435673ff2b7cd145a5b97bd436d081a95), [`1e55cf9`](https://github.com/en-dash-consulting/n-dx/commit/1e55cf9f2dd1eafa6176f9965cc71e174aef4695), [`98a2c93`](https://github.com/en-dash-consulting/n-dx/commit/98a2c939f2081fe6c3825a5c85fcd629202bfe9e), [`e6b640b`](https://github.com/en-dash-consulting/n-dx/commit/e6b640b9e5956116d088dc775c79159c5d9ca898), [`6bf5241`](https://github.com/en-dash-consulting/n-dx/commit/6bf5241853c8233ce5202eee62aefcee64ca6927), [`9eddb9f`](https://github.com/en-dash-consulting/n-dx/commit/9eddb9f8bcf19d50b2de8662cf11c3e84bfc8fab), [`263d95e`](https://github.com/en-dash-consulting/n-dx/commit/263d95e1bd0d40c52b7e9bab1139a536a3b7b085), [`0c31f42`](https://github.com/en-dash-consulting/n-dx/commit/0c31f4223c595c4ee0d202c64533d411e998e675), [`a592749`](https://github.com/en-dash-consulting/n-dx/commit/a5927499f0f28212f41c6e494490a6c617fd5511), [`0a55de6`](https://github.com/en-dash-consulting/n-dx/commit/0a55de6523e6ace586a206f68cec4ad1b80d4d5d), [`80bcac9`](https://github.com/en-dash-consulting/n-dx/commit/80bcac989a958219ad4d4b2ad61ba1dd68f6e72b), [`f867805`](https://github.com/en-dash-consulting/n-dx/commit/f86780564927ea637da9293cbe34bf042c167921), [`86e8aab`](https://github.com/en-dash-consulting/n-dx/commit/86e8aabd3a8923a40ba44e7ad3649a2688f17862), [`fa3e4a3`](https://github.com/en-dash-consulting/n-dx/commit/fa3e4a37c721a7fc427248e2973960fb9c68c50f), [`966597b`](https://github.com/en-dash-consulting/n-dx/commit/966597bab5a972213e5a2a12edffee0092445a6d), [`f17f946`](https://github.com/en-dash-consulting/n-dx/commit/f17f94636d3a5d9ca51bb5c8615c720965bc0cc9), [`228d348`](https://github.com/en-dash-consulting/n-dx/commit/228d348026f1dd4d05585dc308780f539e1cb054), [`1dc0110`](https://github.com/en-dash-consulting/n-dx/commit/1dc01107170e5152c4874798bacd765fa490b8f8), [`d4d2866`](https://github.com/en-dash-consulting/n-dx/commit/d4d28664500af935874abbc49084703d7e28871f), [`a4f0ab9`](https://github.com/en-dash-consulting/n-dx/commit/a4f0ab91e1c6a69c86a296edb0e26bd831126f76), [`5e253e4`](https://github.com/en-dash-consulting/n-dx/commit/5e253e4a8e2043ddf5082703e307850f29e1a2ec)]:
  - @n-dx/lang-runtime@0.10.5
  - @n-dx/lang-kit@0.10.5

## 0.10.4

### Patch Changes

- Updated dependencies []:
  - @n-dx/lang-kit@0.10.4
  - @n-dx/lang-runtime@0.10.4

## 0.10.3

### Patch Changes

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`55d304a`](https://github.com/en-dash-consulting/n-dx/commit/55d304a06b9e7547490a64e91888a9c25ac64621) Thanks [@endash-shal](https://github.com/endash-shal)! - Resolve Java inherited member types, method references and visible wildcard imports; recognize interface entry points and additional JDK packages. Match Gradle type-safe project accessors to declared projects. Preserve Go workspace import resolution for oversized generated files and report discovery failures even when no build file was found. Reuse verified extracted grammar toolchains without keeping duplicate archives.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`3edfb23`](https://github.com/en-dash-consulting/n-dx/commit/3edfb2303189207193062818fd0a358a2569e78f) Thanks [@endash-shal](https://github.com/endash-shal)! - The Java resolver keeps each declaration's own supertypes: when two modules declare the same class, an inherited member type is looked up only through the supertypes of the declaration in the referencing file, and of a supertype declared in several files only the ones that file sees give members or are followed. The SVG and SMIL DOM (`org.w3c.dom.svg`, `org.w3c.dom.smil`, shipped in xml-apis-ext and Batik) are named `java:` rather than `java:stdlib:`.
- Updated dependencies [[`55d304a`](https://github.com/en-dash-consulting/n-dx/commit/55d304a06b9e7547490a64e91888a9c25ac64621), [`c01c1cf`](https://github.com/en-dash-consulting/n-dx/commit/c01c1cfdd02e8140e19816cdc7532a14536b691d), [`3edfb23`](https://github.com/en-dash-consulting/n-dx/commit/3edfb2303189207193062818fd0a358a2569e78f)]:
  - @n-dx/lang-kit@0.10.3
  - @n-dx/lang-runtime@0.10.3

## 0.10.2

### Patch Changes

- Updated dependencies [[`19816b7`](https://github.com/en-dash-consulting/n-dx/commit/19816b719a347f36cb8c96831089836cc62584f7)]:
  - @n-dx/lang-kit@0.10.2
  - @n-dx/lang-runtime@0.10.2

## 0.10.1

### Patch Changes

- Updated dependencies [[`de8bc93`](https://github.com/en-dash-consulting/n-dx/commit/de8bc939849ed25a4376dca29ec18646cc906954)]:
  - @n-dx/lang-runtime@0.10.1
  - @n-dx/lang-kit@0.10.1

## 0.10.0

### Patch Changes

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`c3548b5`](https://github.com/en-dash-consulting/n-dx/commit/c3548b5039d2482818f49a4e78f91fa3dc36209f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Java resolver no longer takes quadratic time reading a dotted name with many unterminated `/*` or deeply nested generics. Results are unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`02fb706`](https://github.com/en-dash-consulting/n-dx/commit/02fb706ebe718b2feb133cd5c1c9134bcaf24676) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Java resolver links a test file to another module's test code only when the build lets javac do so: a Maven dependency of type `test-jar` or classifier `tests` on that module, a Gradle `testFixtures(project(':x'))` (its `testFixtures` set) or a project dependency on a test configuration such as `testArtifacts` (its `test` set). Otherwise a test in `svc-a` that names a class declared only in `svc-b/src/test` gets no edge to it, and a name declared in `svc-b/src/test` and `svc-c/src/main` resolves to the main declaration alone. Main code never links to test code. Build files that cannot be read lose only these links: every other Java import still resolves, and the analysis records a notice naming the failure. lang-kit's Gradle build model gains `projects`, the module's dependencies on other projects of the build.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`380dd67`](https://github.com/en-dash-consulting/n-dx/commit/380dd67fce4a3a4dea57b06681fc9ad3842e0e2f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Java and Go analysis now comes from the `@n-dx/lang-java` and `@n-dx/lang-go` packs, which sourcevision loads at run time: first from the per-user pack directory (`<ndx home>/packs/<sourcevision version>/`), then from the normal install. A pack must match sourcevision's version. Without the Java pack, Java files get inventory only and one notice names the install command (`npm install --prefix <pack dir> @n-dx/lang-java@<version>`); without the Go pack, Go imports come from the regex parser. `@n-dx/lang-kit` adds the pack entry type (`LanguagePackEntry`) and the embedded-SQL table reader.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`295506c`](https://github.com/en-dash-consulting/n-dx/commit/295506cedd33d8d0d7ddaabf9b453b33a5b71413) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the parser runtime (`@n-dx/lang-runtime`) and the Java, Go, SQL and Terraform language packs. sourcevision loads them at run time; the Go pack installs by default as an optional dependency.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`fb42c0f`](https://github.com/en-dash-consulting/n-dx/commit/fb42c0f0a0ad533e2c43f79038e146715f37f8ca) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Spring Boot rules pair their captures in one sweep instead of scanning every owner per capture, so a Java file with thousands of calls no longer costs time quadratic in its size. Routes and outbound calls are unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`6867040`](https://github.com/en-dash-consulting/n-dx/commit/68670401106a28a037f2a4f86fbf441f36aa5cc0) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Spring Boot rules no longer take quadratic time on a type name with many `<` and no `>`, or on a mapping prefix with a long run of `/` followed by another character. Results are unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`8e49fb7`](https://github.com/en-dash-consulting/n-dx/commit/8e49fb7984f76c5efc30a2b0d423e02be55aec92) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Java pack reads Spring Boot request routes and outbound calls (RestTemplate, WebClient, RestClient, Feign, `java.net.http`, Kafka, JMS, Rabbit, gRPC channels and `System.getenv`). With the pack installed, sourcevision records them in `components.json` server routes and `outbound.json`, reading them in the same parse as Java imports. lang-kit's outbound-call fact gains an optional `confidence`, and lang-runtime's framework-pack slot is implemented.
- Updated dependencies [[`fe61362`](https://github.com/en-dash-consulting/n-dx/commit/fe613620a2f05fd1ae1d10008ad054d865850ac2), [`ae7a6cf`](https://github.com/en-dash-consulting/n-dx/commit/ae7a6cfea0ecb476b8ff3df58dc2e7c9cec323f4), [`f0547c4`](https://github.com/en-dash-consulting/n-dx/commit/f0547c402f756734ecf85a26365141d6bc806d03), [`02fb706`](https://github.com/en-dash-consulting/n-dx/commit/02fb706ebe718b2feb133cd5c1c9134bcaf24676), [`1c9ca5e`](https://github.com/en-dash-consulting/n-dx/commit/1c9ca5e4cfcc161657a9958887463b2f8cd37a2a), [`f47ebc5`](https://github.com/en-dash-consulting/n-dx/commit/f47ebc52247e319e1f61e6a77b13701da2c06a8e), [`9ff58a3`](https://github.com/en-dash-consulting/n-dx/commit/9ff58a316861865c0cfe0237b95cbca755375f74), [`380dd67`](https://github.com/en-dash-consulting/n-dx/commit/380dd67fce4a3a4dea57b06681fc9ad3842e0e2f), [`295506c`](https://github.com/en-dash-consulting/n-dx/commit/295506cedd33d8d0d7ddaabf9b453b33a5b71413), [`bcb494a`](https://github.com/en-dash-consulting/n-dx/commit/bcb494a54b15ba96c66083129f9191426bcb2b6b), [`ec5f864`](https://github.com/en-dash-consulting/n-dx/commit/ec5f86406c203d43858144c24e0b8f73a96b64f5), [`1bb77bf`](https://github.com/en-dash-consulting/n-dx/commit/1bb77bf3a8e6935295bcc59686fe79990f7a2a73), [`bf141e2`](https://github.com/en-dash-consulting/n-dx/commit/bf141e29a91a42da1b2b6c184c291650f088ef92), [`f901248`](https://github.com/en-dash-consulting/n-dx/commit/f9012480fce7578a73592eeddc371f472026fed6), [`7e3cded`](https://github.com/en-dash-consulting/n-dx/commit/7e3cdedf02eb5ac2ef6daeaa11e02e20ef8c8725), [`8e49fb7`](https://github.com/en-dash-consulting/n-dx/commit/8e49fb7984f76c5efc30a2b0d423e02be55aec92), [`df60182`](https://github.com/en-dash-consulting/n-dx/commit/df601824a2589d91c43f469cdffcf777cfb9270e)]:
  - @n-dx/lang-kit@0.10.0
  - @n-dx/lang-runtime@0.10.0
