import type Anthropic from '@anthropic-ai/sdk'
import type { ReviewerPolicy } from './policy.ts'
import type { CallModel } from './reviewer.ts'

/** Reads ANTHROPIC_API_KEY. A refused request is retried by the API on `fallbackModel`, which costs the same. */
export async function anthropicModel(reviewer: ReviewerPolicy): Promise<CallModel> {
  // Loaded here so the gate, which never calls a model, runs without installing anything.
  const { default: Client } = await import('@anthropic-ai/sdk')
  const client = new Client({ maxRetries: 2, timeout: 5 * 60_000 })
  return async ({ system, tools, messages, maxTokens }) => {
    const response = await client.beta.messages.create({
      model: reviewer.model,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: [{ model: reviewer.fallbackModel }],
      output_config: { effort: reviewer.effort as 'low' | 'medium' | 'high' },
      cache_control: { type: 'ephemeral' },
      system,
      tools: tools as Anthropic.Beta.BetaToolUnion[],
      messages: messages as Anthropic.Beta.BetaMessageParam[]
    })
    return {
      content: response.content,
      stopReason: response.stop_reason ?? '',
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0
      }
    }
  }
}

export async function modelFor(reviewer: ReviewerPolicy): Promise<CallModel> {
  if (reviewer.provider === 'anthropic') return anthropicModel(reviewer)
  throw new Error(`No client for AI provider "${reviewer.provider}": add one next to anthropic.ts and return it here`)
}
