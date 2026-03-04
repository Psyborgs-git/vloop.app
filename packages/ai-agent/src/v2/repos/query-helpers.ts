import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	not,
} from 'drizzle-orm';
import type { RepoListQuery } from './interfaces.js';

const escapeLike = (value: string): string => value.replace(/[%_]/g, '\\$&');

const normalizePagination = (pagination?: RepoListQuery['pagination']): { limit?: number; offset?: number } => {
	if (!pagination) return {};
	const limit = pagination.limit ?? pagination.pageSize;
	const page = pagination.page ?? 1;
	const offset = pagination.offset ?? (limit !== undefined ? Math.max(0, page - 1) * limit : undefined);
	return {
		limit: typeof limit === 'number' ? Math.max(1, Math.min(500, limit)) : undefined,
		offset: typeof offset === 'number' ? Math.max(0, offset) : undefined,
	};
};

const toLikePattern = (op: 'contains' | 'startsWith' | 'endsWith', value: unknown): string => {
	const text = escapeLike(String(value ?? ''));
	if (op === 'startsWith') return `${text}%`;
	if (op === 'endsWith') return `%${text}`;
	return `%${text}%`;
};

export const applyListQuery = <TField extends string>(
	baseQuery: any,
	columns: Partial<Record<TField, any>>,
	query?: RepoListQuery<TField>,
): any => {
	if (!query) return baseQuery;

	let statement = baseQuery.$dynamic ? baseQuery.$dynamic() : baseQuery;

	if (query.filters?.length) {
		const clauses = query.filters
			.map((filter) => {
				const column = columns[filter.field];
				if (!column) return undefined;
				const op = filter.op ?? 'eq';
				switch (op) {
					case 'eq': return eq(column, filter.value as any);
					case 'ne': return ne(column, filter.value as any);
					case 'in': {
						const values = Array.isArray(filter.value) ? filter.value : [filter.value];
						return values.length ? inArray(column, values as any[]) : undefined;
					}
					case 'notIn': {
						const values = Array.isArray(filter.value) ? filter.value : [filter.value];
						return values.length ? not(inArray(column, values as any[])) : undefined;
					}
					case 'contains':
					case 'startsWith':
					case 'endsWith':
						return like(column, toLikePattern(op, filter.value));
					case 'gt': return gt(column, filter.value as any);
					case 'gte': return gte(column, filter.value as any);
					case 'lt': return lt(column, filter.value as any);
					case 'lte': return lte(column, filter.value as any);
					case 'isNull': return isNull(column);
					case 'isNotNull': return isNotNull(column);
					default: return undefined;
				}
			})
			.filter(Boolean);

		if (clauses.length) {
			statement = statement.where(and(...clauses));
		}
	}

	if (query.sort?.length) {
		const orderByClauses = query.sort
			.map((sort) => {
				const column = columns[sort.field];
				if (!column) return undefined;
				return sort.direction === 'asc' ? asc(column) : desc(column);
			})
			.filter(Boolean);

		if (orderByClauses.length) {
			statement = statement.orderBy(...orderByClauses);
		}
	}

	const { limit, offset } = normalizePagination(query.pagination);
	if (limit !== undefined) statement = statement.limit(limit);
	if (offset !== undefined) statement = statement.offset(offset);

	return statement;
};

export type RowMapper<T> = {
	[K in keyof T]: (row: Record<string, unknown>) => T[K];
};

export const createRowMapper = <T>(shape: RowMapper<T>) => (row: Record<string, unknown>): T => {
	const output: Partial<T> = {};
	for (const [key, getter] of Object.entries(shape as Record<string, (row: Record<string, unknown>) => unknown>)) {
		output[key as keyof T] = getter(row) as T[keyof T];
	}
	return output as T;
};

export const jsonOr = <T>(value: unknown, fallback: T): T => {
	if (value === null || value === undefined || value === '') return fallback;
	if (typeof value !== 'string') return value as T;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
};

export const opt = <T>(value: T | null | undefined): T | undefined => value ?? undefined;
