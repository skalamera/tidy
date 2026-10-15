import type Anthropic from '@anthropic-ai/sdk';
import type { Content } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { AnthropicChatModel } from '../../src/main/ai/anthropic';
import { runChatTurn } from '../../src/main/ai/chat';
import { GeminiChatModel } from '../../src/main/ai/gemini';
import { fakeGemini, geminiReply } from './fakeGemini';

/** An Anthropic client whose messages.stream plays back a fixed list of final messages, recording every request. */
function fakeClaude(replies: { content: unknown[]; stop_reason: string }[]) {
  const requests: Anthropic.MessageCreateParams[] = [];
  const client = {
    messages: {
      stream(req: Anthropic.MessageCreateParams) {
        requests.push(structuredClone(req));
        const reply = replies.shift()!;
        const listeners: ((delta: string) => void)[] = [];
        return {
          on(event: string, cb: (delta: string) => void) {
            if (event === 'text') listeners.push(cb);
          },
          async finalMessage() {
            for (const b of reply.content as { type: string; text?: string }[])
              if (b.type === 'text') listeners.forEach((cb) => cb(b.text!));
            return reply;
          },
        };
      },
    },
  } as unknown as Anthropic;
  return { model: new AnthropicChatModel(client), requests };
}

describe('runChatTurn', () => {
  it('calls tools, feeds results back, and returns the final answer', async () => {
    const { model, requests } = fakeClaude([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'thinking', thinking: '', signature: 's1' },
          { type: 'tool_use', id: 't1', name: 'explain_line', input: { line_id: 'schA.5e' } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Your SALT deduction is capped at $40,000.' }] },
    ]);
    const seen: string[] = [];
    const out = await runChatTurn({
      model,
      transcript: [],
      userText: 'Why is this smaller than what I paid?',
      context: 'screen: deductions',
      handlers: { explain_line: async (i) => ({ id: i.line_id, amount: 4_000_000 }) },
      onText: (d) => seen.push(d),
    });
    expect(out.text).toBe('Your SALT deduction is capped at $40,000.');
    expect(seen).toEqual(['Your SALT deduction is capped at $40,000.']);
    expect(out.transcript).toHaveLength(4); // user, assistant(tool_use), user(tool_result), assistant(text)
    const second = requests[1].messages as { role: string; content: { type: string; tool_use_id?: string; content?: string }[] }[];
    expect(second[2].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 't1',
      content: '{"id":"schA.5e","amount":4000000}',
      cache_control: { type: 'ephemeral' }, // the newest message carries the cache breakpoint
    });
    expect((second[1].content[0] as { signature?: string }).signature).toBe('s1'); // thinking passed back unmodified
  });

  it('puts the screen context in the user turn and reports tool errors to the model', async () => {
    const { model, requests } = fakeClaude([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'get_section', input: { section_id: 'wages' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sorry, I could not load that.' }] },
    ]);
    await runChatTurn({
      model,
      transcript: [],
      userText: 'hi',
      context: 'screen: wages',
      handlers: {
        get_section: async () => {
          throw new Error('boom');
        },
      },
      onText: () => {},
    });
    const first = requests[0].messages as { content: { text: string }[] }[];
    expect(first[0].content[0].text).toBe('<app_context>\nscreen: wages\n</app_context>');
    const second = requests[1].messages as { content: { is_error?: boolean }[] }[];
    expect(second[2].content[0].is_error).toBe(true);
  });

  it('runs the same loop on Gemini, answering each call by id and sending thought signatures back unchanged', async () => {
    const lookup = { functionCall: { id: 'c1', name: 'explain_line', args: { line_id: 'schA.5e' } }, thoughtSignature: 'sig1' };
    const broken = { functionCall: { id: 'c2', name: 'get_section', args: { section_id: 'deductions' } } };
    const { models, requests } = fakeGemini({
      streams: [
        [geminiReply([lookup, broken])],
        [geminiReply([{ text: 'Your SALT deduction is capped at $40,000.', thoughtSignature: 'sig2' }])],
      ],
    });
    const out = await runChatTurn({
      model: new GeminiChatModel(models),
      transcript: [],
      userText: 'Why is this smaller than what I paid?',
      context: 'screen: deductions',
      handlers: {
        explain_line: async (i) => ({ id: i.line_id, amount: 4_000_000 }),
        get_section: async () => {
          throw new Error('boom');
        },
      },
      onText: () => {},
    });
    expect(out.text).toBe('Your SALT deduction is capped at $40,000.');
    expect(out.transcript).toHaveLength(4);
    const second = requests[1].contents as Content[];
    expect(second[0].parts![0]).toEqual({ text: '<app_context>\nscreen: deductions\n</app_context>' });
    expect(second[1]).toEqual({ role: 'model', parts: [lookup, broken] });
    expect(second[2]).toEqual({
      role: 'user',
      parts: [
        { functionResponse: { id: 'c1', name: 'explain_line', response: { output: { id: 'schA.5e', amount: 4_000_000 } } } },
        { functionResponse: { id: 'c2', name: 'get_section', response: { error: 'boom' } } },
      ],
    });
  });

  it('says so plainly when the model gives no answer', async () => {
    const { models } = fakeGemini({ streams: [[geminiReply([], 'SAFETY')]] });
    const out = await runChatTurn({
      model: new GeminiChatModel(models),
      transcript: [],
      userText: 'hi',
      context: 'screen: wages',
      handlers: {},
      onText: () => {},
    });
    expect(out.text).toBe('I couldn’t answer that one. Could you ask it another way?');
  });
});

describe('a cut-off or empty reply', () => {
  const ask = (model: Parameters<typeof runChatTurn>[0]['model'], transcript: unknown[], userText: string) =>
    runChatTurn({ model, transcript, userText, context: 'screen: wages', handlers: {}, onText: () => {} });

  it('drops a tool call cut off by max_tokens, keeps what was said, and the next turn still works', async () => {
    const { model, requests } = fakeClaude([
      {
        stop_reason: 'max_tokens',
        content: [
          { type: 'text', text: 'Let me check that line.' },
          { type: 'tool_use', id: 't1', name: 'explain_line', input: {} },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here it is.' }] },
    ]);
    const first = await ask(model, [], 'Why?');
    expect(first.text).toBe('Let me check that line.\n\n(My answer got cut off. Ask me to go on.)');
    expect((first.transcript[1] as { content: { type: string }[] }).content.map((b) => b.type)).toEqual(['text']);
    await ask(model, first.transcript, 'Go on');
    expect((requests[1].messages as { role: string }[]).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('forgets the question when nothing usable came back, on either AI', async () => {
    const prior = [
      { role: 'user', content: [{ type: 'text', text: 'earlier' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
    ];
    const { model } = fakeClaude([{ stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '', signature: 's' }] }]);
    const out = await ask(model, prior, 'x');
    expect(out.transcript).toBe(prior);
    expect(out.text).toBe('I couldn’t answer that one. Could you ask it another way?');
    const { models } = fakeGemini({ streams: [[]] });
    expect((await ask(new GeminiChatModel(models), [], 'x')).transcript).toEqual([]);
  });

  it('marks the newest message for prompt caching without saving the mark', async () => {
    const { model, requests } = fakeClaude([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi.' }] }]);
    const out = await ask(model, [], 'hi');
    const sent = requests[0].messages as { content: { cache_control?: unknown }[] }[];
    expect(sent.at(-1)!.content.at(-1)!.cache_control).toEqual({ type: 'ephemeral' });
    expect(JSON.stringify(out.transcript)).not.toContain('cache_control');
  });
});
