---
"@n-dx/web": patch
---

Explain a finding in plain language from the Problems and Suggestions surfaces

Every finding row now carries an Explain action that opens the Ask panel on that finding and answers immediately. The finding travels as structured seed context — type, severity, zone, message, files — not as a sentence assembled in a button handler: the surfaces know the finding, and the endpoint owns how an explanation is framed.

The requirements that make an explanation an explanation rather than a definition live server-side, appended to the prompt only for a finding seed: name the seeded zone and files and say what about them produced the finding, say what a fix would touch and how far its blast radius reaches, and say when the analysis does not carry what a clause needs rather than filling it in from general knowledge. Putting the contract in the prompt builder rather than in client prose is what makes it assertable without calling a model.

A finding with no severity is carried through without one being invented, and the `global` scope sentinel is dropped rather than sent as a zone name that no zone has. The seed is a one-shot hand-off, so returning to the panel later opens it empty instead of silently re-asking the last finding. A seeded answer supports Copy and Capture-to-PRD exactly as a free-form one does.
