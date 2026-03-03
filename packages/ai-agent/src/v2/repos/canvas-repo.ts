/**
 * Canvas Repository — CRUD for canvases and canvas commits.
 */
import { eq, desc } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { canvasesTable, canvasCommitsTable } from '../schema.js';
import { generateId } from '../types.js';
import { toJSON, fromJSON, now } from '../repo-helpers.js';
import type { CanvasId, CanvasCommitId } from '../types.js';

export interface Canvas {
	id: string;
	name: string;
	description: string;
	content: string;
	metadata: Record<string, unknown>;
	owner: string;
	createdAt: string;
	updatedAt: string;
}

export interface CanvasCommit {
	id: string;
	canvasId: string;
	content: string;
	diff: string;
	metadata: Record<string, unknown>;
	changeType: string;
	changedBy: string;
	message: string;
	createdAt: string;
}

function mapCanvas(row: any): Canvas {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		content: row.content,
		metadata: typeof row.metadata === 'string' ? fromJSON(row.metadata) : row.metadata ?? {},
		owner: row.owner,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function mapCommit(row: any): CanvasCommit {
	return {
		id: row.id,
		canvasId: row.canvas_id,
		content: row.content,
		diff: row.diff,
		metadata: typeof row.metadata === 'string' ? fromJSON(row.metadata) : row.metadata ?? {},
		changeType: row.change_type,
		changedBy: row.changed_by,
		message: row.message,
		createdAt: row.created_at,
	};
}

export class CanvasRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

	create(input: { name: string; description?: string; content?: string; owner: string; metadata?: Record<string, unknown> }): Canvas {
		const id = generateId() as unknown as CanvasId;
		const ts = now();
		this.orm.insert(canvasesTable).values({
			id,
			name: input.name,
			description: input.description ?? '',
			content: input.content ?? '',
			metadata: toJSON(input.metadata ?? {}),
			owner: input.owner,
			created_at: ts,
			updated_at: ts,
		}).run();
		return this.get(id as unknown as string)!;
	}

	get(id: string): Canvas | undefined {
		const row = this.orm.select().from(canvasesTable).where(eq(canvasesTable.id, id)).get();
		return row ? mapCanvas(row) : undefined;
	}

	listCanvases(owner?: string): Canvas[] {
		if (owner) {
			return this.orm.select().from(canvasesTable).where(eq(canvasesTable.owner, owner)).all().map(mapCanvas);
		}
		return this.orm.select().from(canvasesTable).all().map(mapCanvas);
	}

	update(id: string, input: { name?: string; description?: string; content?: string; changedBy?: string; metadata?: Record<string, unknown> }): Canvas {
		const existing = this.get(id);
		if (!existing) throw new Error(`Canvas not found: ${id}`);

		// Create commit before update
		if (input.content !== undefined && input.content !== existing.content) {
			const commitId = generateId() as unknown as CanvasCommitId;
			this.orm.insert(canvasCommitsTable).values({
				id: commitId,
				canvas_id: id,
				content: existing.content,
				diff: '',
				metadata: toJSON({}),
				change_type: 'update',
				changed_by: input.changedBy ?? 'system',
				message: 'Auto-save before update',
				created_at: now(),
			}).run();
		}

		const updates: any = { updated_at: now() };
		if (input.name !== undefined) updates.name = input.name;
		if (input.description !== undefined) updates.description = input.description;
		if (input.content !== undefined) updates.content = input.content;
		if (input.metadata !== undefined) updates.metadata = toJSON(input.metadata);

		this.orm.update(canvasesTable).set(updates).where(eq(canvasesTable.id, id)).run();
		return this.get(id)!;
	}

	delete(id: string): void {
		this.orm.delete(canvasCommitsTable).where(eq(canvasCommitsTable.canvas_id, id)).run();
		this.orm.delete(canvasesTable).where(eq(canvasesTable.id, id)).run();
	}

	listCanvasCommits(canvasId: string): CanvasCommit[] {
		return this.orm.select().from(canvasCommitsTable)
			.where(eq(canvasCommitsTable.canvas_id, canvasId))
			.orderBy(desc(canvasCommitsTable.created_at))
			.all().map(mapCommit);
	}

	rollbackCanvas(canvasId: string, commitId: string, changedBy: string): Canvas {
		const commit = this.orm.select().from(canvasCommitsTable).where(eq(canvasCommitsTable.id, commitId)).get();
		if (!commit) throw new Error(`Canvas commit not found: ${commitId}`);
		return this.update(canvasId, { content: commit.content, changedBy });
	}
}
