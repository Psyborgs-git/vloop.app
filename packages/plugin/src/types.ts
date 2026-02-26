/**
 * @orch/plugin - Plugin types and interfaces
 */

import { z } from "zod";

// --- Manifest ---

export const PluginManifestSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  runtime: z.enum(["node", "python"]),
  entry: z.string().min(1),
  permissions: z.array(z.string()).optional(), // Requested permissions
  hooks: z.array(z.string()).optional(), // Hooks to listen to
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// --- Runtime ---

export interface PluginRuntimeConfig {
  id: string;
  path: string;
  entry: string;
  env?: Record<string, string>;
  permissions: string[];
}

export interface PluginProcess {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: any): void;
  onMessage(callback: (msg: any) => void): void;
  status: "stopped" | "running" | "error";
}

// --- Store ---

export interface PluginRecord {
  id: string;
  manifest: PluginManifest;
  status: "pending" | "approved" | "active" | "disabled" | "error";
  installedAt: string;
  permissions: string[]; // Granted permissions
  config?: Record<string, any>;
}

// --- API Messages ---

export interface PluginMessage {
  type: "request" | "response" | "event";
  id?: string; // Request ID
  payload: any;
}

export interface PluginRequest extends PluginMessage {
  type: "request";
  action: string;
  args?: any;
}

export interface PluginResponse extends PluginMessage {
  type: "response";
  requestId: string;
  result?: any;
  error?: string;
}

export interface PluginEvent extends PluginMessage {
  type: "event";
  topic: string;
  data: any;
}
