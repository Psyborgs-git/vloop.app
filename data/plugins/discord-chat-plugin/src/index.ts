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
  info("discord-chat-plugin: on_start");
  vault_read(Memory.allocateString("discord-bot-token").offset);
  contacts_manage(Memory.allocateString('{"operation":"upsert","contact":{"id":"discord:bootstrap","displayName":"Discord bootstrap contact","channel":"discord"}}').offset);
  chat_manage(Memory.allocateString('{"operation":"send","conversationId":"discord-bootstrap","message":"Discord bridge plugin initialized"}').offset);
  agent_infer(Memory.allocateString('{"prompt":"Draft a moderation summary for the Discord bootstrap channel","conversationId":"discord-bootstrap","mode":"plan"}').offset);
  notifications_notify(Memory.allocateString('{"channel":"event","message":"Discord bridge bootstrap queued"}').offset);
  return 0;
}
