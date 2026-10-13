import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { aiFailure } from '../../src/main/ai/errors';
import { LlmError } from '../../src/main/ai/llm';
import type { AiProvider } from '../../src/shared/ai';

/** Errors exactly as each SDK builds them from the API's reply. */
const claudeError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, undefined, new Headers());
const geminiError = (status: number, statusText: string, message: string) =>
  new ApiError({ status, message: JSON.stringify({ error: { code: status, message, status: statusText } }) });
const offline = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });

const NO_CREDITS =
  'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';

describe('aiFailure', () => {
  it('says plainly when the Anthropic account is out of credits, and offers another AI', () => {
    expect(aiFailure('anthropic', claudeError(400, 'invalid_request_error', NO_CREDITS), 'chat')).toEqual({
      problem: 'no_credits',
      changeAi: true,
      text: 'Your Anthropic account is out of credits, so Claude can’t answer. Add credits in the Anthropic Console under Plans & Billing, or switch Tidy to Gemini.',
    });
  });

  it('names the problem behind each kind of failure', () => {
    const cases: [AiProvider, unknown, string][] = [
      ['anthropic', claudeError(402, 'billing_error', 'Your account has no credits.'), 'no_credits'],
      ['anthropic', claudeError(401, 'authentication_error', 'invalid x-api-key'), 'bad_key'],
      [
        'anthropic',
        claudeError(403, 'permission_error', 'Your API key does not have permission to use the specified resource.'),
        'bad_key',
      ],
      [
        'anthropic',
        claudeError(429, 'rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit'),
        'rate_limited',
      ],
      ['anthropic', claudeError(529, 'overloaded_error', 'Overloaded'), 'busy'],
      ['anthropic', claudeError(500, 'api_error', 'Internal server error'), 'busy'],
      ['anthropic', claudeError(400, 'invalid_request_error', 'prompt is too long: 210000 tokens > 200000 maximum'), 'too_long'],
      ['anthropic', new Anthropic.APIConnectionError({ message: 'Connection error.' }), 'offline'],
      ['anthropic', claudeError(400, 'invalid_request_error', 'messages.1: text content blocks must be non-empty'), 'other'],
      [
        'gemini',
        geminiError(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota, please check your plan and billing details.'),
        'quota',
      ],
      ['gemini', geminiError(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.'), 'bad_key'],
      ['gemini', geminiError(403, 'PERMISSION_DENIED', 'Your API key was reported as leaked. Please use another API key.'), 'bad_key'],
      [
        'gemini',
        geminiError(
          400,
          'FAILED_PRECONDITION',
          'Gemini API free tier is not available in your country. Please enable billing on your project in Google AI Studio.',
        ),
        'no_credits',
      ],
      ['gemini', geminiError(503, 'UNAVAILABLE', 'The model is overloaded. Please try again later.'), 'busy'],
      [
        'gemini',
        geminiError(400, 'INVALID_ARGUMENT', 'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).'),
        'too_long',
      ],
      ['gemini', offline(), 'offline'],
    ];
    expect(cases.map(([provider, e]) => aiFailure(provider, e, 'chat')?.problem)).toEqual(cases.map(([, , problem]) => problem));
  });

  it('offers another AI only when switching would help', () => {
    const changeAi = (provider: AiProvider, e: unknown) => aiFailure(provider, e, 'chat')?.changeAi;
    expect(changeAi('gemini', geminiError(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota.'))).toBe(true);
    expect(changeAi('anthropic', claudeError(401, 'authentication_error', 'invalid x-api-key'))).toBe(true);
    expect(changeAi('anthropic', claudeError(529, 'overloaded_error', 'Overloaded'))).toBe(false);
    expect(changeAi('gemini', offline())).toBe(false);
  });

  it('words each message for what was being done', () => {
    const tooLong = claudeError(400, 'invalid_request_error', 'prompt is too long: 210000 tokens > 200000 maximum');
    expect(aiFailure('anthropic', tooLong, 'chat')?.text).toBe(
      'This chat is too long for Claude to keep reading. Start a new chat to keep going.',
    );
    expect(aiFailure('anthropic', tooLong, 'document')?.text).toBe(
      'This file is too long for Claude to read in one go. Try uploading it in smaller parts.',
    );
    expect(
      aiFailure('gemini', geminiError(401, 'UNAUTHENTICATED', 'Request had invalid authentication credentials.'), 'document')?.text,
    ).toBe(
      'Google didn’t accept your Gemini key, so Gemini can’t read this file. The key may have been deleted or turned off. Connect a new key, or switch Tidy to Claude.',
    );
    expect(aiFailure('gemini', offline(), 'chat')?.text).toBe('Tidy couldn’t reach Gemini. Check your internet connection and try again.');
  });

  it('passes on the AI’s own words for anything else, and leaves errors that aren’t the AI’s to the caller', () => {
    expect(
      aiFailure('anthropic', claudeError(400, 'invalid_request_error', 'messages.1: text content blocks must be non-empty'), 'chat')?.text,
    ).toBe('Claude couldn’t answer: messages.1: text content blocks must be non-empty.');
    expect(aiFailure('gemini', new Error('ENOENT: no such file or directory'), 'document')).toBeNull();
    expect(aiFailure('gemini', new LlmError('The model returned no data.', 'invalid'), 'document')).toBeNull();
  });
});
