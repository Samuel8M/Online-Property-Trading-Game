---
name: Workspace test runtime
description: Native Node execution limitations for shared TypeScript packages in bundled API tests
---

API test bundles must resolve and bundle shared workspace TypeScript packages rather than leaving them as external Node imports.

**Why:** The workspace package entrypoints use TypeScript with extensionless and directory imports. Native Node execution of those external entrypoints fails even though application builds and typechecks succeed. Runtime libraries owned by shared packages also need resolution from their owning package, not from the API artifact.

**How to apply:** Keep workspace dependencies bundled when constructing executable API test bundles. Do not mistake a native Node module-resolution failure for an application or database failure.