---
"@n-dx/lang-kit": patch
"@n-dx/sourcevision": patch
---

Move language ids and configs, detection, the Go/Maven/Gradle build-file readers and the TOML/XML/YAML parsers from sourcevision into `@n-dx/lang-kit`. lang-kit's detection takes the config override and the Terraform search as arguments; sourcevision supplies both. Analysis output is unchanged.
