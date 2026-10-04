---
name: Rebase auto-merges
description: A clean conflict-marker scan is not sufficient to validate automatically combined route files.
---
When resolving rebase conflicts, inspect marker-free files that both branches edited, especially route handlers. Check the combined code with typechecking and the relevant API tests.

**Why:** An automatic merge combined unrelated handler bodies and duplicated route loops without leaving conflict markers or listing that file as conflicted. Only inspecting the merged route file revealed the malformed result.

**How to apply:** Do not assume that files omitted from the conflict list are semantically merged correctly. Preserve both branches' endpoints and authorization paths, regenerate client outputs from the combined contract, and validate the combined server.