# Config

Each extension owns one section, `extensions.<name>`, in two places:

| File | Scope | Write with |
| --- | --- | --- |
| `<ndx home>/config.json` | The user, every project | `ndx config extensions.<name>.<key> <value> --user` |
| `.n-dx.json` | One project | `ndx config extensions.<name>.<key> <value>` |

`ndx config extensions.<name>.<key>` without a value reads the setting.

The two sections are merged, the project's winning key by key. The merged section is written to the file `NDX_EXTENSION_CONFIG` names, in the extension's state folder, before every process starts. Read that file. Do not read the config files themselves, and do not rely on its name.

- A command gets a file of its own, so runs in different projects at once each read their own project's section. It is removed when the command exits.
- A sidecar serves no single project, so it gets the user's section alone, in `sidecar-config.json`. A command run never changes it.

## Schema

`configSchema` names a JSON Schema in the package.

- Every write is checked against the merged result. A property with a type in the schema is coerced to that type, so `ndx config extensions.hello.retries 3` stores a number.
- A missing `required` key does not stop a write, because a section is filled in one key at a time.
- A run whose merged section breaks the schema, `required` keys included, is refused with exit 2, naming each violation and the fix. A sidecar refused this way answers 503.

n-dx checks the validation keywords a config section needs: `type`, `enum`, `const`, `properties`, `required`, `additionalProperties`, `items` (not tuples), `minItems`, `maxItems`, `uniqueItems`, `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `allOf`, `anyOf`, `oneOf` and `not`. It reads annotations such as `format`, `default` and `description` as information only. A schema that uses any other keyword, `$ref` included, is reported as one n-dx cannot check. Inline the definitions instead. The checker is `packages/core/extension-config-schema.js`.

## Reserved

`extensions.paths` in the user config is discovery's list of development checkouts ([Manifest](./manifest.md#where-n-dx-looks)), which is why `paths` cannot be an extension name. Edit it in `<ndx home>/config.json` directly.
