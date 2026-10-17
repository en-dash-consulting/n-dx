---
"@n-dx/sourcevision": patch
---

Recognise Terraform files (`.tf`, `.tfvars`, `terragrunt.hcl`, `*.tftest.hcl`) as the Terraform language. Changes to analysis output:

- Detection: Terraform is detected at any depth. Detection walks the project with the inventory's skip sets and ignore files, so a deep Terragrunt leaf such as `live/prod/us-east-1/vpc/app/terragrunt.hcl` is counted. Any of the four file kinds counts as a Terraform marker. Terraform is a secondary language beside any language marker or Java build file. A repository with no language marker keeps TypeScript primary and Terraform secondary whenever it has any JS/TS source (or source in a language with no config), counting source under directories only JS/TS skips such as `dist/`; such source is still not inventoried. Terraform is primary only when there is no such source at all.
- `.terraform/` skip: `.terraform/` is skipped as a vendored directory in every repository. Downloaded module code in a `.terraform/` that is not gitignored (for example `.js`, `.py` or `.sh` under `.terraform/modules/`) is no longer inventoried, even in a repository with no Terraform.
- Roles: Terraform files get the role `config`, so classification does not read them. A Terraform file under another language's test path (such as `tests/fixtures/infra/main.tf` in a TypeScript repository) gets the role `test`. A `.tftest.hcl` name alone does not make a file a test.
- Zones: Terraform files are left out of zone detection. Adding Terraform to a repository leaves `zones.json` unchanged. The files stay in `inventory.json`.
- Infrastructure linking: `computeInfrastructure` never links a Terraform file as a user of the resource it declares. It recognises the same file set as the inventory, with the same case rules: `.tf` and `.tfvars` by extension in any case, `terragrunt.hcl` and `*.tftest.hcl` by exact, case-sensitive name.
