/**
 * Where the face is served, without the trailing slash: "" at the root, and
 * `/x/graview-face` when the hub mounts it (Vite's `base`, which
 * `bin/serve.js` sets). Every absolute path the page asks for or links to
 * starts with it.
 */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
