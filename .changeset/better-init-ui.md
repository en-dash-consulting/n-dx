---
"@n-dx/core": patch
---

Immersive animated init experience with Ink TUI framework

- Walking T-Rex mascot with shaded pixel art (half-block fg/bg color technique)
- Ink-based animated UI with React components (htm/react for JSX without build step)
- Braille spinners for each init phase, smooth animation via child process offloading
- Sourcevision fast analysis (--fast) runs during init for immediate codebase data
- Graceful degradation: static fallback for non-TTY, --quiet mode, NO_COLOR support
- Actionable next-steps menu with CLI commands and skill suggestions
- New dependencies: ink, react, htm
