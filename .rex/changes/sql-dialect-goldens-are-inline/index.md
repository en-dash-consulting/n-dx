---
id: "28654161-87ce-46fe-a7a9-d119953b35be"
type: "change"
title: "SQL dialect goldens are inline PetClinic-shaped snippets, never checked against PetClinic's real schema files"
slug: "sql-dialect-goldens-are-inline"
intent: "Verdict: should-fix (ndx-adversarial-review of a0e35c39).\n\npackages/sourcevision/tests/unit/language/sql-dialects.test.ts PETCLINIC goldens are hand-written one-line snippets. Nothing runs classifySqlDialect over spring-petclinic @500158f7's 7 .sql files (db/h2, db/mysql incl. user.sql, db/postgres schema+data). The golden also includes a db/hsqldb file that this PetClinic revision does not ship. If the real postgres schema uses e.g. GENERATED ... AS IDENTITY instead of SERIAL, or the mysql files lack ENGINE=, the real confidences differ from the goldens and the acceptance claim \"PetClinic's schema files are classified to their dialects in goldens\" is only asserted.\n\nOptions: (a) extend scripts/sql-corpus-report.mjs to print dialect/confidence/evidence per file and record the PetClinic results in the rex log (cheap, no committed corpus); (b) copy the 7 files as a fixture under tests/fixtures (licence: Apache-2.0, small) and make the goldens read them (stronger, adds fixture). Recommend (b) if the licence notice is acceptable, else (a)."
acceptanceCriteria:
  - "Goldens classify the content of PetClinic @500158f7's real db/h2, db/mysql and db/postgres .sql files, not hand-written snippets"
  - "Each golden asserts dialect, confidence and evidence rule ids for every PetClinic .sql file"
  - "No golden names a file PetClinic does not ship (db/hsqldb)"
touches:
  - "d8fccdeb-f9b5-4da2-be41-c5594fa0451f"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "language-packs"
  - "sql"
  - "sourcevision"
source: "ndx-adversarial-review"
---
