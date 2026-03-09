use extism_pdk::*;
use serde_json::{json, Value};

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
    Memory::from_bytes(value.as_bytes()).expect("failed to allocate Extism memory")
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

fn parse_json(label: &str, payload: &str) -> Option<Value> {
    match serde_json::from_str::<Value>(payload) {
        Ok(value) => Some(value),
        Err(err) => {
            info(&format!("discord-chat-plugin failed to parse {}: {}", label, err));
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
                info(&format!("discord-chat-plugin {} error: {}", label, message));
            } else {
                info(&format!("discord-chat-plugin {} result: {}", label, response));
            }
        }
        None => info(&format!("discord-chat-plugin {} result: {}", label, response)),
    }
}

#[plugin_fn]
pub fn on_start(_: ()) -> FnResult<()> {
    let contract = read_memory(unsafe { host_get_contract() });
    info(&format!("discord-chat-plugin contract: {}", contract));
    let Some(contract_value) = parse_json("contract", &contract) else {
        return Ok(());
    };

    if let Some(vault) = feature(&contract_value, "vault") {
        if vault.get("requiresJspi").and_then(|value| value.as_bool()).unwrap_or(false) {
            info("discord-chat-plugin skipping vault_read because the contract marks vault access as requiresJspi");
        } else {
            let vault_response = read_memory(unsafe { vault_read(to_memory("discord-bot-token").offset()) });
            log_host_response("vault_read", &vault_response);
        }
    } else {
        info("discord-chat-plugin skipping vault_read because the host does not advertise vault access");
    }

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

    if feature(&contract_value, "contacts").is_some() {
        let response = read_memory(unsafe { contacts_manage(to_memory(&contact_request.to_string()).offset()) });
        log_host_response("contacts_manage", &response);
    } else {
        info("discord-chat-plugin skipping contacts_manage because the host does not advertise contacts");
    }

    if feature(&contract_value, "chat").is_some() {
        let response = read_memory(unsafe { chat_manage(to_memory(&chat_request.to_string()).offset()) });
        log_host_response("chat_manage", &response);
    } else {
        info("discord-chat-plugin skipping chat_manage because the host does not advertise chat");
    }

    if feature(&contract_value, "ai_inference").is_some() {
        let response = read_memory(unsafe { agent_infer(to_memory(&ai_request.to_string()).offset()) });
        log_host_response("agent_infer", &response);
    } else {
        info("discord-chat-plugin skipping agent_infer because the host does not advertise ai_inference");
    }

    if feature(&contract_value, "notifications").is_some() {
        let response = read_memory(unsafe { notifications_notify(to_memory(&notification_request.to_string()).offset()) });
        log_host_response("notifications_notify", &response);
    } else {
        info("discord-chat-plugin skipping notifications_notify because the host does not advertise notifications");
    }

    Ok(())
}
