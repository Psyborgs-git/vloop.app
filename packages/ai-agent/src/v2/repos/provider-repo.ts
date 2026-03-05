/**
 * ProviderRepo — CRUD persistence for AI providers.
 */

import { eq } from 'drizzle-orm';
import { aiProvidersTable } from '../schema.js';
import { toJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type { ProviderId, ProviderConfig, CreateProviderInput } from '../types.js';
import type { AiAgentOrm } from '../orm-type.js';
import type { IProviderRepo, RepoListQuery } from './interfaces.js';
import { applyListQuery, createRowMapper, jsonOr, opt } from './query-helpers.js';

const mapProvider = createRowMapper<ProviderConfig>({
	id: (row) => row.id as ProviderId,
	name: (row) => row.name as string,
	type: (row) => row.type as ProviderConfig['type'],
	adapter: (row) => opt(row.adapter as ProviderConfig['adapter'] | null),
	authType: (row) => opt(row.auth_type as ProviderConfig['authType'] | null),
	baseUrl: (row) => opt(row.base_url as string | null),
	apiKeyRef: (row) => opt(row.api_key_ref as string | null),
	headers: (row) => jsonOr<Record<string, string>>(row.headers, {}),
	timeoutMs: (row) => opt(row.timeout_ms as number | null),
	metadata: (row) => jsonOr<Record<string, unknown>>(row.metadata, {}),
	createdAt: (row) => row.created_at as string,
	updatedAt: (row) => row.updated_at as string,
});

const providerColumns = {
	id: aiProvidersTable.id,
	name: aiProvidersTable.name,
	type: aiProvidersTable.type,
	adapter: aiProvidersTable.adapter,
	authType: aiProvidersTable.auth_type,
	baseUrl: aiProvidersTable.base_url,
	apiKeyRef: aiProvidersTable.api_key_ref,
	timeoutMs: aiProvidersTable.timeout_ms,
	createdAt: aiProvidersTable.created_at,
	updatedAt: aiProvidersTable.updated_at,
} as const;

export class ProviderRepo implements IProviderRepo {
	constructor(private readonly orm: AiAgentOrm) {}

	create(input: CreateProviderInput): ProviderConfig {
		const id = generateId() as ProviderId;
		const ts = now();
		this.orm.insert(aiProvidersTable).values({
			id,
			name: input.name,
			type: input.type,
			adapter: input.adapter ?? null,
			auth_type: input.authType ?? null,
			base_url: input.baseUrl ?? null,
			api_key_ref: input.apiKeyRef ?? null,
			headers: toJSON(input.headers ?? {}),
			timeout_ms: input.timeoutMs ?? null,
			metadata: toJSON(input.metadata ?? {}),
			created_at: ts,
			updated_at: ts,
		}).run();
		return this.get(id)!;
	}

	get(id: ProviderId): ProviderConfig | undefined {
		const row = this.orm.select().from(aiProvidersTable)
			.where(eq(aiProvidersTable.id, id)).get() as any;
		return row ? this.map(row) : undefined;
	}

	list(query?: RepoListQuery<keyof typeof providerColumns>): ProviderConfig[] {
		const statement = applyListQuery(this.orm.select().from(aiProvidersTable), providerColumns, query);
		return (statement.all() as Record<string, unknown>[]).map(mapProvider);
	}

	update(id: ProviderId, input: Partial<CreateProviderInput>): ProviderConfig {
		const set: Record<string, any> = { updated_at: now() };
		if (input.name !== undefined) set.name = input.name;
		if (input.type !== undefined) set.type = input.type;
		if (input.adapter !== undefined) set.adapter = input.adapter;
		if (input.authType !== undefined) set.auth_type = input.authType;
		if (input.baseUrl !== undefined) set.base_url = input.baseUrl;
		if (input.apiKeyRef !== undefined) set.api_key_ref = input.apiKeyRef;
		if (input.headers !== undefined) set.headers = toJSON(input.headers);
		if (input.timeoutMs !== undefined) set.timeout_ms = input.timeoutMs;
		if (input.metadata !== undefined) set.metadata = toJSON(input.metadata);
		this.orm.update(aiProvidersTable).set(set).where(eq(aiProvidersTable.id, id)).run();
		return this.get(id)!;
	}

	delete(id: ProviderId): void {
		this.orm.delete(aiProvidersTable).where(eq(aiProvidersTable.id, id)).run();
	}

	private map(row: Record<string, unknown>): ProviderConfig {
		return mapProvider(row);
	}
}
