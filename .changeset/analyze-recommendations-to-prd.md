---
"@n-dx/web": patch
---

Every recommendation in the Analyze page's Recommended fixes tile now has a "+ PRD" button, and the opened tile can add every recommendation shown at once, after a confirm step.

On a v2 PRD each recommendation becomes its own change in the Inbox. It carries its full text, the zones it touches, what acting on it would add, a priority taken from its severity, and `sourcevision`, `recommendation`, kind and `zone:<id>` tags. A readiness gap's remedy becomes its acceptance criterion. A v1 PRD gets them under one "SourceVision Recommendations" parent instead. Recommendations whose title the PRD already holds are skipped, and each row then reads "✓ Added" or "✓ In PRD". The buttons are absent from a static export, which has no server to write to. The route is `POST /api/rex/capture-recommendations`.
