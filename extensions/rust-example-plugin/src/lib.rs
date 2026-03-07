// Rust example plugin for the Orchestrator's @extism/extism plugin system.
//
// Demonstrates:
//  - Logging via log_info / log_error host functions.
//  - Subscribing to a system event topic.
//  - Publishing a plugin-scoped event.
//  - Responding to incoming events via `on_event`.
//
// Build:
//   cargo build --target wasm32-wasip1 --release
//
// Package:
//   cp target/wasm32-wasip1/release/rust_example_plugin.wasm .
//   zip rust-example-plugin.zip plugin.json rust_example_plugin.wasm
//
// Install:
//   orch plugin install ./rust-example-plugin.zip
//   orch plugin grant rust-example-plugin \
//     --permissions events:subscribe:container.started \
//                   events:publish

use extism_pdk::*;
use serde::Deserialize;

// ── Host function imports ─────────────────────────────────────────────────
//
// These are provided by the orchestrator's PluginSandbox.
// The import module MUST be "extism:host/user".

#[link(wasm_import_module = "extism:host/user")]
extern "C" {
    /// Log an INFO-level message. `ptr` is an Extism memory offset.
    fn log_info(ptr: u64);
    /// Log an ERROR-level message. `ptr` is an Extism memory offset.
    fn log_error(ptr: u64);
    /// Subscribe to an event topic. Returns a JSON result offset.
    fn events_subscribe(topic_ptr: u64) -> u64;
    /// Publish an event to the plugin's own namespace. Returns a JSON result offset.
    fn events_publish(topic_ptr: u64, payload_ptr: u64) -> u64;
}

// ── Helper: log a Rust &str using the host log_info function ──────────────

fn host_log_info(msg: &str) {
    let mem = Memory::from_bytes(msg.as_bytes());
    unsafe { log_info(mem.offset()) };
}

fn host_log_error(msg: &str) {
    let mem = Memory::from_bytes(msg.as_bytes());
    unsafe { log_error(mem.offset()) };
}

// ── Payload shape for on_event ────────────────────────────────────────────

#[derive(Deserialize, Debug)]
struct EventPayload {
    topic: String,
    payload: serde_json::Value,
}

// ── Lifecycle exports ─────────────────────────────────────────────────────

/// Called once by PluginManager when the plugin finishes loading.
#[plugin_fn]
pub fn on_start(_: ()) -> FnResult<()> {
    host_log_info("rust-example-plugin: on_start called");

    // Subscribe to container lifecycle events.
    let topic = "container.started";
    let topic_mem = Memory::from_bytes(topic.as_bytes());
    let result_offset = unsafe { events_subscribe(topic_mem.offset()) };

    // Read the JSON result returned by the host.
    if let Some(result_mem) = Memory::find(result_offset) {
        let result_str = result_mem.to_string().unwrap_or_default();
        host_log_info(&format!("rust-example-plugin: events_subscribe result: {}", result_str));
    }

    host_log_info("rust-example-plugin: ready, subscribed to container.started");
    Ok(())
}

/// Called by the host whenever a subscribed event fires.
/// The input is a JSON string: `{"topic":"...","payload":...}`.
#[plugin_fn]
pub fn on_event(input: String) -> FnResult<()> {
    match serde_json::from_str::<EventPayload>(&input) {
        Ok(event) => {
            host_log_info(&format!(
                "rust-example-plugin: received event '{}': {}",
                event.topic, event.payload
            ));

            // Publish a plugin-scoped response event.
            // Plugins may only publish to the `plugin.<id>.*` namespace.
            let pub_topic = "plugin.rust-example-plugin.container-seen";
            let pub_payload = serde_json::json!({
                "original_topic": event.topic,
                "seen": true
            });

            let topic_mem = Memory::from_bytes(pub_topic.as_bytes());
            let payload_mem = Memory::from_bytes(pub_payload.to_string().as_bytes());
            unsafe { events_publish(topic_mem.offset(), payload_mem.offset()) };
        }
        Err(e) => {
            host_log_error(&format!(
                "rust-example-plugin: failed to parse event payload: {}",
                e
            ));
        }
    }
    Ok(())
}
