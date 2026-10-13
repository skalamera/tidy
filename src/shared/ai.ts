/** The AI services Tidy can use. Each one needs the user's own API key. */
export const AI_PROVIDERS = ['anthropic', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** How the app names each one: the AI itself and the company that runs it. */
export const AI_NAMES: Record<AiProvider, { ai: string; company: string }> = {
  anthropic: { ai: 'Claude', company: 'Anthropic' },
  gemini: { ai: 'Gemini', company: 'Google' },
};
