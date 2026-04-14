import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { SV_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import {
  validateManifest,
  validateInventory,
  validateImports,
  validateZones,
  validateComponents,
  DATA_FILES,
} from "../sourcevision-core.js";
import { info, result } from "../output.js";
import { green, red, dim } from "@n-dx/llm-client";

export function cmdValidate(dir: string): void {
  const svDir = join(resolve(dir), SV_DIR);

  if (!existsSync(svDir)) {
    throw new CLIError(
      `Sourcevision directory not found in ${resolve(dir)}`,
      "Run 'n-dx init' to set up the project, or 'sourcevision init' if using sourcevision standalone.",
    );
  }

  const modules: Array<{
    name: string;
    file: string;
    validate: (data: unknown) => { ok: boolean; errors?: unknown };
  }> = [
    { name: "manifest", file: DATA_FILES.manifest, validate: validateManifest },
    { name: "inventory", file: DATA_FILES.inventory, validate: validateInventory },
    { name: "imports", file: DATA_FILES.imports, validate: validateImports },
    { name: "zones", file: DATA_FILES.zones, validate: validateZones },
    { name: "components", file: DATA_FILES.components, validate: validateComponents },
  ];

  let allValid = true;

  for (const mod of modules) {
    const filePath = join(svDir, mod.file);
    if (!existsSync(filePath)) {
      info(`  ${dim("[skip]")} ${dim(mod.file)} — not found`);
      continue;
    }

    try {
      const raw = readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      const check = mod.validate(data);

      if (check.ok) {
        result(`  ${green("[pass]")} ${mod.file}`);
      } else {
        result(`  ${red("[fail]")} ${mod.file}`);
        result(`         ${dim(JSON.stringify(check.errors, null, 2))}`);
        allValid = false;
      }
    } catch (err) {
      result(`  ${red("[fail]")} ${mod.file} — ${err instanceof Error ? err.message : err}`);
      allValid = false;
    }
  }

  if (allValid) {
    result(`\n${green("All modules valid.")}`);
  } else {
    result(`\n${red("Validation failed for one or more modules.")}`);
    process.exit(1);
  }
}
