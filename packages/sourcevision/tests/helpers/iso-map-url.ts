import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The URL the iso-map DOM tests load the rendered page at: a file URL, as when
 * the map is opened from disk.
 *
 * Built from an absolute path rather than written as `file:///map.html`. On
 * POSIX the two are identical; on Windows the literal has no drive letter, and
 * V8 coverage records the page's inline scripts under it, so
 * `@vitest/coverage-v8` fails the whole run converting it to a path
 * (ERR_INVALID_FILE_URL_PATH). The map reads only `location.hash`, so the
 * path itself never matters to a test.
 */
export const ISO_MAP_URL = pathToFileURL(resolve("/map.html")).href;
