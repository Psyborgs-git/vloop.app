/**
 * ProviderRepo — CRUD persistence for AI providers.
 */

import { eq } from 'drizzle-orm';
import type { RootDatabaseOrm } from '@orch/shared/db';
import { aiProvidersTable } from '../schema.js';
import { toJSON, fromJSON, now } from '../repo-helpers.js';
import { generateId } from '../types.js';
import type { ProviderId, ProviderConfig, CreateProviderInput } from '../types.js';
import type { IProviderRepo } from './interfaces.js';

export class ProviderRepo implements IProviderRepo {
	constructor(private readonly orm: RootDatabaseOrm) {}

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

	list(): ProviderConfig[] {
		return (this.orm.select().from(aiProvidersTable).all() as any[]).map(r => this.map(r));
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

	private map(row: any): ProviderConfig {
		return {
			id: row.id,
			name: row.name,
			type: row.type,
			adapter: row.adapter ?? undefined,
			authType: row.auth_type ?? undefined,
			baseUrl: row.base_url ?? undefined,
			apiKeyRef: row.api_key_ref ?? undefined,
			headers: fromJSON(row.headers) ?? {},
			timeoutMs: row.timeout_ms ?? undefined,
			metadata: fromJSON(row.metadata) ?? {},
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
