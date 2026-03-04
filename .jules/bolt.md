## 2024-05-24 - [Terminal Performance]
**Learning:** Terminal input validation (`validateInput`) runs on the hot path for every incoming payload (often on every keystroke or tiny chunk in streaming environments). Repeatedly compiling the blocklist regexes causes measurable latency overhead during heavy concurrent typing or copy-pasting.
**Action:** Always pre-compile or cache regex patterns on the hot path. A simple `Map<string, RegExp>` caching mechanism effectively reduces this repeated overhead and prevents invalid regex patterns from triggering `try-catch` blocks unnecessarily.
