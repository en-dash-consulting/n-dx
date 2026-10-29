---
id: "7981ad93-b31e-4404-bfd9-90772778aba4"
type: "change"
title: "Redact every run sink and widen the redactor"
slug: "redact-every-run-sink-and-widen-the"
intent: "Run records and run logs pass redactDeep, but the run events sidecar, the execution log append path and adversarial review reports are written unredacted, and the redactor misses 28 of 68 probed secret shapes. Secret-bearing files are also created at default mode before being tightened."
acceptanceCriteria:
  - "openRunEvents.append, rex appendLog and the adversarial review report writer pass summary, detail and findings through the shared redactor, and C0 control characters are stripped when detail is rendered"
  - "redact.ts covers the probed misses (bare AWS secret keys, Authorization: Token, Bearer under 16 characters, SAS and S3 signatures, PGP private key blocks, *_PASS and PWD assignments, sk_live_ and rk_live_, encryption and signing keys, SENTRY_DSN, Slack webhooks, Cookie headers, SendGrid, Twilio, Vault, Shopify and --token flag forms) with each case in redact.test.ts"
  - ".n-dx.local.json is written to a temp file with mode 0600 and renamed into place; .hench/runs and .run-logs are created with mode 0700; a key is never written to a file that git check-ignore does not report as ignored"
touches:
  - "6eb227af-ffb2-4f39-8f62-d4afbad09a57"
priority: "medium"
source: "ndx-capture"
---
