import Anthropic from '@anthropic-ai/sdk';
import type { Connection } from '../service';
import { AnthropicChatModel } from './chat';
import { AnthropicLlm } from './llm';

/** Claude clients for one API key. `verify` makes a free models.list call so a bad key fails right away. */
export async function connect(apiKey: string, verify: boolean): Promise<Connection> {
  const client = new Anthropic({ apiKey, maxRetries: 3, timeout: 10 * 60 * 1000 });
  if (verify) await client.models.list({ limit: 1 });
  return { llm: new AnthropicLlm(client), chat: new AnthropicChatModel(client) };
}
