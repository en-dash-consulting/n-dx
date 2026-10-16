import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dim, cyan, green } from "./cli-brand.js";
import { resolveLayout } from "./layout.js";
import { hasV2Tree } from "./migrate-chain.js";
import { execFileSyncCli } from "./win-spawn.js";

/**
 * Injected by cli.js: core spawns rex and imports none of it.
 *
 * @typedef {object} SampleAppDeps
 * @property {string} rexScript  Path to the rex CLI script (`tools.rex`).
 */

/** Marks the sample's change on a v2 tree (`rex add --source`) and its items on a v1 one (a tag). */
const SAMPLE_TAG = "sample-app";

// Helper to write a file, creating its parent directories if needed
function writeFileEnsureDir(filePath, content) {
  mkdirSync(resolve(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>n-dx Sample App</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="app-container">
    <header>
      <h1>n-dx Sample App</h1>
      <p>This is a playground to test n-dx autonomous capabilities.</p>
    </header>
    <main>
      <section class="counter-section">
        <h2>Counter</h2>
        <div class="counter-display">0</div>
        <button id="increment-btn">Increment</button>
      </section>
    </main>
  </div>
  <script src="app.js"></script>
</body>
</html>`;

const CSS_CONTENT = `:root {
  --primary-color: #6366f1;
  --bg-color: #f8fafc;
  --text-color: #0f172a;
  --card-bg: #ffffff;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background-color: var(--bg-color);
  color: var(--text-color);
  display: flex;
  justify-content: center;
  padding: 2rem;
}

.app-container {
  max-width: 600px;
  width: 100%;
  background: var(--card-bg);
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
}

header {
  text-align: center;
  margin-bottom: 2rem;
}

h1 {
  color: var(--primary-color);
  margin-top: 0;
}

.counter-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.counter-display {
  font-size: 3rem;
  font-weight: bold;
}

button {
  background-color: var(--primary-color);
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  font-size: 1rem;
  cursor: pointer;
  transition: opacity 0.2s;
}

button:hover {
  opacity: 0.9;
}`;

const JS_CONTENT = `document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('increment-btn');
  const display = document.querySelector('.counter-display');
  
  let count = 0;
  
  btn.addEventListener('click', () => {
    // BUG: Concatenating instead of adding! (n-dx should fix this)
    count = count + "1";
    display.textContent = count;
  });
});`;

function generatePrdMarkdown(item) {
  const frontmatter = [
    "---",
    `id: "${item.id}"`,
    `level: ${item.level}`,
    `title: "${item.title}"`,
    `status: ${item.status}`,
    `description: >-\n  ${item.description.replace(/\n/g, "\n  ")}`,
  ];
  
  if (item.tags && item.tags.length > 0) {
    frontmatter.push(`tags: [${item.tags.join(", ")}]`);
  }
  
  if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
    frontmatter.push("acceptanceCriteria:");
    for (const ac of item.acceptanceCriteria) {
      frontmatter.push(`  - "${ac}"`);
    }
  }
  
  frontmatter.push("---");
  frontmatter.push("");
  frontmatter.push(`# ${item.title}`);
  frontmatter.push("");
  frontmatter.push(`⚪ [${item.status}]`);
  frontmatter.push("");
  frontmatter.push(`## Summary`);
  frontmatter.push("");
  frontmatter.push(item.description);
  
  return frontmatter.join("\n") + "\n";
}

/** Run rex with `--format=json` and parse what it prints. */
function rexJson(deps, args) {
  const out = execFileSyncCli(process.execPath, [deps.rexScript, ...args, "--format=json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(out);
}

/** v2: a change with two tasks, added through `rex add` so rex owns the layout. */
function installV2Items(targetDir, deps) {
  if (!deps?.rexScript) throw new Error("install-sample on a v2 project needs the rex CLI path (SampleAppDeps.rexScript)");
  const change = rexJson(deps, [
    "add", "change",
    "--title=Sample App Improvements",
    "--description=Enhance the sample application with new features and bug fixes to demonstrate n-dx capabilities.",
    `--source=${SAMPLE_TAG}`,
    targetDir,
  ]);
  const tasks = [
    {
      title: "Fix Counter Bug",
      description: "The counter in app.js concatenates string '1' instead of doing numerical addition. Fix the bug.",
      criteria: ["Clicking increment adds 1 numerically to the counter"],
    },
    {
      title: "Add Dark Mode",
      description: "Implement a dark mode theme toggle. Add a button to the header that toggles a 'dark' class on the body, swapping the CSS variables to dark variants.",
      criteria: ["Dark mode button exists in header", "Clicking button toggles dark mode styles"],
    },
  ];
  for (const task of tasks) {
    rexJson(deps, [
      "add", "task",
      `--parent=${change.id}`,
      `--title=${task.title}`,
      `--description=${task.description}`,
      ...task.criteria.map((c) => `--criterion=${c}`),
      targetDir,
    ]);
  }
}

/**
 * @param {string[]} rest
 * @param {SampleAppDeps} [deps]  Needed on a v2 project.
 */
export async function handleInstallSample(rest, deps) {
  const targetDir = rest[0] ? resolve(process.cwd(), rest[0]) : process.cwd();
  const sampleDir = join(targetDir, "sample-app");

  console.log(`\n${cyan("n-dx")} installing sample app into ${dim(sampleDir)}...`);

  // 1. Create source files
  writeFileEnsureDir(join(sampleDir, "index.html"), HTML_CONTENT);
  writeFileEnsureDir(join(sampleDir, "style.css"), CSS_CONTENT);
  writeFileEnsureDir(join(sampleDir, "app.js"), JS_CONTENT);

  // 2. Create the sample PRD items in the project's layout
  if (hasV2Tree(targetDir)) installV2Items(targetDir, deps);
  else installV1Items(join(resolveLayout(targetDir).rexDir, "prd_tree"));

  console.log(`${green("✔")} Sample app installed successfully!`);
  console.log(`\n${cyan("Next Steps:")}`);
  console.log(`  ndx status`);
  console.log(`  ndx work --auto\n`);
}

/** v1: a hand-written epic, feature and two tasks in the folder tree. */
function installV1Items(prdTreeDir) {
  const epicId = randomUUID();
  const featureId = randomUUID();
  const task1Id = randomUUID();
  const task2Id = randomUUID();

  // Epic
  const epicPath = join(prdTreeDir, "sample-app-improvements");
  writeFileEnsureDir(join(epicPath, "index.md"), generatePrdMarkdown({
    id: epicId,
    level: "epic",
    title: "Sample App Improvements",
    status: "in_progress",
    description: "Enhance the sample application with new features and bug fixes to demonstrate n-dx capabilities.",
    tags: ["sample-app"]
  }));

  // Feature
  const featurePath = join(epicPath, "interactive-elements");
  writeFileEnsureDir(join(featurePath, "index.md"), generatePrdMarkdown({
    id: featureId,
    level: "feature",
    title: "Interactive Elements",
    status: "in_progress",
    description: "Improve interactivity and fix core functionality in the sample app.",
    tags: ["sample-app"],
    acceptanceCriteria: ["All interactive elements work as expected", "Styling is consistent across themes"]
  }));

  // Task 1
  const task1Path = join(featurePath, "fix-counter-bug");
  writeFileEnsureDir(join(task1Path, "index.md"), generatePrdMarkdown({
    id: task1Id,
    level: "task",
    title: "Fix Counter Bug",
    status: "pending",
    description: "The counter in app.js concatenates string '1' instead of doing numerical addition. Fix the bug.",
    tags: ["sample-app"],
    acceptanceCriteria: ["Clicking increment adds 1 numerically to the counter"]
  }));

  // Task 2
  const task2Path = join(featurePath, "add-dark-mode");
  writeFileEnsureDir(join(task2Path, "index.md"), generatePrdMarkdown({
    id: task2Id,
    level: "task",
    title: "Add Dark Mode",
    status: "pending",
    description: "Implement a dark mode theme toggle. Add a button to the header that toggles a 'dark' class on the body, swapping the CSS variables to dark variants.",
    tags: ["sample-app"],
    acceptanceCriteria: ["Dark mode button exists in header", "Clicking button toggles dark mode styles"]
  }));
}

export async function handleDestroySample(rest) {
  const targetDir = rest[0] ? resolve(process.cwd(), rest[0]) : process.cwd();
  const sampleDir = join(targetDir, "sample-app");
  const rexDir = resolveLayout(targetDir).rexDir;

  console.log(`\n${cyan("n-dx")} destroying sample app...`);

  // Remove source files
  if (existsSync(sampleDir)) {
    rmSync(sampleDir, { recursive: true, force: true });
    console.log(`${green("✔")} Removed sample-app directory`);
  }

  if (hasV2Tree(targetDir)) removeV2Items(join(rexDir, "changes"));
  else removeV1Items(join(rexDir, "prd_tree"));
  console.log(`${green("✔")} Sample app destroyed successfully!`);
}

/**
 * v2: a change is a folder holding its tasks, so removing the sample's change
 * removes them too. rex has no v2 delete verb; the folder names are its
 * on-disk contract (`store/prd-model-reader.ts`), as `migrate-chain.js` reads.
 */
function removeV2Items(changesDir) {
  const marker = new RegExp(`^source:\\s*["']?${SAMPLE_TAG}["']?\\s*$`, "m");
  const isSample = (dir) => {
    const index = join(dir, "index.md");
    return existsSync(index) && marker.test(readFileSync(index, "utf8"));
  };
  // A top-level change sits under changes/, or under changes/inbox/ while unplaced.
  const inbox = join(changesDir, "inbox");
  for (const parent of [changesDir, inbox]) {
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent)) {
      const dir = join(parent, entry);
      if (!statSync(dir).isDirectory() || !isSample(dir)) continue;
      rmSync(dir, { recursive: true, force: true });
      console.log(`${green("✔")} Removed PRD change: ${entry}`);
    }
  }
  // rex drops the Inbox folder with its last change; so do we.
  if (existsSync(inbox) && readdirSync(inbox).length === 0) rmSync(inbox, { recursive: true });
}

/** v1: remove every item file tagged `sample-app`. */
function removeV1Items(prdTreeDir) {
  function walkAndRemove(dir) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        walkAndRemove(fullPath);
        
        // Remove empty directories
        if (existsSync(fullPath) && readdirSync(fullPath).length === 0) {
          rmSync(fullPath, { recursive: true, force: true });
        }
      } else if (entry.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf8");
        if (content.includes("sample-app") && content.includes("tags:")) {
          rmSync(fullPath);
          console.log(`${green("✔")} Removed PRD item: ${entry}`);
        }
      }
    }
  }

  walkAndRemove(prdTreeDir);
}
