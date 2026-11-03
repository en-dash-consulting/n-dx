---
"@n-dx/rex": patch
---

Applying a `modified` amendment now keeps a capability's requirements in step with its criteria: the requirement linked to a replaced criterion (the one the criterion names, or `<capability id>:<criterion id>` as the migration links them) takes the new text as its title and acceptance criterion, keeping its linked tests and command, and the one linked to a removed criterion is dropped. Before, the product layer kept restating the old rule in the requirement.
