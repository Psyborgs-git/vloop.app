## 2024-05-24 - [Terminal Regex Bounded Cache]
**Learning:** In the terminal handler, repeated validations against input using RegExp `.test()` within `validateInput` creates an expensive O(N*M) loop that processes continuously stream. When using global (/g) or standard RegExp test in loops, recompiling regexes has overhead.
**Action:** Created a bounded Map cache (max size) to store pre-compiled `RegExp` objects and used `.match()` to avoid stateful `.test()` evaluation across calls.
