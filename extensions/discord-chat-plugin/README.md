# Discord Chat Plugin

A Rust + Extism example plugin for the fixed chat task contract.

This example is intentionally host-driven: the plugin does not talk to Discord directly. Instead, it uses the stable Extism host ABI to queue:

- contact upserts
- chat send requests
- AI planning/inference requests
- notification events

## Build

```bash
cd extensions/discord-chat-plugin
rustup target add wasm32-wasip1
cargo build --target wasm32-wasip1 --release
cp target/wasm32-wasip1/release/discord_chat_plugin.wasm .
zip discord-chat-plugin.zip plugin.json discord_chat_plugin.wasm
```

## Install

```bash
orch plugin install ./discord-chat-plugin.zip
orch plugin grant discord-chat-plugin \
  --permissions vault:read:discord-bot-token \
                contacts:write \
                chat:write \
                agent:run \
                notifications:publish
```

The plugin publishes to topics such as:

- `notifications.plugin.discord-chat-plugin.contacts.upsert`
- `notifications.plugin.discord-chat-plugin.chat.send`
- `notifications.plugin.discord-chat-plugin.ai_inference.plan`
- `notifications.plugin.discord-chat-plugin.notifications.event`

This allows a Discord bridge service to subscribe on the notifications bus and perform the actual Discord API interactions outside the Wasm sandbox.
