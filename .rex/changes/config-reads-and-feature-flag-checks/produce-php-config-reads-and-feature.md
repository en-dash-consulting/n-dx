---
id: "efa70788-9d7a-49e7-9250-1890d7455315"
type: "task"
title: "Produce PHP config reads and feature-flag checks"
slug: "produce-php-config-reads-and-feature"
summary: "Make the PHP pack find feature flags, the code each one switches, and where configuration comes from, including the per-tenant config files legacy PHP loads by host name."
description: "In `@n-dx/lang-php`, produce the `configReads` and `flagChecks` facts from the previous task. Names, keys, files and positions only, never values.\n\nFlag checks, with `gated` set to the controlled block's lines:\n- constant flags: a constant whose name matches the flag pattern (`FEATURE_*`, `FF_*`, `ENABLE_*`, `*_ENABLED`, or any constant defined with a boolean literal by `define()`/`const`) used in an `if`/`elseif`/ternary/`match` condition, alone or negated, or in `defined('X')` checks (mechanism `constant`);\n- config flags: conditions reading `$config['features'][...]`, `$config['feature_x']`, `Config::get('features.x')`, `$this->config->item('x')` (CodeIgniter) and similar array/registry reads whose key path contains `feature`, `flag` or `enable` (mechanism `config`);\n- helper calls: `isEnabled('x')`, `feature('x')`, `isFeatureEnabled('x')`, `->isActive('x')` with a literal name (mechanism `function`, client = helper name);\n- SDK calls: LaunchDarkly `->variation('key', …)`, Unleash `->isEnabled('key')`, Flagsmith `->isFeatureEnabled('key')` on clients the file constructs or imports (mechanism `sdk`);\n- env flags: `getenv('FEATURE_X')` in a condition (mechanism `env`).\n\nConfig reads:\n- PHP config files: a file whose top level is `return [ ... ];` or that assigns `$config[...] = ...` / `$conf[...]` / `$settings[...]` — its keys are config keys (source `file`, sourceFile itself), and files that `include`/`require` it and then read those keys are consumers;\n- `parse_ini_file('x.ini')`, `yaml_parse_file`/`Yaml::parseFile`, `simplexml_load_file('x.xml')` with literal paths (source `ini`/`yaml`/`xml`, sourceFile resolved like includes);\n- `define('DB_HOST', …)` in config files (source `define`);\n- host-based tenant config: an include whose path uses `$_SERVER['HTTP_HOST']`/`SERVER_NAME` marks each candidate file (from the include candidates) as a tenant config source, with the notice code from the legacy-includes PR.\n\nFixtures: a PHP 5 app with `define('FEATURE_NEW_CHECKOUT', true)` and `if (FEATURE_NEW_CHECKOUT) { … }`, a `config/tenant-a.example.com.php` host-selected config, a CodeIgniter-style config array, an ini file, and LaunchDarkly/Unleash calls. Log flag and key counts for the corpus with append_log (operator runs analyze on the corpus apps; the agent cannot read `~/.cache`)."
acceptanceCriteria:
  - "Constant, config, helper, SDK and env flag checks are reported with normalized names and the line span they gate"
  - "PHP config files, ini/yaml/xml loads and define() config constants are reported as config sources with their consumer files"
  - "Host-selected tenant config files are reported as config sources"
  - "No values appear in any fact"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
  - "flags"
  - "config"
blockedBy:
  - "d1f293e3-9051-443f-b0f5-3a0839302edf"
---
