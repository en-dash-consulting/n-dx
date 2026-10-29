// Every module of the fixture records that it ran, so a test can prove that
// discovery, help and the hub's launch plan never load extension code.
import { appendFileSync } from "node:fs";

export function recordLoad(module) {
  appendFileSync(new URL("./loaded.log", import.meta.url), `${module}\n`);
}
