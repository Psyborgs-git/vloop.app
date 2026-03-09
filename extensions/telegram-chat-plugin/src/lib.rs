use extism_pdk::*;
use serde_json::{json, Value};

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
        .unwrap_or_else(|_| panic!("failed to allocate Extism memory for {} bytes", value.len()))
}

fn read_memory(offset: u64) -> String {
    Memory::find(offset)
        .and_then(|mem| mem.to_string().ok())
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

fn parse_json(label: &str, payload: &str) -> Option<Value> {
    match serde_json::from_str::<Value>(payload) {
        Ok(value) => Some(value),
        Err(err) => {
            error(&format!("telegram-chat-plugin failed to parse {}: {}", label, err));
            None
        }
    }
}

fn feature<'a>(contract: &'a Value, name: &str) -> Option<&'a Value> {
    contract.get("features").and_then(|features| features.get(name))
}

fn log_host_response(label: &str, response: &str) {
    match parse_json(label, response) {
        Some(value) => {
            if let Some(message) = value.get("error").and_then(|error| error.as_str()) {
                error(&format!("telegram-chat-plugin {} error: {}", label, message));
            } else {
                info(&format!("telegram-chat-plugin {} result: {}", label, response));
            }
        }
        None => info(&format!("telegram-chat-plugin {} result: {}", label, response)),
    }
}

#[plugin_fn]
pub fn on_start(_: ()) -> FnResult<()> {
    let contract = read_memory(unsafe { host_get_contract() });
    info(&format!("telegram-chat-plugin contract: {}", contract));
    let Some(contract_value) = parse_json("contract", &contract) else {
        return Ok(());
    };

    if let Some(vault) = feature(&contract_value, "vault") {
        if vault.get("requiresJspi").and_then(|value| value.as_bool()).unwrap_or(false) {
            info("telegram-chat-plugin skipping vault_read because the contract marks vault access as requiresJspi");
        } else {
            let secret_key = to_memory("telegram-bot-token");
            let vault_response = read_memory(unsafe { vault_read(secret_key.offset()) });
            log_host_response("vault_read", &vault_response);
        }
    } else {
        info("telegram-chat-plugin skipping vault_read because the host does not advertise vault access");
    }

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

    if feature(&contract_value, "contacts").is_some() {
        let response = read_memory(unsafe { contacts_manage(to_memory(&contact_request.to_string()).offset()) });
        log_host_response("contacts_manage", &response);
    } else {
        info("telegram-chat-plugin skipping contacts_manage because the host does not advertise contacts");
    }

    if feature(&contract_value, "chat").is_some() {
        let response = read_memory(unsafe { chat_manage(to_memory(&chat_request.to_string()).offset()) });
        log_host_response("chat_manage", &response);
    } else {
        info("telegram-chat-plugin skipping chat_manage because the host does not advertise chat");
    }

    if feature(&contract_value, "ai_inference").is_some() {
        let response = read_memory(unsafe { agent_infer(to_memory(&ai_request.to_string()).offset()) });
        log_host_response("agent_infer", &response);
    } else {
        info("telegram-chat-plugin skipping agent_infer because the host does not advertise ai_inference");
    }

    if feature(&contract_value, "notifications").is_some() {
        let response = read_memory(unsafe { notifications_notify(to_memory(&notification_request.to_string()).offset()) });
        log_host_response("notifications_notify", &response);
    } else {
        info("telegram-chat-plugin skipping notifications_notify because the host does not advertise notifications");
    }

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
