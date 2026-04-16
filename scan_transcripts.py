#!/usr/bin/env python3
"""Scan 50 most-recent Claude transcript JSONL files and report Bash/MCP tool-call frequencies."""
import json, os, sys, re
from collections import Counter

BASE = os.path.expanduser("~/.claude/projects/")

# Collect all JSONL files sorted by mtime descending
all_files = []
for root, dirs, fnames in os.walk(BASE):
    for fn in fnames:
        if fn.endswith(".jsonl"):
            fp = os.path.join(root, fn)
            try:
                mtime = os.path.getmtime(fp)
                all_files.append((mtime, fp))
            except OSError:
                pass

all_files.sort(reverse=True)
recent_50 = [fp for _, fp in all_files[:50]]

bash_cmds = Counter()
mcp_tools = Counter()
errors = []

for fp in recent_50:
    try:
        with open(fp, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("type") != "assistant":
                    continue
                msg = obj.get("message", {})
                for item in msg.get("content", []):
                    if item.get("type") != "tool_use":
                        continue
                    name = item.get("name", "")
                    inp = item.get("input", {})
                    if name == "Bash":
                        cmd = inp.get("command", "").strip()
                        bash_cmds[cmd] += 1
                    elif name.startswith("mcp__"):
                        mcp_tools[name] += 1
    except Exception as e:
        errors.append(f"{fp}: {e}")

print(f"Scanned {len(recent_50)} files")
print(f"Errors: {len(errors)}")
print()
print("=== TOP BASH COMMANDS (raw) ===")
for cmd, count in bash_cmds.most_common(80):
    print(f"{count:4d}  {cmd[:120]}")
print()
print("=== MCP TOOLS ===")
for tool, count in mcp_tools.most_common(40):
    print(f"{count:4d}  {tool}")

if errors:
    print()
    print("=== ERRORS ===")
    for e in errors[:10]:
        print(e)
