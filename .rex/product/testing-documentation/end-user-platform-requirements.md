---
id: "087ff59e-ba8c-4be6-a975-a5c170362498"
type: "capability"
title: "End-User Platform Requirements"
slug: "end-user-platform-requirements"
statement: "The n-dx README states which operating systems are supported and the minimum Node.js and pnpm versions, so users can check their environment before installing."
criteria: [{"id":"c1","text":"The README shall contain a platform support table that covers macOS, Linux, Windows native and Windows WSL."},{"id":"c2","text":"The platform support table shall give each operating system row a support level of supported, experimental or unsupported, with a brief note."},{"id":"c3","text":"Where Windows native is unsupported, the README shall reference or link the Windows Docker path."},{"id":"c4","text":"The platform support table shall claim support only for platforms that the CI or gauntlet configuration covers."},{"id":"c5","text":"The README Quick Start shall list the minimum Node.js version and the minimum pnpm version that end users need."},{"id":"c6","text":"The engines field in the @n-dx/core package.json shall match the Node.js version requirement that the README documents."},{"id":"c7","text":"If pnpm is required, the docs shall not present npm as the install mechanism unless they explain how the two differ."}]
source: "smart-add"
---

Surface clear, accurate OS and runtime version requirements so users know before installing whether their environment is supported.
