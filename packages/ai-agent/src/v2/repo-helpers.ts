/**
 * AI Agent v2 — Shared repository helpers.
 */

export const toJSON = (v: unknown, fallback: unknown = {}): string => JSON.stringify(v ?? fallback);
export const fromJSON = <T>(v: string | null | undefined, fallback: T): T => {
	if (!v) return fallback;
	try {
		return JSON.parse(v) as T;
	} catch {
		return fallback;
	}
};
export const now = () => new Date().toISOString();
