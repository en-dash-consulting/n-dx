---
id: "5e5d32b1-26ae-4594-a229-4b579038d053"
type: "capability"
title: "PHP language recognition and contract"
slug: "php-language-recognition-and-contract"
statement: "Sourcevision recognises PHP as a language of its own, with its file types, test files and project markers, and the pack contract can express PHP traits, namespaces, constants, conditional includes and the candidate targets of dynamic includes."
criteria: [{"id":"php-detect","text":"A PHP repository is detected as PHP and is never analysed with the TypeScript config"},{"id":"php-contract","text":"The pack contract carries trait, namespace and constant symbol kinds, a conditional import guard and dynamic-include candidates that never become import edges"}]
---

## History

- 2026-11-14 4335fd54-3711-4677-a070-e14fefefa998 added: PHP language config and pack contract additions
