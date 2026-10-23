---
id: "fea07c28-af09-4696-9999-18eb37be4fc6"
type: "capability"
title: "ndx plan Post-LLM Progress Feedback"
slug: "ndx-plan-post-llm-progress-feedback"
statement: "After the LLM response finishes, `ndx plan` shows a progress indicator while it builds and displays proposals, so a working run can be told apart from a hung process."
criteria: [{"id":"c1","text":"When `ndx plan` has printed the 'Done.' and 'Vendor: ...' lines, the CLI shall show a spinner or step label right away, with no noticeable gap."},{"id":"c2","text":"While `ndx plan` builds and displays proposals, the CLI shall keep the progress indicator visible."},{"id":"c3","text":"When the proposals are ready, the CLI shall clear the progress indicator and replace it with the next substantive output line."},{"id":"c4","text":"While `ndx plan` writes to a TTY, the CLI shall show the spinner."},{"id":"c5","text":"If `ndx plan` output is piped or is not a TTY, the CLI shall leave out the spinner."},{"id":"c6","text":"If `ndx plan` runs in --quiet or JSON mode, the CLI shall suppress the progress indicator."},{"id":"c7","text":"The CLI shall print the 'Done.' and 'Vendor: ...' lines unchanged while the progress indicator is present."},{"id":"c8","text":"When `ndx plan --accept` runs, the CLI shall show the same progress indicator before it accepts the proposals."},{"id":"c9","text":"When the progress indicator and the proposal output overlap, the CLI shall print no duplicated or garbled output."}]
source: "smart-add"
---

After `ndx plan` prints 'Done.' and 'Vendor: ...' (which marks the end of the LLM response stream), the process appears to stall with no visible output while it processes the response and builds proposals. Users cannot distinguish a working pipeline from a hung process.
