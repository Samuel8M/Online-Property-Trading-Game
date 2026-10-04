---
name: Saved-table recovery intent
description: Privacy and consent requirements for browser-saved tables and spectator browsing
---

Saved-table discovery is private to the browser that saved the seat. It must not resume rooms automatically: the player must explicitly choose Return. Watching must remain spectator-only even when this browser owns a saved seat.

**Why:** Public discovery intentionally excludes paused games. The user requested code-free recovery without exposing saved rooms publicly or letting browsing restart a table's deadlines.

**How to apply:** Keep discovery and spectator requests unauthenticated. Treat sending a saved seat token as a presence-changing action, not as an innocuous metadata lookup. Use separate spectator cache entries so browsing cannot inherit player controls.