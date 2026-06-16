/**
 * Provedor Anthropic (Claude) — o padrão do projeto.
 *
 * Faz só a chamada à API; o prompt e o parsing ficam no discoveryAgent.
 * Política de custo (regra do projeto): Sonnet (DEFAULT), nunca Opus.
 */

import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_MODELS } from '../../config/constants'
import type { AiProvider, VisionDiscoveryInput, VisionDiscoveryRaw } from '../aiProvider'

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic'

  async discover(input: VisionDiscoveryInput): Promise<VisionDiscoveryRaw> {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente no ambiente.')

    const client = new Anthropic({ apiKey })
    const model = process.env.ANTHROPIC_MODEL ?? CLAUDE_MODELS.DEFAULT

    const content: Anthropic.MessageParam['content'] = [{ type: 'text', text: input.userPrompt }]
    if (input.imageBase64) {
      content.unshift({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: input.imageBase64 },
      })
    }

    try {
      const resp = await client.messages.create({
        model,
        max_tokens: input.maxTokens ?? 1024,
        system: input.systemPrompt,
        messages: [{ role: 'user', content }],
      })

      const text = resp.content
        .filter(b => b.type === 'text')
        .map(b => (b as { text: string }).text)
        .join('\n')

      return {
        text,
        usage: { inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens },
      }
    } catch (err: unknown) {
      throw normalizeError(err)
    }
  }
}

function normalizeError(err: unknown): Error {
  const e = err as { status?: number; message?: string }
  if (e.status === 400 && /credit balance/i.test(e.message ?? '')) {
    return new Error('Sem créditos na conta Anthropic — adicione em console.anthropic.com → Plans & Billing.')
  }
  return new Error(e.message ?? 'erro desconhecido na API Anthropic')
}
