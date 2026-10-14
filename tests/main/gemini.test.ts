import type { Content } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GeminiChatModel, GeminiLlm } from '../../src/main/ai/gemini';
import { fakeGemini, geminiReply } from './fakeGemini';

const Out = z.object({ total: z.number().int(), payer: z.string().nullable() });

describe('GeminiLlm', () => {
  it('sends the document inline with a JSON schema and returns the checked answer', async () => {
    const { models, requests } = fakeGemini({
      replies: [geminiReply([{ text: '{"total": 12, "payer": null}', thoughtSignature: 'sig' }])],
    });
    const out = await new GeminiLlm(models).structured({
      role: 'extract',
      system: 'SYS',
      source: { kind: 'pdf', base64: 'JVBERg==' },
      prompt: 'Read it.',
      schema: Out,
    });
    expect(out).toEqual({ total: 12, payer: null });
    expect(requests[0]).toMatchObject({
      model: 'gemini-3.8-flash',
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data: 'JVBERg==' } }, { text: 'Read it.' }] }],
      config: {
        systemInstruction: 'SYS',
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: 'MEDIUM' },
        responseJsonSchema: { type: 'object', required: ['total', 'payer'] },
      },
    });
    expect(requests[0].config?.responseJsonSchema).not.toHaveProperty('$schema');
  });

  it('turns cut-off, blocked and malformed answers into friendly errors', async () => {
    const read = (reply: unknown) =>
      new GeminiLlm(fakeGemini({ replies: [reply] }).models).structured({
        role: 'classify',
        system: 'S',
        source: null,
        prompt: 'p',
        schema: Out,
      });
    await expect(read(geminiReply([{ text: '{"tot' }], 'MAX_TOKENS'))).rejects.toMatchObject({ kind: 'truncated' });
    await expect(read(geminiReply([], 'SAFETY'))).rejects.toMatchObject({ kind: 'refused' });
    await expect(read({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })).rejects.toMatchObject({ kind: 'refused' });
    await expect(read(geminiReply([{ text: '{"total": "twelve", "payer": null}' }]))).rejects.toMatchObject({ kind: 'invalid' });
    await expect(read(geminiReply([{ text: 'Sorry, I can’t.' }]))).rejects.toMatchObject({ kind: 'invalid' });
  });
});

describe('GeminiChatModel', () => {
  it('streams only visible text and keeps every part, thought signatures included, for the next request', async () => {
    const thought = { text: 'Which line is that?', thought: true };
    const call = { functionCall: { id: 'c1', name: 'explain_line', args: { line_id: 'f1040.11' } }, thoughtSignature: 'sig1' };
    const { models, requests } = fakeGemini({
      streams: [[geminiReply([thought, { text: 'Let me look.' }]), geminiReply([call, { text: '' }])]],
    });
    const model = new GeminiChatModel(models);
    const seen: string[] = [];
    const res = await model.turn([model.userMessage(['<app_context>x</app_context>', 'hi'])], (d) => seen.push(d));
    expect(seen).toEqual(['Let me look.']);
    expect(res.text).toBe('Let me look.');
    expect(res.calls).toEqual([{ id: 'c1', name: 'explain_line', input: { line_id: 'f1040.11' } }]);
    expect(res.message).toEqual({ role: 'model', parts: [thought, { text: 'Let me look.' }, call, { text: '' }] });
    expect(requests[0].contents as Content[]).toEqual([
      { role: 'user', parts: [{ text: '<app_context>x</app_context>' }, { text: 'hi' }] },
    ]);
    expect(requests[0].config).toMatchObject({
      thinkingConfig: { thinkingLevel: 'LOW' },
      systemInstruction: expect.stringContaining('You are Tidy'),
    });
    const tools = requests[0].config?.tools as { functionDeclarations: { name: string }[] }[];
    expect(tools[0].functionDeclarations.map((f) => f.name)).toContain('propose_change');
  });
});
