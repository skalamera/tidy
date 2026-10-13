import type { z } from 'zod';
import type { ModelRole } from './models';

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

/** Everything the app needs from an LLM for document work. Tests use FakeLlm; the app uses AnthropicLlm or GeminiLlm. */
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

/** Test double: answers each call with whatever `respond` returns for it. */
export class FakeLlm implements LlmClient {
  readonly calls: StructuredCall<z.ZodType>[] = [];
  constructor(private readonly respond: (call: StructuredCall<z.ZodType>) => unknown) {}
  async structured<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S>> {
    this.calls.push(call);
    return call.schema.parse(this.respond(call)) as z.infer<S>;
  }
}
