import type { HandlerContext } from '@orch/daemon';
import type { AIConfigStore } from './config/store.js';

export function registerCanvasHandlers(
    handlers: Map<string, (payload: any, ctx: HandlerContext) => any>,
    configStore: AIConfigStore
) {
    // ── Canvas CRUD ─────────────────────────────────────────────
    
    handlers.set('canvas.create', (p, ctx) => {
        // Automatically assign the owner as the current session id if not provided
        p.owner = p.owner ?? ctx.sessionId;
        return configStore.createCanvas(p);
    });
    
    handlers.set('canvas.list', (p) => {
        return { canvases: configStore.listCanvases(p?.owner) };
    });
    
    handlers.set('canvas.get', (p) => {
        return configStore.getCanvas(p.id);
    });
    
    handlers.set('canvas.update', (p, ctx) => {
        const changedBy = p.changedBy ?? ctx.sessionId;
        return configStore.updateCanvas(p.id, { ...p, changedBy });
    });
    
    handlers.set('canvas.delete', (p) => {
        configStore.deleteCanvas(p.id);
        return { ok: true };
    });
    
    // ── Canvas History ──────────────────────────────────────────
    
    handlers.set('canvas.history', (p) => {
        return { commits: configStore.listCanvasCommits(p.canvasId) };
    });
    
    handlers.set('canvas.rollback', (p, ctx) => {
        const changedBy = p.changedBy ?? ctx.sessionId;
        return configStore.rollbackCanvas(p.canvasId, p.commitId, changedBy);
    });
}
