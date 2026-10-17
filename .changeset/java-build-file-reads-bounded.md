---
"@n-dx/lang-kit": patch
---

The Java build file readers now run in linear time on any input. A tag with no closing tag followed by long whitespace, an unterminated `<!--`, unclosed `<plugins>`/`<parent>`/`<modules>` blocks and an unterminated `/*` in a Gradle script used to take seconds or longer. An unterminated XML comment now runs to the end of the file. A `pom.xml` or Gradle script over 1 MiB is skipped with a notice.
