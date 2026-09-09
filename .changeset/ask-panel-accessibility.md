---
"@n-dx/web": patch
---

Bring the SourceVision Ask panel to the dashboard's accessibility bar

The panel had `aria-live` on each of its state cards, which reads as correct and is not: a live region only announces mutations inside a region the assistive technology was already monitoring, so every announcement was riding on a freshly inserted node and most screen readers stayed silent. For an exchange whose answer arrives after an indeterminate wait, that was the one announcement that mattered. Announcements now come from a single persistent region; failures keep their own `role="alert"`, which does fire on insertion, so nothing is said twice.

Focus is no longer lost. The prompt field goes read-only rather than disabled while a question is in flight, and the submit control uses `aria-disabled` — a disabled control drops out of the tab order and hands focus back to the body, which for the length of an LLM call left a keyboard user stranded. Opening the capture confirm gate unmounted its own trigger and dumped focus on `<body>`; focus now follows the interaction into the gate and back out again on confirm, cancel, or failure, and the trigger stays mounted so there is always somewhere for it to land. A reset from a new question no longer pulls focus out of the textarea.

Error states carry a text marker as well as a colour, and the decorative glyphs are hidden from assistive technology so the words carry the meaning.
