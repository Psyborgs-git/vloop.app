
## 2025-02-13 - Regex recompilation overhead in hot paths
**Learning:** Terminal input validation (`validateInput`) runs on a very hot path for every incoming payload. Recompiling regular expressions inside the loop caused a significant performance overhead.
**Action:** Always pre-compile or cache (`Map<string, RegExp>`) regular expressions used in hot paths like continuous input validation, rather than instantiating `new RegExp()` on every call.
