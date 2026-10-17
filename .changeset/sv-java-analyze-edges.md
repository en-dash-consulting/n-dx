---
"@n-dx/sourcevision": patch
---

`sv analyze` now builds the import graph for Java. In a Java project, `.java` files go through the Java pack's tree-sitter queries and resolver, which produce file-to-file import edges and external imports by package, named `java:<package>` so they never merge with another language's externals; JDK packages (`java.*`, `jdk.*` and the JDK's own `javax` packages) are `java:stdlib:<package>`. Zones, cohesion, coupling and findings follow from those edges. If the Java grammar has not been built, Java files are inventoried only, a single notice says so, and the analysis still succeeds. Output for other languages is unchanged.
