use extism_pdk::*;
use serde_json::json;

#[link(wasm_import_module = "extism:host/user")]
extern "C" {
    fn log_info(ptr: u64);
    fn host_get_contract() -> u64;
    fn vault_read(key_ptr: u64) -> u64;
    fn contacts_manage(request_ptr: u64) -> u64;
    fn chat_manage(request_ptr: u64) -> u64;
    fn agent_infer(request_ptr: u64) -> u64;
    fn notifications_notify(request_ptr: u64) -> u64;
}

fn to_memory(value: &str) -> Memory {
    Memory::from_bytes(value.as_bytes())
}

fn read_memory(offset: u64) -> String {
    Memory::find(offset)
        .and_then(|mem| mem.to_string())
        .unwrap_or_default()
}

fn info(message: &str) {
    let mem = to_memory(message);
    unsafe { log_info(mem.offset()) };
}

#[plugin_fn]
pub fn on_start(_: ()) -> FnResult<()> {
    info(&format!(
        "discord-chat-plugin contract: {}",
        read_memory(unsafe { host_get_contract() })
    ));
    info(&format!(
        "discord-chat-plugin vault response: {}",
        read_memory(unsafe { vault_read(to_memory("discord-bot-token").offset()) })
    ));

    let contact_request = json!({
        "operation": "upsert",
        "contact": {
            "id": "discord:bootstrap",
            "displayName": "Discord bootstrap contact",
            "channel": "discord"
        }
    });
    let chat_request = json!({
        "operation": "send",
        "conversationId": "discord-bootstrap",
        "message": "Discord bridge plugin initialized"
    });
    let ai_request = json!({
        "prompt": "Draft a moderation summary for the Discord bootstrap channel",
        "conversationId": "discord-bootstrap",
        "mode": "plan"
    });
    let notification_request = json!({
        "channel": "event",
        "message": "Discord bridge bootstrap queued"
    });

    info(&format!(
        "discord-chat-plugin contacts result: {}",
        read_memory(unsafe { contacts_manage(to_memory(&contact_request.to_string()).offset()) })
    ));
    info(&format!(
        "discord-chat-plugin chat result: {}",
        read_memory(unsafe { chat_manage(to_memory(&chat_request.to_string()).offset()) })
    ));
    info(&format!(
        "discord-chat-plugin ai result: {}",
        read_memory(unsafe { agent_infer(to_memory(&ai_request.to_string()).offset()) })
    ));
    info(&format!(
        "discord-chat-plugin notify result: {}",
        read_memory(unsafe { notifications_notify(to_memory(&notification_request.to_string()).offset()) })
    ));

    Ok(())
}
