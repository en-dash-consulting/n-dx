---
"@n-dx/sourcevision": patch
---

Terraform is a recognised language. In a repository with a `.tf` file within three directory levels of the root, `manifest.languages` gains `terraform` and `.tf` and `.tfvars` files gain `inventory.json` entries, so they no longer appear in `summary.skippedExtensions`. `.tfvars` files get the config role and `.terraform/` is skipped. Terraform is primary only when no other language marker matches. Terraform files produce no import edges, and `infrastructure.json` is unchanged.
