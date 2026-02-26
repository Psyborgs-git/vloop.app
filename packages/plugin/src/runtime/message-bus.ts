// Placeholder for shared IPC logic
import type { PluginMessage } from "../types.js";

export const buildPluginMessage = (type: string, payload: any): PluginMessage => {
    return {
        type,
        payload,
    } as PluginMessage;
};
