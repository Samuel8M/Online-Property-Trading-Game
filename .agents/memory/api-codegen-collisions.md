---
name: API codegen collisions
description: Non-obvious pitfalls of the workspace's Orval generation setup.
---

Check generated export naming when adding an operation with both path and query parameters. The current generator can give the query TypeScript type and path Zod schema the same name, causing duplicate exports from the validation library.

**Why:** A valid OpenAPI document can generate successfully but then fail the chained library typecheck because the barrel re-exports both names.

**How to apply:** Resolve the export collision at the generation configuration or contract boundary, then regenerate; do not patch generated outputs by hand. Generated browser fetch helpers also use iterable Headers APIs, so the client TypeScript library needs DOM iterable definitions.