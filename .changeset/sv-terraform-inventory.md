---
"@n-dx/sourcevision": patch
---

Terraform files enter the inventory. In every repository, `.tf`, `.tfvars`, `terragrunt.hcl` and `*.tftest.hcl` files now get `inventory.json` entries, so `.tf` and `.tfvars` no longer appear in `summary.skippedExtensions`. A repository with a `.tf` file within three directory levels of the root also gains `terraform` in `manifest.languages`; Terraform is the primary language only when no other language marker matches. Terraform files produce no import edges, and `infrastructure.json` is unchanged.
