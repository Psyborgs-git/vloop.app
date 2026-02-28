## 2024-05-24 - [Parallelize MCP Server Tools Resolution]
**Learning:** In the `AgentBuilder` of `packages/ai-agent`, resolving multiple MCP tools was done sequentially via a `for...of` loop where each `mcpClientManager.getTools(serverConfig)` awaited sequentially. This introduced an O(n) latency penalty when an agent has multiple external MCP servers attached.
**Action:** Next time you see `await` inside a `for...of` loop doing network/RPC requests (like MCP server initialization), consider replacing it with `Promise.all` combined with `.map()` to fetch in parallel.
