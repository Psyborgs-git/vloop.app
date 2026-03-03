/**
 * WorkflowRepo — CRUD persistence for workflows + immutable versioning.
 */

import { eq, desc, and } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiWorkflowsTable, aiWorkflowVersionsTable } from '../schema.js';
import { toJSON, fromJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	WorkflowId, WorkflowVersionId,
	WorkflowConfig, CreateWorkflowInput, WorkflowVersion,
} from '../types.js';
import type { IWorkflowRepo } from './interfaces.js';

export class WorkflowRepo implements IWorkflowRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

	create(input: CreateWorkflowInput): WorkflowConfig {
		const id = generateId() as WorkflowId;
		const ts = now();
		this.orm.insert(aiWorkflowsTable).values({
			id,
			name: input.name,
			description: input.description ?? '',
			type: input.type,
			nodes: toJSON(input.nodes),
			edges: toJSON(input.edges),
			created_at: ts,
			updated_at: ts,
		}).run();
		return this.get(id)!;
	}

	get(id: WorkflowId): WorkflowConfig | undefined {
		const row = this.orm.select().from(aiWorkflowsTable)
			.where(eq(aiWorkflowsTable.id, id)).get() as any;
		return row ? this.mapWorkflow(row) : undefined;
	}

	list(): WorkflowConfig[] {
		return (this.orm.select().from(aiWorkflowsTable).all() as any[]).map(r => this.mapWorkflow(r));
	}

	update(id: WorkflowId, input: Partial<CreateWorkflowInput>): WorkflowConfig {
		const set: Record<string, any> = { updated_at: now() };
		if (input.name !== undefined) set.name = input.name;
		if (input.description !== undefined) set.description = input.description;
		if (input.type !== undefined) set.type = input.type;
		if (input.nodes !== undefined) set.nodes = toJSON(input.nodes);
		if (input.edges !== undefined) set.edges = toJSON(input.edges);
		this.orm.update(aiWorkflowsTable).set(set).where(eq(aiWorkflowsTable.id, id)).run();
		return this.get(id)!;
	}

	delete(id: WorkflowId): void {
		this.orm.delete(aiWorkflowVersionsTable).where(eq(aiWorkflowVersionsTable.workflow_id, id)).run();
		this.orm.delete(aiWorkflowsTable).where(eq(aiWorkflowsTable.id, id)).run();
	}

	createVersion(workflowId: WorkflowId): WorkflowVersion {
		const workflow = this.get(workflowId);
		if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

		// Deactivate current active version if any
		const active = this.getActiveVersion(workflowId);
		if (active) {
			this.orm.update(aiWorkflowVersionsTable)
				.set({ status: 'archived', deactivated_at: now() })
				.where(eq(aiWorkflowVersionsTable.id, active.id))
				.run();
		}

		// Determine next version number
		const lastVersion = this.orm.select({ version: aiWorkflowVersionsTable.version })
			.from(aiWorkflowVersionsTable)
			.where(eq(aiWorkflowVersionsTable.workflow_id, workflowId))
			.orderBy(desc(aiWorkflowVersionsTable.version))
			.limit(1)
			.get() as any;
		const nextVersion = (lastVersion?.version ?? 0) + 1;

		const id = generateId() as WorkflowVersionId;
		const ts = now();
		this.orm.insert(aiWorkflowVersionsTable).values({
			id,
			workflow_id: workflowId,
			version: nextVersion,
			nodes: toJSON(workflow.nodes),
			edges: toJSON(workflow.edges),
			status: 'active',
			activated_at: ts,
			deactivated_at: null,
			created_at: ts,
		}).run();

		return this.getVersion(id)!;
	}

	getActiveVersion(workflowId: WorkflowId): WorkflowVersion | undefined {
		const row = this.orm.select().from(aiWorkflowVersionsTable)
			.where(and(
				eq(aiWorkflowVersionsTable.workflow_id, workflowId),
				eq(aiWorkflowVersionsTable.status, 'active'),
			))
			.limit(1)
			.get() as any;
		return row ? this.mapVersion(row) : undefined;
	}

	listVersions(workflowId: WorkflowId): WorkflowVersion[] {
		return (this.orm.select().from(aiWorkflowVersionsTable)
			.where(eq(aiWorkflowVersionsTable.workflow_id, workflowId))
			.orderBy(desc(aiWorkflowVersionsTable.version))
			.all() as any[]).map(r => this.mapVersion(r));
	}

	// ── Internal ─────────────────────────────────────────────────────────

	private getVersion(id: WorkflowVersionId): WorkflowVersion | undefined {
		const row = this.orm.select().from(aiWorkflowVersionsTable)
			.where(eq(aiWorkflowVersionsTable.id, id)).get() as any;
		return row ? this.mapVersion(row) : undefined;
	}

	private mapWorkflow(row: any): WorkflowConfig {
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			type: row.type,
			nodes: fromJSON(row.nodes) ?? [],
			edges: fromJSON(row.edges) ?? [],
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	private mapVersion(row: any): WorkflowVersion {
		return {
			id: row.id,
			workflowId: row.workflow_id,
			version: row.version,
			nodes: fromJSON(row.nodes) ?? [],
			edges: fromJSON(row.edges) ?? [],
			status: row.status,
			activatedAt: row.activated_at,
			deactivatedAt: row.deactivated_at ?? undefined,
			createdAt: row.created_at,
		};
	}
}
