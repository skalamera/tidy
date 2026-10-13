import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { CHAT_SYSTEM_PROMPT, TOOLS, type ChatModel, type ToolCall, type ToolResult } from './chat';
import { LlmError, type LlmClient, type Source, type StructuredCall } from './llm';
import { MODELS } from './models';

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
    const m = MODELS.anthropic[call.role];
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

/** Static on purpose: the system prompt and tools must not change between turns (thinking-block binding),
 *  and a stable prefix is what prompt caching reuses. Per-turn context goes in the user message instead. */
const SYSTEM: Anthropic.TextBlockParam[] = [{ type: 'text', cache_control: { type: 'ephemeral' }, text: CHAT_SYSTEM_PROMPT }];
const CLAUDE_TOOLS: Anthropic.Tool[] = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

export class AnthropicChatModel implements ChatModel {
  constructor(private readonly client: Anthropic) {}

  userMessage(texts: string[]): Anthropic.MessageParam {
    return { role: 'user', content: texts.map((text) => ({ type: 'text', text })) };
  }

  toolResultsMessage(results: ToolResult[]): Anthropic.MessageParam {
    return {
      role: 'user',
      content: results.map(({ call, output, isError }): Anthropic.ToolResultBlockParam =>
        isError
          ? { type: 'tool_result', tool_use_id: call.id, content: String(output), is_error: true }
          : { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output) },
      ),
    };
  }

  async turn(messages: unknown[], onText: (delta: string) => void) {
    const m = MODELS.anthropic.chat;
    const stream = this.client.messages.stream({
      model: m.model,
      max_tokens: m.maxTokens,
      system: SYSTEM,
      tools: CLAUDE_TOOLS,
      messages: messages as Anthropic.MessageParam[],
      output_config: { effort: m.effort },
    });
    let text = '';
    stream.on('text', (delta) => {
      text += delta;
      onText(delta);
    });
    const final = await stream.finalMessage();
    const calls: ToolCall[] =
      final.stop_reason === 'tool_use'
        ? final.content.flatMap((b) =>
            b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input as Record<string, unknown> }] : [],
          )
        : [];
    const message: Anthropic.MessageParam = { role: 'assistant', content: final.content }; // unmodified, thinking blocks included
    return { message, text, calls };
  }
}
