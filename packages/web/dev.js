import { spawn } from "node:child_process";

const children = [];

function run(label, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  children.push(child);

  const prefix = `[${label}]`;
  child.stdout.on("data", (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      console.log(`${prefix} ${line}`);
    }
  });
  child.stderr.on("data", (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      console.error(`${prefix} ${line}`);
    }
  });
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`${prefix} exited with code ${code}`);
    }
  });
  return child;
}

// Start TypeScript watcher
run("tsc", "npx", ["tsc", "--watch", "--preserveWatchOutput"]);

// Start esbuild viewer watcher
run("esbuild", "node", ["build.js", "--watch"]);

// Wait for initial tsc + esbuild to produce dist/, then start dev server
const startDelay = 3000;
setTimeout(() => {
  run("serve", "node", [
    "--input-type=module",
    "-e",
    `import("./dist/server/start.js").then(m => m.startServer(".", 3117, { dev: true }));`,
  ]);
}, startDelay);

// Clean up all children on exit
function cleanup() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
