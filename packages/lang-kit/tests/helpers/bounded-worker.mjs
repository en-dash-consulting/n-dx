/**
 * Worker side of call-within-budget.ts. Loads the module, reports "ready", and
 * runs the export once when asked, so the caller's budget covers the call and
 * not the module load.
 */

import { register } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

register("./ts-source-hooks.mjs", import.meta.url);

const { module, exportName, args } = workerData;
const fn = (await import(module))[exportName];
if (typeof fn !== "function") throw new TypeError(`${module} has no exported function ${exportName}`);

parentPort.once("message", async () => {
  try {
    parentPort.postMessage({ ok: true, value: await fn(...args) });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
  }
});
parentPort.postMessage("ready");
