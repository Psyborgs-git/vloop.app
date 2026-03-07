use extism_pdk::*;
use serde_json::json;

#[link(wasm_import_module = "extism:host/user")]
extern "C" {
    fn log_info(ptr: u64);
    fn log_error(ptr: u64);
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

fn error(message: &str) {
    let mem = to_memory(message);
    unsafe { log_error(mem.offset()) };
}

#[plugin_fn]
pub fn on_start(_: ()) -> FnResult<()> {
    let contract = read_memory(unsafe { host_get_contract() });
    info(&format!("telegram-chat-plugin contract: {}", contract));

    let secret_key = to_memory("telegram-bot-token");
    let vault_response = read_memory(unsafe { vault_read(secret_key.offset()) });
    info(&format!("telegram-chat-plugin vault response: {}", vault_response));

    let contact_request = json!({
        "operation": "upsert",
        "contact": {
            "id": "telegram:bootstrap",
            "displayName": "Telegram bootstrap contact",
            "channel": "telegram"
        }
    });
    let chat_request = json!({
        "operation": "send",
        "conversationId": "telegram-bootstrap",
        "message": "Telegram bridge plugin initialized"
    });
    let ai_request = json!({
        "prompt": "Summarize the latest Telegram intake queue",
        "conversationId": "telegram-bootstrap",
        "mode": "reply"
    });
    let notification_request = json!({
        "channel": "event",
        "message": "Telegram bridge bootstrap queued"
    });

    info(&format!(
        "telegram-chat-plugin contacts result: {}",
        read_memory(unsafe { contacts_manage(to_memory(&contact_request.to_string()).offset()) })
    ));
    info(&format!(
        "telegram-chat-plugin chat result: {}",
        read_memory(unsafe { chat_manage(to_memory(&chat_request.to_string()).offset()) })
    ));
    info(&format!(
        "telegram-chat-plugin ai result: {}",
        read_memory(unsafe { agent_infer(to_memory(&ai_request.to_string()).offset()) })
    ));
    info(&format!(
        "telegram-chat-plugin notify result: {}",
        read_memory(unsafe { notifications_notify(to_memory(&notification_request.to_string()).offset()) })
    ));

    Ok(())
}

#[plugin_fn]
pub fn on_event(input: String) -> FnResult<()> {
    info(&format!("telegram-chat-plugin received event: {}", input));
    if input.contains("error") {
        error("telegram-chat-plugin observed an error event payload");
    }
    Ok(())
}
