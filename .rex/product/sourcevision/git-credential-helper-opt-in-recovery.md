---
id: "a04a7979-057e-4cdf-a849-63ff9e966063"
type: "capability"
title: "Git Credential Helper Opt-In Recovery"
slug: "git-credential-helper-opt-in-recovery"
statement: "The product gives users an explicit, user-invoked way to set up git credentials after a refresh fails on authentication, and keeps refresh runs non-interactive by default."
criteria: [{"id":"c1","text":"When a refresh fails for an authentication-related reason, the product shall provide an explicit, user-invoked command path to set up git credentials."},{"id":"c2","text":"The credential helper setup shall run only when the user invokes it and shall not add interactive prompts to default flows."},{"id":"c3","text":"When a refresh fails for an authentication-related reason, the refresh failure handling shall include guidance on the credential helper."},{"id":"c4","text":"While a refresh runs in an automated or scripted context, the refresh command shall stay non-interactive by default."}]
source: "smart-add"
---
