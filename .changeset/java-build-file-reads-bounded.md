---
"@n-dx/lang-kit": patch
---

The Java build file readers no longer take seconds or longer on a tag with no closing tag followed by long whitespace, an unterminated `<!--`, unclosed `<plugins>`/`<parent>`/`<modules>` blocks or an unterminated `/*` in a Gradle script. An unterminated XML comment now runs to the end of the file. A `pom.xml` or Gradle script over 1 MiB is skipped with a notice.
