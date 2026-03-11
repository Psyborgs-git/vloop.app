## 2025-03-12 - [Bounded RegExp Caching for Hot-Path Iteration]
**Learning:** In the `packages/terminal` validation (`validateInput`), dynamically constructing `RegExp` objects per-pattern per-input on hot code paths (e.g. streaming terminal input) introduces severe performance penalties due to regular expression compilation overhead.
**Action:** Always maintain pre-compiled `RegExp` instances in a bounded cache (like `Map` respecting max limit to avoid memory leaks from changing configurations) for validation operations sitting on continuous stream hot paths.
