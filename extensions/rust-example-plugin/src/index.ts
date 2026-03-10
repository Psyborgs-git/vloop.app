import { Memory, Host } from "@extism/as-pdk";

@external("extism:host/user", "log_info")
declare function log_info(ptr: u64): void;
@external("extism:host/user", "log_error")
declare function log_error(ptr: u64): void;
@external("extism:host/user", "events_subscribe")
declare function events_subscribe(topic_ptr: u64): u64;
@external("extism:host/user", "events_publish")
declare function events_publish(topic_ptr: u64, payload_ptr: u64): u64;

function host_log_info(msg: string): void {
  log_info(Memory.allocateString(msg).offset);
}

function host_log_error(msg: string): void {
  log_error(Memory.allocateString(msg).offset);
}

export function on_start(): i32 {
  host_log_info("rust-example-plugin (AS): on_start called");
  const topicMem = Memory.allocateString("container.started");
  events_subscribe(topicMem.offset);
  host_log_info("rust-example-plugin (AS): ready, subscribed to container.started");
  return 0;
}

export function on_event(): i32 {
  const input = Host.inputString();
  host_log_info("rust-example-plugin (AS): received event: " + input);
  const pubTopic = Memory.allocateString("plugin.rust-example-plugin.container-seen");
  const pubPayload = Memory.allocateString('{"seen":true}');
  events_publish(pubTopic.offset, pubPayload.offset);
  return 0;
}
