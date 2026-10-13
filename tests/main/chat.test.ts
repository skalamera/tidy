import { describe, expect, it } from 'vitest';
import { runChatTurn, type ChatModel } from '../../src/main/ai/chat';

/** Plays back a fixed list of assistant messages, recording every request. */
function scripted(replies: { content: unknown[]; stop_reason: string }[]) {
  const requests: unknown[] = [];
  const model: ChatModel = {
    async turn(req, onText) {
      requests.push(structuredClone(req.messages));
      const r = replies.shift()!;
      for (const b of r.content as { type: string; text?: string }[]) if (b.type === 'text') onText(b.text!);
      return r as never;
    },
  };
  return { model, requests };
}

describe('runChatTurn', () => {
  it('calls tools, feeds results back, and returns the final answer', async () => {
    const { model, requests } = scripted([
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
    expect(out.transcript).toHaveLength(4); // user, assistant(tool_use), user(tool_result), assistant(text)
    const second = requests[1] as { role: string; content: { type: string; tool_use_id?: string; content?: string }[] }[];
    expect(second[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 't1', content: '{"id":"schA.5e","amount":4000000}' });
    expect((second[1].content[0] as { signature?: string }).signature).toBe('s1'); // thinking passed back unmodified
  });

  it('puts the screen context in the user turn and reports tool errors to the model', async () => {
    const { model, requests } = scripted([
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
    const first = requests[0] as { content: { text: string }[] }[];
    expect(first[0].content[0].text).toBe('<app_context>\nscreen: wages\n</app_context>');
    const second = requests[1] as { content: { is_error?: boolean }[] }[];
    expect(second[2].content[0].is_error).toBe(true);
  });
});
