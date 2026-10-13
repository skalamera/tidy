import type { GenerateContentParameters } from '@google/genai';
import type { GeminiModels } from '../../src/main/ai/gemini';

/** One Gemini reply (or one streamed chunk), shaped like the SDK's GenerateContentResponse. */
export const geminiReply = (parts: unknown[], finishReason = 'STOP') => ({
  candidates: [{ content: { role: 'model', parts }, finishReason }],
});

/** Fakes the two Gemini SDK calls Tidy makes. `replies` answer generateContent in order; `streams` answer
 *  generateContentStream in order, one list of chunks per call. Every request is recorded as a deep copy. */
export function fakeGemini(opts: { replies?: unknown[]; streams?: unknown[][] }) {
  const requests: GenerateContentParameters[] = [];
  const models = {
    generateContent: async (req: GenerateContentParameters) => {
      requests.push(structuredClone(req));
      return opts.replies!.shift();
    },
    generateContentStream: async (req: GenerateContentParameters) => {
      requests.push(structuredClone(req));
      const chunks = opts.streams!.shift()!;
      return (async function* () {
        yield* chunks;
      })();
    },
  } as unknown as GeminiModels;
  return { models, requests };
}
