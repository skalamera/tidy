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

/** The request's newest message carries a cache breakpoint, so each turn reuses the conversation so far (stored
 *  transcripts stay unmarked). */
export function withCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const last = messages.at(-1);
  if (!last) return messages;
  const content: Anthropic.ContentBlockParam[] =
    typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...last.content];
  const i = content.length - 1;
  const block = content[i];
  if (!block || block.type === 'thinking' || block.type === 'redacted_thinking') return messages;
  content[i] = { ...block, cache_control: { type: 'ephemeral' } } as Anthropic.ContentBlockParam;
  return [...messages.slice(0, -1), { ...last, content }];
}

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
      messages: withCacheBreakpoint(messages as Anthropic.MessageParam[]),
      output_config: { effort: m.effort },
    });
    let text = '';
    stream.on('text', (delta) => {
      text += delta;
      onText(delta);
    });
    const final = await stream.finalMessage();
    if (final.stop_reason === 'tool_use') {
      const calls: ToolCall[] = final.content.flatMap((b) =>
        b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input as Record<string, unknown> }] : [],
      );
      return { message: { role: 'assistant', content: final.content }, text, calls }; // unmodified, thinking blocks included
    }
    // Cut off (max_tokens) or stopped some other way: a tool call it didn't finish would leave the transcript with a
    // call and no result, which the API rejects on every later turn. Keep only what it said.
    const content = final.content.filter((b) => b.type !== 'tool_use');
    if (final.stop_reason === 'max_tokens') {
      const note = text ? '\n\n(My answer got cut off. Ask me to go on.)' : '';
      text += note;
      if (note) onText(note);
    }
    const said = content.some((b) => b.type === 'text' && b.text.trim() !== '');
    return { message: said ? { role: 'assistant', content } : null, text, calls: [] };
  }
}
