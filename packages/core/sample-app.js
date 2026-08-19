import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dim, cyan, green } from "./cli-brand.js";

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

export async function handleInstallSample(rest) {
  const targetDir = rest[0] ? resolve(process.cwd(), rest[0]) : process.cwd();
  const sampleDir = join(targetDir, "sample-app");
  const prdTreeDir = join(targetDir, ".rex", "prd_tree");

  console.log(`\n${cyan("n-dx")} installing sample app into ${dim(sampleDir)}...`);

  // 1. Create source files
  writeFileEnsureDir(join(sampleDir, "index.html"), HTML_CONTENT);
  writeFileEnsureDir(join(sampleDir, "style.css"), CSS_CONTENT);
  writeFileEnsureDir(join(sampleDir, "app.js"), JS_CONTENT);

  // 2. Create PRD Tree
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

  console.log(`${green("✔")} Sample app installed successfully!`);
  console.log(`\n${cyan("Next Steps:")}`);
  console.log(`  ndx status`);
  console.log(`  ndx work --auto\n`);
}

export async function handleDestroySample(rest) {
  const targetDir = rest[0] ? resolve(process.cwd(), rest[0]) : process.cwd();
  const sampleDir = join(targetDir, "sample-app");
  const prdTreeDir = join(targetDir, ".rex", "prd_tree");

  console.log(`\n${cyan("n-dx")} destroying sample app...`);

  // Remove source files
  if (existsSync(sampleDir)) {
    rmSync(sampleDir, { recursive: true, force: true });
    console.log(`${green("✔")} Removed sample-app directory`);
  }

  // Remove PRD items tagged with 'sample-app'
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
  console.log(`${green("✔")} Sample app destroyed successfully!`);
}
