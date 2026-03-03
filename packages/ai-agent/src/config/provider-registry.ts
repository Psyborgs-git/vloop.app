/**
 * Provider Runtime Registry — shared runtime map for LLM adapters.
 *
 * The v2 ProviderManager populates this map before constructing LLM instances
 * so that custom LLMs (AnthropicLlm, OllamaLlm, etc.) can look up their
 * resolved configuration.
 */
import type { ResolvedModel } from '../v2/types.js';

export type { ResolvedModel };

/**
 * Global registry of active model runtimes keyed by model string
 * (e.g., "vloop://anthropic/claude-3-opus").
 */
export const activeRuntimes = new Map<string, ResolvedModel>();
