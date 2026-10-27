// `ndx fixture [exit <code> | wait] [...]`: prints, as one JSON line, what n-dx
// handed it — args, working directory, Node, the NDX_* environment, the config
// file's contents — then exits with <code>, or waits for a signal.
import { existsSync, readFileSync } from "node:fs";
import { recordLoad } from "../loaded.js";

recordLoad("cli");

const args = process.argv.slice(2);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("NDX_")));
const config = env.NDX_EXTENSION_CONFIG ? JSON.parse(readFileSync(env.NDX_EXTENSION_CONFIG, "utf-8")) : null;

console.log(JSON.stringify({
  args,
  cwd: process.cwd(),
  execPath: process.execPath,
  env,
  config,
  stateDirExists: Boolean(env.NDX_EXTENSION_STATE_DIR) && existsSync(env.NDX_EXTENSION_STATE_DIR),
}));

if (args[0] === "wait") {
  process.on("SIGTERM", () => {
    console.log("got SIGTERM");
    process.exit(7);
  });
  setInterval(() => {}, 1000);
} else if (args[0] === "exit") {
  process.exit(Number(args[1]));
}
