import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import type { AiProvider } from '../../shared/ai';
import type { Connection } from '../service';
import { AnthropicChatModel, AnthropicLlm } from './anthropic';
import { GeminiChatModel, GeminiLlm } from './gemini';

const TEN_MINUTES = 10 * 60 * 1000;

/** Clients for one AI and API key. `verify` makes a free models.list call so a bad key fails right away. */
export async function connect(provider: AiProvider, apiKey: string, verify: boolean): Promise<Connection> {
  if (provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: TEN_MINUTES, retryOptions: { attempts: 4 } } });
    if (verify) await ai.models.list({ config: { pageSize: 1 } });
    return { provider, llm: new GeminiLlm(ai.models), chat: new GeminiChatModel(ai.models) };
  }
  const client = new Anthropic({ apiKey, maxRetries: 3, timeout: TEN_MINUTES });
  if (verify) await client.models.list({ limit: 1 });
  return { provider, llm: new AnthropicLlm(client), chat: new AnthropicChatModel(client) };
}
