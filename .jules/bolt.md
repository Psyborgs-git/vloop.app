## 2024-05-24 - Cached RegExp Compilation in Hot Paths
**Learning:** Instantiating `RegExp` objects on every keystroke in terminal input validation creates a significant CPU bottleneck on the hot path. However, since the validation patterns (`inputBlockPatterns`) can come from dynamic policies, caching them unbounded can cause memory leaks.
**Action:** Always use a bounded cache (e.g., a `Map` with max size limit and LRU-like eviction) when compiling regex patterns that run on high-frequency hot paths like terminal input streams.
