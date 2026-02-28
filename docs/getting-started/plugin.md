# Guide: Creating a Wasm Plugin

This guide walks you through creating a simple plugin for the Orchestrator using Rust (recommended) or any language that compiles to Wasm/WASI.

## Prerequisites
- Rust and `cargo` installed.
- `cargo-wasi` or `wasm32-wasi` target installed (`rustup target add wasm32-wasi`).

## Step 1: Initialize Project

```bash
cargo new --lib my-plugin
cd my-plugin
```

Edit `Cargo.toml`:

```toml
[lib]
crate-type = ["cdylib"]

[dependencies]
extism-pdk = "1.0"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

## Step 2: Write Plugin Code

Edit `src/lib.rs`:

```rust
use extism_pdk::*;
use serde::{Deserialize, Serialize};

#[plugin_fn]
pub fn on_start() -> FnResult<()> {
    // Log startup
    info!("My Plugin started!");

    // Example: Read from Vault
    let secret = host::vault_read("my-api-key")?;
    if let Some(key) = secret {
        info!("Found API key: {}", key);
    } else {
        warn!("No API key found.");
    }

    Ok(())
}

// Helper to call host functions (pseudo-code, you'd wrap the imports)
mod host {
    use extism_pdk::*;

    #[host_fn("extism:host/user", "vault_read")]
    extern "C" {
        fn vault_read(key: String) -> String;
    }
}
```

## Step 3: Create Manifest

Create `plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "permissions": [
    "vault:read:my-api-key"
  ]
}
```

## Step 4: Build & Package

```bash
cargo build --target wasm32-wasi --release
cp target/wasm32-wasi/release/my_plugin.wasm .
zip my-plugin.zip plugin.json my_plugin.wasm
```

## Step 5: Install

```bash
orch plugin install ./my-plugin.zip
```
