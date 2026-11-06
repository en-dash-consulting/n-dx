/**
 * Load `preact/compat` before every web test file, as the shipped viewer does.
 *
 * `src/viewer/main.ts` imports the components barrel, which exports
 * `FloatingNotice`, which imports `createPortal` from `preact/compat`. Loading
 * compat installs a global `options.vnode` hook that gives DOM props React's
 * event semantics: `onBlur` listens on `focusout`, `onFocus` on `focusin`, and
 * `onChange` on a text-like or range input on `input`. So in the real viewer,
 * and in any test that renders a component importing compat, those are the
 * events that reach a handler.
 *
 * The web:shared project runs with `isolate: false`, so compat's hook, once
 * any file in a worker imports it, applies to every later file in that worker.
 * A test that dispatched a bare `blur` or `change` passed when it ran first and
 * failed when a compat-importing file ran before it (#820's CI run
 * 42145313910). Loading compat here makes every file run in the viewer's own
 * mode, whatever the order.
 *
 * Under the "node" environment nothing renders into a DOM, so the import is
 * harmless there.
 */
import "preact/compat";
