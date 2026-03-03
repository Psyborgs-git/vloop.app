/**
 * AI Agent v2 — Shared repository helpers.
 */

export const toJSON = (v: unknown): string => JSON.stringify(v ?? {});
export const fromJSON = <T>(v: string | null | undefined): T => (v ? JSON.parse(v) : {} as T);
export const now = () => new Date().toISOString();
