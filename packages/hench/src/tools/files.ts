import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { simpleGlobMatch } from "../guard/paths.js";
import type { ToolGuard } from "./contracts.js";

export async function toolReadFile(
  guard: ToolGuard,
  params: { path: string },
): Promise<string> {
  const resolved = guard.checkPath(params.path);
  const s = await stat(resolved);
  if (s.size > guard.maxFileSize) {
    throw new Error(
      `File exceeds max size (${s.size} > ${guard.maxFileSize}): ${params.path}`,
    );
  }
  guard.recordFileRead(params.path);
  return await readFile(resolved, "utf-8");
}

export async function toolWriteFile(
  guard: ToolGuard,
  params: { path: string; content: string },
): Promise<string> {
  const resolved = guard.checkPath(params.path);
  const contentSize = Buffer.byteLength(params.content, "utf-8");
  if (contentSize > guard.maxFileSize) {
    throw new Error(
      `Content exceeds max size (${contentSize} > ${guard.maxFileSize})`,
    );
  }
  guard.recordFileWrite(params.path, contentSize);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, params.content, "utf-8");
  return `Wrote ${contentSize} bytes to ${params.path}`;
}

export async function toolListDirectory(
  guard: ToolGuard,
  params: { path: string; recursive?: boolean },
): Promise<string> {
  const resolved = guard.checkPath(params.path);
  const entries: string[] = [];

  async function listDir(dir: string, prefix: string): Promise<void> {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        entries.push(name + "/");
        if (params.recursive) {
          await listDir(join(dir, item.name), name);
        }
      } else {
        entries.push(name);
      }
    }
  }

  await listDir(resolved, "");
  return entries.join("\n");
}

export async function toolSearchFiles(
  guard: ToolGuard,
  params: { pattern: string; path: string; glob?: string },
): Promise<string> {
  const resolved = guard.checkPath(params.path);

  let regex: RegExp;
  try {
    regex = new RegExp(params.pattern);
  } catch {
    throw new Error(`Invalid regex pattern: ${params.pattern}`);
  }

  const results: string[] = [];
  const MAX_RESULTS = 50;

  async function searchDir(dir: string, prefix: string): Promise<void> {
    if (results.length >= MAX_RESULTS) return;

    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      if (results.length >= MAX_RESULTS) break;

      const name = prefix ? `${prefix}/${item.name}` : item.name;

      if (item.isDirectory()) {
        if (item.name === "node_modules" || item.name === ".git") continue;
        await searchDir(join(dir, item.name), name);
      } else {
        // Check glob filter if provided
        if (params.glob && !simpleGlobMatch(params.glob, name)) {
          continue;
        }

        try {
          const filePath = join(dir, item.name);
          const s = await stat(filePath);
          if (s.size > guard.maxFileSize) continue;

          const content = await readFile(filePath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${name}:${i + 1}: ${lines[i]}`);
              if (results.length >= MAX_RESULTS) break;
            }
          }
        } catch {
          // Skip files that can't be read (binary, permissions, etc)
        }
      }
    }
  }

  await searchDir(resolved, "");

  if (results.length === 0) {
    return "No matches found";
  }

  const output = results.join("\n");
  if (results.length >= MAX_RESULTS) {
    return output + `\n... (truncated at ${MAX_RESULTS} results)`;
  }
  return output;
}
