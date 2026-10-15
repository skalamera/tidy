import { FinishReason, ThinkingLevel, type Content, type GenerateContentConfig, type GoogleGenAI, type Part } from '@google/genai';
import { z } from 'zod';
import { CHAT_SYSTEM_PROMPT, TOOLS, type ChatModel, type ToolCall, type ToolResult } from './chat';
import { LlmError, type LlmClient, type Source, type StructuredCall } from './llm';
import { MODELS, type ModelSpec } from './models';

/** The two Gemini SDK calls Tidy makes, so tests can pass a fake. Both use the stateless generateContent API on
 *  purpose: Google's newer Interactions API stores every request on its servers unless told not to. */
export type GeminiModels = Pick<GoogleGenAI['models'], 'generateContent' | 'generateContentStream'>;

const LEVEL = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH } as const;
const tuning = (m: ModelSpec): GenerateContentConfig => ({
  maxOutputTokens: m.maxTokens,
  thinkingConfig: { thinkingLevel: LEVEL[m.effort] },
});

export function sourcePart(s: Source): Part {
  switch (s.kind) {
    case 'pdf':
      return { inlineData: { mimeType: 'application/pdf', data: s.base64 } };
    case 'image':
      return { inlineData: { mimeType: s.mediaType, data: s.base64 } };
    case 'text':
      return { text: `<document>\n${s.text}\n</document>` };
  }
}

/** What the user may see: text parts that are not the model's thoughts. */
const visibleText = (parts: Part[]) =>
  parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');

/** Gemini takes standard JSON Schema (anyOf, enums, descriptions) in `responseJsonSchema`, minus the `$schema` header. */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _version, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class GeminiLlm implements LlmClient {
  constructor(private readonly models: GeminiModels) {}

  async structured<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S>> {
    const m = MODELS.gemini[call.role];
    const parts = call.source ? [sourcePart(call.source), { text: call.prompt }] : [{ text: call.prompt }];
    const res = await this.models.generateContent({
      model: m.model,
      contents: [{ role: 'user', parts }],
      config: {
        ...tuning(m),
        systemInstruction: call.system,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema(call.schema),
      },
    });
    const c = res.candidates?.[0];
    if (c?.finishReason === FinishReason.MAX_TOKENS) throw new LlmError('This document is too long to read in one pass.', 'truncated');
    if (!c || res.promptFeedback?.blockReason || (c.finishReason && c.finishReason !== FinishReason.STOP))
      throw new LlmError('The model declined to read this document.', 'refused');
    const parsed = call.schema.safeParse(parseJson(visibleText(c.content?.parts ?? [])));
    if (!parsed.success) throw new LlmError('The model returned no data.', 'invalid');
    return parsed.data;
  }
}

const GEMINI_TOOLS = [
  { functionDeclarations: TOOLS.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) },
];

export class GeminiChatModel implements ChatModel {
  constructor(private readonly models: GeminiModels) {}

  userMessage(texts: string[]): Content {
    return { role: 'user', parts: texts.map((text) => ({ text })) };
  }

  toolResultsMessage(results: ToolResult[]): Content {
    return {
      role: 'user',
      parts: results.map(({ call, output, isError }) => ({
        functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: isError ? { error: output } : { output } },
      })),
    };
  }

  async turn(messages: unknown[], onText: (delta: string) => void) {
    const m = MODELS.gemini.chat;
    const stream = await this.models.generateContentStream({
      model: m.model,
      contents: messages as Content[],
      config: { ...tuning(m), systemInstruction: CHAT_SYSTEM_PROMPT, tools: GEMINI_TOOLS },
    });
    const parts: Part[] = []; // every streamed part, in order and unmodified: thought signatures must go back as received
    let text = '';
    for await (const chunk of stream) {
      for (const p of chunk.candidates?.[0]?.content?.parts ?? []) {
        parts.push(p);
        if (!p.thought && p.text) {
          text += p.text;
          onText(p.text);
        }
      }
    }
    const calls: ToolCall[] = parts.flatMap(({ functionCall: f }) =>
      f?.name ? [{ id: f.id ?? '', name: f.name, input: f.args ?? {} }] : [],
    );
    // Nothing came back (blocked, or an empty stream): an empty model turn would be rejected on every later request.
    const message: Content | null = parts.length > 0 ? { role: 'model', parts } : null;
    return { message, text, calls };
  }
}
