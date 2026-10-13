import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { MODELS, type ModelRole } from './models';

export type Source =
  | { kind: 'pdf'; base64: string }
  | { kind: 'image'; mediaType: 'image/png' | 'image/jpeg'; base64: string }
  | { kind: 'text'; text: string };

export interface StructuredCall<S extends z.ZodType> {
  role: ModelRole;
  system: string;
  source: Source | null;
  prompt: string;
  schema: S;
}

/** Everything the app needs from an LLM for document work. Tests use FakeLlm; the app uses AnthropicLlm. */
export interface LlmClient {
  structured<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S>>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'truncated' | 'refused' | 'invalid',
  ) {
    super(message);
  }
}

export function sourceBlock(s: Source): Anthropic.ContentBlockParam {
  switch (s.kind) {
    case 'pdf':
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: s.base64 } };
    case 'image':
      return { type: 'image', source: { type: 'base64', media_type: s.mediaType, data: s.base64 } };
    case 'text':
      return { type: 'text', text: `<document>\n${s.text}\n</document>` };
  }
}

export class AnthropicLlm implements LlmClient {
  constructor(private readonly client: Anthropic) {}

  async structured<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S>> {
    const m = MODELS[call.role];
    const content: Anthropic.ContentBlockParam[] = [];
    if (call.source) content.push(sourceBlock(call.source));
    content.push({ type: 'text', text: call.prompt });
    const res = await this.client.messages.parse({
      model: m.model,
      max_tokens: m.maxTokens,
      system: call.system,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(call.schema), effort: m.effort },
    });
    if (res.stop_reason === 'max_tokens') throw new LlmError('This document is too long to read in one pass.', 'truncated');
    if (res.stop_reason === 'refusal') throw new LlmError('The model declined to read this document.', 'refused');
    if (res.parsed_output == null) throw new LlmError('The model returned no data.', 'invalid');
    return res.parsed_output as z.infer<S>;
  }
}

/** Test double: answers each call with whatever `respond` returns for it. */
export class FakeLlm implements LlmClient {
  readonly calls: StructuredCall<z.ZodType>[] = [];
  constructor(private readonly respond: (call: StructuredCall<z.ZodType>) => unknown) {}
  async structured<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S>> {
    this.calls.push(call);
    return call.schema.parse(this.respond(call)) as z.infer<S>;
  }
}
