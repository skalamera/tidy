export type ModelRole = 'classify' | 'extract' | 'extract_hard' | 'chat';

/** One place to change models. IDs verified against platform.claude.com model pages (Oct 2026).
 *  Opus 5.5 / Sonnet 5.5 reject forced tool use and always think — use structured outputs + `effort`. */
export const MODELS: Record<ModelRole, { model: string; effort: 'low' | 'medium' | 'high'; maxTokens: number }> = {
  classify: { model: 'claude-haiku-5-5', effort: 'low', maxTokens: 4_000 },
  extract: { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 16_000 },
  extract_hard: { model: 'claude-opus-5-5', effort: 'medium', maxTokens: 32_000 },
  chat: { model: 'claude-opus-5-5', effort: 'medium', maxTokens: 8_000 },
};
