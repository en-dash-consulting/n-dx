---
"@n-dx/hench": patch
---

Autonomous CLI runs are told to run validation in the foreground. The agent had been backgrounding a long validate command and then ending its turn to wait for a notification — a habit that works in an interactive session, where something resumes it, and silently ends a hench run, where nothing does. The turn ended before the agent's commit step, so the completion gate refused the task for its own uncommitted work and reset it: three of three runs in one session, each finished by hand. The system prompt now carries a foreground invariant for CLI runs, alongside the existing plan-mode one, and says that the suite is run again after the agent finishes so there is no reason to double-check it.
