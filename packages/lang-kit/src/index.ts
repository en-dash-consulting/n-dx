/**
 * `@n-dx/lang-kit` — the package's one public entry.
 *
 * Every module is re-exported whole. Two modules exporting the same name is a
 * compile error here (TS2308); resolve it by renaming at this barrel, not by
 * changing the module.
 */

// Language ids and configs
export * from "./registry.js";
export * from "./typescript.js";
export * from "./go.js";
export * from "./swift.js";
export * from "./python.js";
export * from "./csharp.js";
export * from "./java.js";
export * from "./terraform.js";

// Detection (the caller supplies the config override and the Terraform search)
export * from "./detect.js";

// Build files
export * from "./build-model.js";
export * from "./go-build.js";
export * from "./java-modules.js";
export * from "./java-maven-build.js";
export * from "./java-gradle-build.js";
export * from "./gradle-script.js";
export * from "./gradle-catalog.js";

// IaC resource kinds
export * from "./iac-kinds.js";

// Small parsers
export * from "./toml-lite.js";
export * from "./xml-lite.js";
export * from "./yaml-subset.js";
