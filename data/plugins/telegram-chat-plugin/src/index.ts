import { Memory } from "@extism/as-pdk";

@external("extism:host/user", "log_info")
declare function log_info(ptr: u64): void;
@external("extism:host/user", "vault_read")
declare function vault_read(key_ptr: u64): u64;
@external("extism:host/user", "contacts_manage")
declare function contacts_manage(request_ptr: u64): u64;
@external("extism:host/user", "chat_manage")
declare function chat_manage(request_ptr: u64): u64;
@external("extism:host/user", "agent_infer")
declare function agent_infer(request_ptr: u64): u64;
@external("extism:host/user", "notifications_notify")
declare function notifications_notify(request_ptr: u64): u64;

function info(msg: string): void {
  log_info(Memory.allocateString(msg).offset);
}

export function on_start(): i32 {
  info("telegram-chat-plugin: on_start");
  vault_read(Memory.allocateString("telegram-bot-token").offset);
  contacts_manage(Memory.allocateString('{"operation":"upsert","contact":{"id":"telegram:bootstrap","displayName":"Telegram bootstrap contact","channel":"telegram"}}').offset);
  chat_manage(Memory.allocateString('{"operation":"send","conversationId":"telegram-bootstrap","message":"Telegram bridge plugin initialized"}').offset);
  agent_infer(Memory.allocateString('{"prompt":"Draft a moderation summary for the Telegram bootstrap channel","conversationId":"telegram-bootstrap","mode":"plan"}').offset);
  notifications_notify(Memory.allocateString('{"channel":"event","message":"Telegram bridge bootstrap queued"}').offset);
  return 0;
}
