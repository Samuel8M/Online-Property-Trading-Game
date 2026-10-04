---
name: Debt recovery policy
description: Why debt recovery pauses turn expiry and restricts estate transfers
---

Debt recovery prioritizes an explicit debtor choice over automatic turn progression.

**Why:** The user requested a chance to sell buildings or mortgage properties before choosing bankruptcy. Treating a normal turn timeout as permission to skip the debt or eliminate the debtor would defeat that change, especially after a reload or disconnect.

**How to apply:** Any future offline-debtor policy needs an explicit product decision; do not silently reuse the normal turn timeout to settle, forgive, or bankrupt a saved debt.

Debt recovery permits narrowly authorized cash-raising trades, not ordinary trading.

**Why:** Trades reserve nothing. Protecting the creditor's saved claim takes priority over allowing incremental deed sales: a deed must not leave an insolvent estate unless actual post-trade cash covers the full obligation. A liquidation estimate or negotiated property valuation is not secured payment.

**How to apply:** Keep debt offers tied to the saved obligation, permit only its debtor to propose (even off-turn), require positive net cash, and fully cash-cover debt whenever debtor deeds leave. Incoming cash help can be partial. Ordinary offers stay paused. Acceptance never implicitly settles, and must serialize with explicit settlement/bankruptcy. Changing this conservative estate-protection policy is a rule extension, not a validation cleanup.