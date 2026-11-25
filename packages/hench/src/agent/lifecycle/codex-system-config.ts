import { lstatSync, readlinkSync, statfsSync } from "node:fs";
import { exec } from "../../prd/llm-gateway.js";

/** An empty layer is still loaded by exec. Check from the root down so a
 * missing component is safe only when its parent cannot be changed. */
export async function isProtectedCodexConfig(file: string): Promise<boolean> {
  if (process.platform !== "darwin" && process.platform !== "linux") return false;
  const parts = file.split("/");
  if (parts.shift() !== "" || parts.some(p => !p || p === "." || p === ".." || /[\x00-\x1f\x7f]/.test(p))) return false;
  let path = "/";
  try {
    for (;;) {
      let stat;
      try {
        stat = lstatSync(path);
      } catch (error) {
        // Absence is safe only after traversing each existing ancestor.
        return path !== "/" && (error as NodeJS.ErrnoException).code === "ENOENT";
      }
      if (stat.uid !== 0) return false; // Even a read-only owner can chmod it.
      if (!stat.isSymbolicLink() && (stat.mode & 0o022) !== 0) return false;
      const fsType = statfsSync(path).type;
      if (process.platform === "darwin") {
        if (fsType !== 26) return false; // APFS
        // An extended ACL can grant create, delete or chmod independently
        // of mode bits. Refuse any ACL or an unreadable ACL listing.
        const result = await exec("/bin/ls", ["-ldne", path], { cwd: "/", env: { LC_ALL: "C" }, timeout: 2000 });
        if (result.exitCode !== 0 || result.error || result.stderr) return false;
        const listing = result.stdout.trimEnd();
        if (!/^[dl-][rwxStTs-]{9}@?\s/.test(listing) || listing.includes("\n")) return false;
      } else {
        // On these local Linux filesystems the group mode bits include the
        // POSIX access ACL mask. Unknown filesystem ACL semantics refuse.
        if (![0xef53, 0x58465342, 0x9123683e, 0x01021994].includes(fsType)) return false;
      }
      if (stat.isSymbolicLink()) {
        // Inspect the verified macOS alias and its target from /.
        if (process.platform !== "darwin" || path !== "/etc" || readlinkSync(path) !== "private/etc") return false;
        parts.unshift("private", "etc");
        path = "/";
        continue;
      }
      if (parts.length === 0) return stat.isFile();
      if (!stat.isDirectory()) return false;
      path += (path === "/" ? "" : "/") + parts.shift();
    }
  } catch {
    return false;
  }
}
