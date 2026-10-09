---
"@n-dx/rex": patch
---

The migration plan's Jev review raises a note or flag only for answers at or above a confidence of 0.4 (`jevFlagMinConfidence` in the migration options changes it); weaker answers stay recorded on the entry. The review queue ranks held items first, then entries by number of confident flags, then by confidence, so an undecided answer no longer outranks a confident flag. The summary's flagged counts use the same threshold.
