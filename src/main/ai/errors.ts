import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from '@google/genai';
import { AI_NAMES, type AiProvider } from '../../shared/ai';

export type AiProblem = 'no_credits' | 'quota' | 'bad_key' | 'rate_limited' | 'busy' | 'offline' | 'too_long' | 'other';

/** What to tell the user when the AI service fails: the problem in plain words, and whether switching AI would help. */
export interface AiFailure {
  problem: AiProblem;
  text: string;
  changeAi: boolean;
}

const OTHER_AI: Record<AiProvider, AiProvider> = { anthropic: 'gemini', gemini: 'anthropic' };
const SWITCHING_HELPS: AiProblem[] = ['no_credits', 'quota', 'bad_key'];
const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH']);
const TOO_LONG = /prompt is too long|input token count .*exceeds|exceeds the maximum number of tokens/i;

/** No connection at all. Both SDKs retry these a few times before giving up. */
function isOffline(e: unknown): boolean {
  if (e instanceof Anthropic.APIConnectionError) return true;
  if (!(e instanceof Error)) return false;
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  const code = (e as { cause?: { code?: unknown } }).cause?.code ?? (e as { code?: unknown }).code;
  return (typeof code === 'string' && NETWORK_CODES.has(code)) || (e instanceof TypeError && e.message === 'fetch failed');
}

/** The service's own words. Anthropic's SDK keeps the reply body on `error`; Google's puts the reply JSON in `message`. */
function serviceMessage(e: Error): string {
  if (e instanceof Anthropic.APIError) {
    const body = e.error as { error?: { message?: unknown } } | undefined;
    if (typeof body?.error?.message === 'string') return body.error.message;
  }
  const json = e.message.indexOf('{');
  if (json !== -1) {
    try {
      const reply = JSON.parse(e.message.slice(json)) as { error?: { message?: unknown } };
      if (typeof reply.error?.message === 'string') return reply.error.message;
    } catch {
      // not JSON: the message is the best there is
    }
  }
  return e.message;
}

function diagnose(e: unknown): { problem: AiProblem; detail: string } | null {
  if (isOffline(e)) return { problem: 'offline', detail: '' };
  if (e instanceof Anthropic.APIError) {
    const detail = serviceMessage(e);
    const status = e.status ?? 0;
    const problem: AiProblem =
      e.type === 'billing_error' || /credit balance/i.test(detail)
        ? 'no_credits' // Anthropic answers 400 invalid_request_error: "Your credit balance is too low to access the Anthropic API."
        : TOO_LONG.test(detail) || status === 413
          ? 'too_long'
          : status === 401 || status === 403
            ? 'bad_key'
            : status === 429
              ? 'rate_limited'
              : status >= 500
                ? 'busy'
                : 'other';
    return { problem, detail };
  }
  if (e instanceof ApiError) {
    const detail = serviceMessage(e);
    const problem: AiProblem =
      e.status === 429
        ? 'quota' // Google uses one message for the per-minute and the daily or free-tier limits
        : /billing/i.test(detail)
          ? 'no_credits'
          : e.status === 401 || e.status === 403 || /api key/i.test(detail)
            ? 'bad_key'
            : TOO_LONG.test(detail)
              ? 'too_long'
              : e.status >= 500
                ? 'busy'
                : 'other';
    return { problem, detail };
  }
  return null;
}

/** The service's words as one short sentence. */
function sentence(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  const cut = t.length > 200 ? `${t.slice(0, 199).trimEnd()}…` : t;
  return /[.!?…]$/.test(cut) ? cut : `${cut}.`;
}

/** What went wrong with the AI service, for the person using Tidy. Null when `e` didn't come from the AI service,
 *  so the caller says what it was doing instead. */
export function aiFailure(provider: AiProvider, e: unknown, during: 'chat' | 'document'): AiFailure | null {
  const found = diagnose(e);
  if (!found) return null;
  const { ai, company } = AI_NAMES[provider];
  const other = AI_NAMES[OTHER_AI[provider]].ai;
  const verb = during === 'chat' ? 'answer' : 'read this file';
  const text: Record<AiProblem, () => string> = {
    no_credits: () =>
      provider === 'anthropic'
        ? `Your Anthropic account is out of credits, so Claude can’t ${verb}. Add credits in the Anthropic Console under Plans & Billing, or switch Tidy to ${other}.`
        : `Your Gemini key needs billing turned on, so Gemini can’t ${verb}. Turn on billing for it in Google AI Studio, or switch Tidy to ${other}.`,
    quota: () =>
      `Your ${ai} key has hit its usage limit, so ${ai} can’t ${verb} right now. Wait a minute and try again. If it keeps happening, check its plan and billing in Google AI Studio, or switch Tidy to ${other}.`,
    bad_key: () =>
      `${company} didn’t accept your ${ai} key, so ${ai} can’t ${verb}. The key may have been deleted or turned off. Connect a new key, or switch Tidy to ${other}.`,
    rate_limited: () => `${ai} got too many requests from your account at once. Wait a minute and try again.`,
    busy: () => `${ai} is overloaded right now. Wait a minute and try again.`,
    offline: () => `Tidy couldn’t reach ${ai}. Check your internet connection and try again.`,
    too_long: () =>
      during === 'chat'
        ? `This chat is too long for ${ai} to keep reading. Start a new chat to keep going.`
        : `This file is too long for ${ai} to read in one go. Try uploading it in smaller parts.`,
    other: () => `${ai} couldn’t ${verb}: ${sentence(found.detail)}`,
  };
  return { problem: found.problem, text: text[found.problem](), changeAi: SWITCHING_HELPS.includes(found.problem) };
}
