/**
 * WorkflowRepo — CRUD persistence for workflows + immutable versioning.
 */

import { eq, desc, and } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiWorkflowsTable, aiWorkflowVersionsTable } from '../schema.js';
import { toJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type {
	WorkflowId, WorkflowVersionId,
	WorkflowConfig, CreateWorkflowInput, WorkflowVersion,
} from '../types.js';
import type { IWorkflowRepo, RepoListQuery } from './interfaces.js';
import { applyListQuery, createRowMapper, jsonOr, opt } from './query-helpers.js';

const mapWorkflow = createRowMapper<WorkflowConfig>({
	id: (row) => row.id as WorkflowId,
	name: (row) => row.name as string,
	description: (row) => row.description as string,
	type: (row) => row.type as WorkflowConfig['type'],
	nodes: (row) => jsonOr<WorkflowConfig['nodes']>(row.nodes, []),
	edges: (row) => jsonOr<WorkflowConfig['edges']>(row.edges, []),
	createdAt: (row) => row.created_at as string,
	updatedAt: (row) => row.updated_at as string,
});

const mapWorkflowVersion = createRowMapper<WorkflowVersion>({
	id: (row) => row.id as WorkflowVersionId,
	workflowId: (row) => row.workflow_id as WorkflowId,
	version: (row) => row.version as number,
	nodes: (row) => jsonOr<WorkflowVersion['nodes']>(row.nodes, []),
	edges: (row) => jsonOr<WorkflowVersion['edges']>(row.edges, []),
	status: (row) => row.status as WorkflowVersion['status'],
	activatedAt: (row) => row.activated_at as string,
	deactivatedAt: (row) => opt(row.deactivated_at as string | null),
	createdAt: (row) => row.created_at as string,
});

const workflowColumns = {
	id: aiWorkflowsTable.id,
	name: aiWorkflowsTable.name,
	description: aiWorkflowsTable.description,
	type: aiWorkflowsTable.type,
	createdAt: aiWorkflowsTable.created_at,
	updatedAt: aiWorkflowsTable.updated_at,
} as const;

const workflowVersionColumns = {
	id: aiWorkflowVersionsTable.id,
	workflowId: aiWorkflowVersionsTable.workflow_id,
	version: aiWorkflowVersionsTable.version,
	status: aiWorkflowVersionsTable.status,
	activatedAt: aiWorkflowVersionsTable.activated_at,
	deactivatedAt: aiWorkflowVersionsTable.deactivated_at,
	createdAt: aiWorkflowVersionsTable.created_at,
} as const;

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

	list(query?: RepoListQuery<keyof typeof workflowColumns>): WorkflowConfig[] {
		const statement = applyListQuery(this.orm.select().from(aiWorkflowsTable), workflowColumns, query);
		return (statement.all() as Record<string, unknown>[]).map(mapWorkflow);
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

	listVersions(workflowId: WorkflowId, query?: RepoListQuery<keyof typeof workflowVersionColumns>): WorkflowVersion[] {
		let statement = this.orm.select().from(aiWorkflowVersionsTable)
			.where(eq(aiWorkflowVersionsTable.workflow_id, workflowId))
			.orderBy(desc(aiWorkflowVersionsTable.version));
		statement = applyListQuery(statement, workflowVersionColumns, query);
		return (statement.all() as Record<string, unknown>[]).map(mapWorkflowVersion);
	}

	// ── Internal ─────────────────────────────────────────────────────────

	private getVersion(id: WorkflowVersionId): WorkflowVersion | undefined {
		const row = this.orm.select().from(aiWorkflowVersionsTable)
			.where(eq(aiWorkflowVersionsTable.id, id)).get() as any;
		return row ? this.mapVersion(row) : undefined;
	}

	private mapWorkflow(row: Record<string, unknown>): WorkflowConfig {
		return mapWorkflow(row);
	}

	private mapVersion(row: Record<string, unknown>): WorkflowVersion {
		return mapWorkflowVersion(row);
	}
}
