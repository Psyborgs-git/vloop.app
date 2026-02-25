---
name: create-integrated-feature
description: >
  **WORKFLOW SKILL** — assist in designing, implementing, and integrating a
  new feature or service in the vloop.app monorepo. Use when you have
  requirements/specs and need end‑to‑end support: analyzing architecture,
  picking the right package, scaffolding code, writing tests, and ensuring
  DRY, modular, single‑responsibility, performant implementation.
---

## When to invoke

- You need to **add new functionality** to the system.
- You have a **spec or user story** and want step‑by‑step help.
- You want to ensure your code **fits existing conventions** and is
  **maintainable**.

## Workflow

1. **Gather requirements**  
   Ask the user to describe the new feature/service, intended behavior,
   domain, APIs, UI, or CLI interactions.

2. **Explore repository context**  
   Use read-only subagent to inspect relevant packages (e.g., `packages/*`,
   `cli`, `auth`, `daemon`, etc.), existing patterns, utilities, and tests.

3. **Choose a target package or module**  
   Decide where the code belongs — create new package if appropriate or add
   to an existing one.

4. **Design high-level architecture**  
   Sketch modules, interfaces, data flows, and dependencies. Keep
   single‑responsibility and modular separation.

5. **Scaffold code**  
   - Create new files/folders.
   - Add exports to index files.
   - Set up tests alongside implementation (`*.test.ts`).
   - Use existing helpers and patterns (e.g., `shared/`, `zod` schemas).

6. **Implement feature**  
   Write code incrementally with small commits: logic, error handling,
   validation.

7. **Write / update tests**  
   Ensure unit and integration tests cover new behavior. Use `pnpm vitest`
   to run them.

8. **Integrate with system**  
   - Wire up CLI commands, HTTP routes, orchestrator handlers, etc.
   - Register new service with container, daemon, or UI as needed.
   - Update documentation (`docs/`, `architecture/`, `cli.md`, etc.).

9. **Performance considerations**  
   Avoid expensive loops; cache results; use streaming when appropriate.

10. **Review and refactor**  
    Make code DRY, remove duplication, finalize naming.

11. **Run lint and type checks**  
    Fix any `get_errors` or `eslint` problems.

12. **Create a pull request**  
    Summarize changes and highlight design decisions.

## Quality criteria

- Code adheres to **DRY**, **single responsibility**, and **modularity**.
- Follows existing **directory/package conventions**.
- All new code is accompanied by **tests and documentation**.
- No TypeScript or linter errors remain.
- New feature is integrated into CI (scripts/ etc. if needed).

## Examples

- "Add a new `task-scheduler` service under `packages` providing timed task execution."
- "Implement a `removeUser` CLI command that revokes tokens and cleans up data."
- "Create a new authenticated GraphQL endpoint for fetching user devices."

## Related skills

- `agent-customization` (for general workspace workflows)
- `testing-guidelines` (if available)
