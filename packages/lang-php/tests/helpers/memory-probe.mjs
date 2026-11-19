/**
 * Run by `php-dynamic-memory.test.ts` in a child Node whose heap is capped
 * (`--max-old-space-size`): writes `<megabytes>` MB of generated PHP class
 * files, about 900 KB each, analyzes them with the built pack for `<kinds>`,
 * and prints what it read as JSON. Out of heap, the child aborts.
 *
 * Usage: node --max-old-space-size=<MB> memory-probe.mjs <dist index.js> <megabytes> <kind,...>
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [distIndex, megabytes, kinds] = process.argv.slice(2);
const { pack } = await import(pathToFileURL(distIndex).href);

/** One method: a query, a fetch, string building, an array, a loop and a dispatch on a fetched row. */
const method = (i) => `
  public function handle${i}($id, $name) {
    $sql = "SELECT handler, body FROM routes WHERE id = " . (int)$id . " AND name = '" . $name . "'";
    $res = mysql_query($sql);
    $row = mysql_fetch_assoc($res);
    $opts = array('id' => $id, 'name' => $name, 'list' => array(1, 2, 3, $id), 'label' => "Item {$name} #{$id}");
    $this->cache[$name] = $opts;
    $out = '';
    foreach ($opts['list'] as $k => $v) {
      $out .= strtolower($name) . '-' . $k . '=' . trim((string)$v) . ';';
    }
    if ($row['handler']) { call_user_func($row['handler'], $opts, $out); }
    $obj = $this->factory->make($opts['name'], array('x' => $opts['id']));
    $obj->setLabel(sprintf('%s %d', $name, $id))->save($out, $opts);
    return helper_${i % 50}($out, $opts['label'], $this->db->escape($name));
  }
`;

const dir = mkdtempSync(join(tmpdir(), "php-memory-"));
try {
  const files = [];
  let bytes = 0;
  while (bytes < Number(megabytes) * 1024 * 1024) {
    const parts = [`<?php\nclass Generated${files.length} {\n`];
    let size = parts[0].length;
    for (let i = 0; size < 900 * 1024; i++) {
      parts.push(method(i));
      size += parts[parts.length - 1].length;
    }
    parts.push("}\n");
    const name = `generated${files.length}.php`;
    writeFileSync(join(dir, name), parts.join(""));
    files.push(name);
    bytes += size + 2;
  }
  const result = await pack.analyzeProject({ projectDir: dir, files, kinds: kinds.split(",") });
  const sites = result.facts.flatMap((f) => f.dynamicCode ?? []);
  console.log(
    JSON.stringify({
      files: files.length,
      bytes,
      degraded: result.degraded ?? null,
      sites: sites.length,
      databaseSites: sites.filter((s) => s.database !== undefined).length,
      notices: result.notices ?? [],
    }),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
