---
id: "421a6860-70c1-4f5c-879b-da51dc45599a"
type: "capability"
title: "Selective Recommendation Acceptance Syntax"
slug: "selective-recommendation-acceptance"
statement: "The `recommend --accept` command accepts either every recommendation or only the recommendations picked by an equals-prefixed index list such as `=1,4,5`, and it gives clear feedback when the selector is malformed or out of range."
criteria: [{"id":"c1","text":"When the user passes an equals-prefixed index list (for example `=1,4,5`) to `recommend --accept`, the CLI shall accept only the recommended items at those indices."},{"id":"c2","text":"When `recommend --accept` is given no index selector, the CLI shall accept all recommendations."},{"id":"c3","text":"If the index selector passed to `recommend --accept` is malformed, the CLI shall reject it with a clear error message."},{"id":"c4","text":"If the index selector passed to `recommend --accept` names an index outside the range of recommended items, the CLI shall reject it with a clear error message."}]
source: "smart-add"
---
