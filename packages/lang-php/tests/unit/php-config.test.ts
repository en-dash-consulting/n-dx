import { describe, expect, it } from "vitest";
import { isConfigPath, isFlagKey, isFlagName } from "../../src/php-config.js";

describe("php config names", () => {
  it("knows flag-like constant and environment names", () => {
    for (const name of ["FEATURE_NEW_CHECKOUT", "FF_X", "ENABLE_AUDIT", "SEARCH_ENABLED", "feature_x"]) expect(isFlagName(name), name).toBe(true);
    for (const name of ["FEATURE", "IN_PHPBB", "DB_SERVER", "ENABLED", "MY_FEATURES"]) expect(isFlagName(name), name).toBe(false);
  });

  it("knows flag-like configuration keys", () => {
    for (const key of ["features.x", "feature_x", "enable_hooks", "flags.beta", "search_enabled"]) expect(isFlagKey(key), key).toBe(true);
    for (const key of ["base_url", "db.host"]) expect(isFlagKey(key), key).toBe(false);
  });

  it("knows configuration paths by name or directory", () => {
    for (const path of ["config.php", "includes/configure.php", "config/app.php", "app/conf/db.inc", "settings.local.php", "lib/defines.php"]) {
      expect(isConfigPath(path), path).toBe(true);
    }
    for (const path of ["confirm.php", "includes/database.php", "configurator/index.php", "reconfig.php"]) expect(isConfigPath(path), path).toBe(false);
  });
});
