---
id: "b889a2d9-e14d-448c-afd8-b00315c93e6b"
level: "task"
title: "Give review its own model tier with a review-model override"
status: "completed"
priority: "high"
startedAt: "2026-08-26T04:45:02.052Z"
completedAt: "2026-08-26T04:45:02.052Z"
endedAt: "2026-08-26T04:45:02.052Z"
acceptanceCriteria: []
description: "Add REVIEW_MODELS and resolveReviewModel to llm-client. Resolution order: the CLI override, then llm.<vendor>.reviewModel, then llm.reviewModel, then the vendor default (claude: claude-opus-5). llm.model and llm.<vendor>.model are deliberately excluded so pinning a cheap executor cannot silently downgrade the reviewer. Passing the override without enabling review is an error, not a no-op. Review is read-heavy and judgment-dense but short, so a stronger model costs little in absolute terms."
lastModified: "2026-08-26T04:45:02.060Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
