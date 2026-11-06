---
"@n-dx/core": patch
"@n-dx/llm-client": patch
---

`ndx config credentials` and `ndx status` name a credential store n-dx refused to read (readable by other users, invalid JSON, unknown version) and its fix, instead of reporting no key. Warnings the credential CLI prints on a successful write now reach the user, and storing a key into a store others could read warns to rotate the keys it held.
