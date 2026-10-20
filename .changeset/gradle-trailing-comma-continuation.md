---
"@n-dx/lang-kit": patch
---

The Gradle build reader continues a Groovy statement past a line that ends in a comma or a binary operator, as Groovy does. `implementation group: 'g',` followed by `name: 'a', version: '1'` on the next line is read as one dependency instead of a "computed group or name" notice, and the second coordinate of `implementation 'a:b:1',` followed by `'c:d:2'` is no longer dropped.
