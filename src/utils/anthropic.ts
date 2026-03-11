import Anthropic from '@anthropic-ai/sdk';

/**
 * Creates an Anthropic client, auto-detecting whether to use apiKey or authToken
 * based on the key prefix. OAuth tokens (sk-ant-oat*) use Bearer auth.
 */
export function createAnthropicClient(key?: string): Anthropic {
  const resolved = key || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;

  if (resolved && resolved.includes('-oat')) {
    return new Anthropic({ authToken: resolved, apiKey: null });
  }

  return key ? new Anthropic({ apiKey: key }) : new Anthropic();
}
