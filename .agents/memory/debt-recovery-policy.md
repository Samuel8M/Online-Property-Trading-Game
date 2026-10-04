---
name: Debt recovery policy
description: Why debt recovery pauses turn expiry and excludes trading
---

Debt recovery prioritizes an explicit debtor choice over automatic turn progression.

**Why:** The user requested a chance to sell buildings or mortgage properties before choosing bankruptcy. Treating a normal turn timeout as permission to skip the debt or eliminate the debtor would defeat that change, especially after a reload or disconnect.

**How to apply:** Any future offline-debtor policy needs an explicit product decision; do not silently reuse the normal turn timeout to settle, forgive, or bankrupt a saved debt.

Trading during debt recovery is intentionally outside the accepted recovery scope.

**Why:** The requested cash-raising options are building sales and mortgages. Existing trades reserve nothing, so enabling them without debt-aware validation would allow the debtor to transfer assets away from the saved creditor.

**How to apply:** A future debt-trading feature must protect the saved obligation and creditor, authorize off-turn debtors explicitly, and serialize acceptance with settlement and bankruptcy.