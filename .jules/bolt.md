## 2024-03-24 - Cache RegExp instances on the terminal input hot path
**Learning:** Compiling regular expressions via `new RegExp(pattern)` for each incoming input payload in `packages/terminal/src/permissions.ts` (the `validateInput` hot path) introduces measurable latency overhead.
**Action:** Always pre-compile and cache `RegExp` objects using a bounded `Map` (to prevent memory leaks from dynamic policies). Avoid using global (`/g`) or sticky (`/y`) flags on cached `RegExp`s, as they maintain state (`lastIndex`) and break subsequent `.test()` calls.
