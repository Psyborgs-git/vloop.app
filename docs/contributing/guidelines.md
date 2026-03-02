# Contributing Guidelines

Thank you for your interest in contributing to vloop! We welcome pull requests, bug reports, and feature requests.

## Development Setup

vloop is a monorepo managed with `pnpm`.

### Prerequisites
*   Node.js v18+
*   pnpm v8+
*   Docker (for running integration tests)

### Initial Setup

1.  **Clone the repo**:
    ```bash
    git clone https://github.com/vloop/vloop.git
    cd vloop
    ```

2.  **Install dependencies**:
    ```bash
    pnpm install
    ```

3.  **Build packages**:
    ```bash
    pnpm build
    ```

### Running Tests

We use `vitest` for testing.

*   **Run all tests**:
    ```bash
    pnpm test
    ```

*   **Run integration tests** (requires Docker):
    ```bash
    pnpm test:integration
    ```

## Project Structure

*   `packages/`
    *   `daemon`: The core server logic.
    *   `cli`: Command-line interface.
    *   `client`: TypeScript SDK.
    *   `ai-agent`: AI orchestration logic.
    *   `container`: Docker integration.
    *   `process`: Process management.
    *   `shared`: Shared types and utilities.
    *   `web-ui`: React frontend.

## Pull Request Process

1.  **Fork** the repository and create a feature branch (`git checkout -b feature/amazing-feature`).
2.  **Commit** your changes using conventional commits (e.g., `feat: add new tool`, `fix: resolve crash`).
3.  **Add Tests** for any new functionality.
4.  **Run Tests** locally to ensure no regressions.
5.  **Submit** a Pull Request against the `main` branch.

## Coding Standards

*   **TypeScript**: Strict mode is enabled. No `any` unless absolutely necessary.
*   **Linting**: Run `pnpm lint` before committing.
*   **Formatting**: We use Prettier.
*   **Database Access**: Use Drizzle ORM for service-level reads/writes. Raw SQL should be limited to migrations/bootstrap DDL or explicit dynamic SQL execution features.
