---
"@n-dx/sourcevision": patch
---

Terraform files enter the inventory. In every repository, `.tf`, `.tfvars`, `terragrunt.hcl` and `*.tftest.hcl` files now get `inventory.json` entries, so `.tf` and `.tfvars` no longer appear in `summary.skippedExtensions`. A repository with a Terraform file at any depth also gains `terraform` in `manifest.languages`; Terraform is secondary beside any language marker or Java build file, and a repository with no marker keeps TypeScript primary and Terraform secondary whenever it has any source the TypeScript fallback is for; Terraform is primary only when there is none. Terraform files produce no import edges, and `infrastructure.json` is unchanged.
