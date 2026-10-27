---
id: "090749f5-1693-4d49-9a88-47387823670d"
type: "change"
title: "Build full-page N-eolithic dino animation overlay with dismiss interaction"
slug: "build-full-page-n-eolithic-dino"
intent: "Create a full-viewport overlay component that renders the TTY dino animation (reusing or adapting the existing cli-brand dino asset) and displays the caption 'Oops, you clicked so hard you ended up in the N-eolithic age with the N-Rex!' beneath it. The overlay mounts when the gesture detector fires its event, blocks the main UI, and dismisses on any click or keypress — returning the user to normal state."
acceptanceCriteria:
  - "Overlay covers the full viewport and sits above all other content (z-index above nav, modals, tooltips)"
  - "TTY dino animation plays immediately on mount using the existing cli-brand dino asset or an equivalent ASCII/SVG reproduction"
  - "Caption text 'Oops, you clicked so hard you ended up in the N-eolithic age with the N-Rex!' is visible below the animation"
  - "Overlay dismisses on any click anywhere or any keypress, returning to the normal view"
  - "Component renders correctly on viewport widths 320 px–2560 px without layout overflow"
  - "No memory leaks: event listeners and animation timers are cleaned up on unmount"
touches:
  - "3319282b-6b83-4d6d-b729-2c7b8526b9a4"
priority: "low"
tags:
  - "web"
  - "ui"
  - "easter-egg"
  - "animation"
source: "smart-add"
---
