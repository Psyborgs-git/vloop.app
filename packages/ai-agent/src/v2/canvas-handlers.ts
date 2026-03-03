/**
 * v2 Canvas Handlers — canvas CRUD + versioning via CanvasRepo.
 */
import type { HandlerContext } from '@orch/daemon';
import { CanvasRepo } from './repos/canvas-repo.js';

export function registerCanvasHandlersV2(
	handlers: Map<string, (payload: any, ctx: HandlerContext) => any>,
	canvasRepo: CanvasRepo,
) {
	handlers.set('canvas.create', (p, ctx) => {
		p.owner = p.owner ?? ctx.sessionId;
		return canvasRepo.create(p);
	});

	handlers.set('canvas.list', (p) => ({
		canvases: canvasRepo.listCanvases(p?.owner),
	}));

	handlers.set('canvas.get', (p) => canvasRepo.get(p.id));

	handlers.set('canvas.update', (p, ctx) => {
		const changedBy = p.changedBy ?? ctx.sessionId;
		return canvasRepo.update(p.id, { ...p, changedBy });
	});

	handlers.set('canvas.delete', (p) => {
		canvasRepo.delete(p.id);
		return { ok: true };
	});

	handlers.set('canvas.history', (p) => ({
		commits: canvasRepo.listCanvasCommits(p.canvasId),
	}));

	handlers.set('canvas.rollback', (p, ctx) => {
		const changedBy = p.changedBy ?? ctx.sessionId;
		return canvasRepo.rollbackCanvas(p.canvasId, p.commitId, changedBy);
	});
}
