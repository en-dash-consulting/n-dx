---
"@n-dx/sourcevision": patch
---

Fix the isometric map being unresponsive to clicks. Blocks listened on both `pointerup` and `click` while selection toggled, so one physical click fired twice and deselected immediately — the map appeared inert. Blocks now listen on `click` only and selection is set rather than toggled. Connectors are also clickable now, with a widened transparent hit target and a panel describing the dependency and both its ends, and the detail panel scrolls into view on narrow layouts where it sits below the map.
