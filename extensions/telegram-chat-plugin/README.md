# Telegram Chat Plugin

A Rust + Extism example plugin that targets the fixed `task: "chat"` host contract.

It demonstrates how a Telegram bridge can:

- inspect the host contract with `host_get_contract`
- read its API token from Vault with `vault_read`
- queue plugin-scoped contacts and chat requests
- hand off AI inference work to the host
- publish non-core notifications onto the notifications event bus

## Build

```bash
cd extensions/telegram-chat-plugin
rustup target add wasm32-wasip1
cargo build --target wasm32-wasip1 --release
cp target/wasm32-wasip1/release/telegram_chat_plugin.wasm .
zip telegram-chat-plugin.zip plugin.json telegram_chat_plugin.wasm
```

## Install

```bash
orch plugin install ./telegram-chat-plugin.zip
orch plugin grant telegram-chat-plugin \
  --permissions vault:read:telegram-bot-token \
                contacts:write \
                chat:write \
                agent:run \
                notifications:publish
```

At runtime the plugin queues requests under topics such as:

- `notifications.plugin.telegram-chat-plugin.contacts.upsert`
- `notifications.plugin.telegram-chat-plugin.chat.send`
- `notifications.plugin.telegram-chat-plugin.ai_inference.reply`
- `notifications.plugin.telegram-chat-plugin.notifications.event`

An external bridge worker can subscribe to those topics and perform the actual Telegram API work with secrets fetched securely from Vault.
