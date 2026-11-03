# @n-dx/lang-go

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

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`380dd67`](https://github.com/en-dash-consulting/n-dx/commit/380dd67fce4a3a4dea57b06681fc9ad3842e0e2f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Java and Go analysis now comes from the `@n-dx/lang-java` and `@n-dx/lang-go` packs, which sourcevision loads at run time: first from the per-user pack directory (`<ndx home>/packs/<sourcevision version>/`), then from the normal install. A pack must match sourcevision's version. Without the Java pack, Java files get inventory only and one notice names the install command (`npm install --prefix <pack dir> @n-dx/lang-java@<version>`); without the Go pack, Go imports come from the regex parser. `@n-dx/lang-kit` adds the pack entry type (`LanguagePackEntry`) and the embedded-SQL table reader.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`295506c`](https://github.com/en-dash-consulting/n-dx/commit/295506cedd33d8d0d7ddaabf9b453b33a5b71413) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the parser runtime (`@n-dx/lang-runtime`) and the Java, Go, SQL and Terraform language packs. sourcevision loads them at run time; the Go pack installs by default as an optional dependency.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`ee61f46`](https://github.com/en-dash-consulting/n-dx/commit/ee61f46e39a4fa763cf44bb20acbd6a8a831fdae) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `sv analyze` now builds Go import edges with the Go language pack (tree-sitter queries plus a resolver that reads `go.mod`, `go.work` and `vendor/modules.txt`) instead of the regex parser. Projects with nested modules and no root `go.mod` gain internal edges between packages that were previously reported as external imports. Imports of a required module nested under the project's own module path are now external imports, where the regex parser drew edges to project directories that do not exist. So is an import of a project directory that holds no inventoried `.go` file, such as a module `replace`d into `third_party/` or another directory the inventory skips. The pack does not parse Go files over 1 MB (generated code such as `zz_generated.openapi.go`, large `.pb.go` files, bindata); their imports come from the regex parser instead, so they keep their edges. If the Go grammar is not built or cannot run, a single notice says so and Go edges come from the regex parser as before, so no Go repository loses its import graph.
- Updated dependencies [[`fe61362`](https://github.com/en-dash-consulting/n-dx/commit/fe613620a2f05fd1ae1d10008ad054d865850ac2), [`ae7a6cf`](https://github.com/en-dash-consulting/n-dx/commit/ae7a6cfea0ecb476b8ff3df58dc2e7c9cec323f4), [`f0547c4`](https://github.com/en-dash-consulting/n-dx/commit/f0547c402f756734ecf85a26365141d6bc806d03), [`02fb706`](https://github.com/en-dash-consulting/n-dx/commit/02fb706ebe718b2feb133cd5c1c9134bcaf24676), [`1c9ca5e`](https://github.com/en-dash-consulting/n-dx/commit/1c9ca5e4cfcc161657a9958887463b2f8cd37a2a), [`f47ebc5`](https://github.com/en-dash-consulting/n-dx/commit/f47ebc52247e319e1f61e6a77b13701da2c06a8e), [`9ff58a3`](https://github.com/en-dash-consulting/n-dx/commit/9ff58a316861865c0cfe0237b95cbca755375f74), [`380dd67`](https://github.com/en-dash-consulting/n-dx/commit/380dd67fce4a3a4dea57b06681fc9ad3842e0e2f), [`295506c`](https://github.com/en-dash-consulting/n-dx/commit/295506cedd33d8d0d7ddaabf9b453b33a5b71413), [`bcb494a`](https://github.com/en-dash-consulting/n-dx/commit/bcb494a54b15ba96c66083129f9191426bcb2b6b), [`ec5f864`](https://github.com/en-dash-consulting/n-dx/commit/ec5f86406c203d43858144c24e0b8f73a96b64f5), [`1bb77bf`](https://github.com/en-dash-consulting/n-dx/commit/1bb77bf3a8e6935295bcc59686fe79990f7a2a73), [`bf141e2`](https://github.com/en-dash-consulting/n-dx/commit/bf141e29a91a42da1b2b6c184c291650f088ef92), [`f901248`](https://github.com/en-dash-consulting/n-dx/commit/f9012480fce7578a73592eeddc371f472026fed6), [`7e3cded`](https://github.com/en-dash-consulting/n-dx/commit/7e3cdedf02eb5ac2ef6daeaa11e02e20ef8c8725), [`8e49fb7`](https://github.com/en-dash-consulting/n-dx/commit/8e49fb7984f76c5efc30a2b0d423e02be55aec92), [`df60182`](https://github.com/en-dash-consulting/n-dx/commit/df601824a2589d91c43f469cdffcf777cfb9270e)]:
  - @n-dx/lang-kit@0.10.0
  - @n-dx/lang-runtime@0.10.0
