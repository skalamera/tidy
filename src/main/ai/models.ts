import type { AiProvider } from '../../shared/ai';

export type ModelRole = 'classify' | 'extract' | 'extract_hard' | 'chat';

export interface ModelSpec {
  model: string;
  effort: 'low' | 'medium' | 'high';
  maxTokens: number;
}

/** One place to change models. IDs verified against each provider's model pages and models.list (Oct 2026).
 *  Claude: Opus 5.5 / Sonnet 5.5 reject forced tool use and always think, so use structured outputs + `effort`.
 *  Gemini: `effort` becomes the thinking level (3.8 Flash rejects "minimal"); 4 Argon is the flagship reasoning model. */
export const MODELS: Record<AiProvider, Record<ModelRole, ModelSpec>> = {
  anthropic: {
    classify: { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 4_000 },
    extract: { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 16_000 },
    extract_hard: { model: 'claude-opus-5-5', effort: 'medium', maxTokens: 32_000 },
    chat: { model: 'claude-opus-5-5', effort: 'medium', maxTokens: 8_000 },
  },
  gemini: {
    classify: { model: 'gemini-3.8-flash', effort: 'low', maxTokens: 8_000 },
    extract: { model: 'gemini-3.8-flash', effort: 'medium', maxTokens: 32_000 },
    extract_hard: { model: 'gemini-4-argon', effort: 'medium', maxTokens: 65_536 },
    chat: { model: 'gemini-3.8-flash', effort: 'low', maxTokens: 16_000 },
  },
};
