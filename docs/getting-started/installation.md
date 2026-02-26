# Installation

vloop runs as a local daemon service, offering a powerful CLI and API for orchestration. You can install it via pre-built binaries, npm, or by building from source.

## Prerequisites

*   **Operating System**: macOS, Linux, or Windows (WSL2 recommended).
*   **Node.js**: v18+ (if installing via npm/source).
*   **Docker**: Required for container orchestration features.
*   **Python**: v3.10+ (optional, for Python plugins).

## Option 1: Install via NPM (Recommended)

The easiest way to get started is using `npm` or `pnpm`. This installs the `orch` CLI globally.

```bash
# Install globally
npm install -g @orch/cli

# Verify installation
orch --version
```

## Option 2: Build from Source

For developers contributing to the project or needing the absolute latest changes:

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/vloop/vloop.git
    cd vloop
    ```

2.  **Install dependencies**:
    ```bash
    pnpm install
    ```

3.  **Build the project**:
    ```bash
    pnpm build
    ```

4.  **Link the CLI globally**:
    ```bash
    # From the root directory
    cd packages/cli
    npm link
    ```

## Post-Installation Setup

Once installed, you need to initialize the daemon. This sets up the encrypted vault and configuration files.

1.  **Start the daemon**:
    ```bash
    # Run in foreground to see logs initially
    orch daemon start
    ```

2.  **Initialize the system**:
    Open a new terminal window and run:
    ```bash
    orch auth login
    # Follow the prompts to create your admin account
    ```

3.  **Verify connectivity**:
    ```bash
    orch health check
    # Output: { status: "healthy", ... }
    ```
