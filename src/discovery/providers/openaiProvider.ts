/**
 * Provedor OpenAI (Codex/GPT) — alternativa temporária ao Claude.
 *
 * Mesma interface do AnthropicProvider: recebe prompt + imagem e devolve texto
 * bruto (esperado JSON). Selecionado com AI_PROVIDER=openai.
 *
 * Modelo configurável com OPENAI_MODEL (default: gpt-4o, que tem visão).
 * Requer OPENAI_API_KEY com saldo na API da OpenAI (≠ assinatura do ChatGPT).
 */

import OpenAI from 'openai'
import type { AiProvider, VisionDiscoveryInput, VisionDiscoveryRaw } from '../aiProvider'

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai'

  async discover(input: VisionDiscoveryInput): Promise<VisionDiscoveryRaw> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY ausente no ambiente.')

    const client = new OpenAI({ apiKey })
    const model = process.env.OPENAI_MODEL ?? 'gpt-4o'

    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: 'text', text: input.userPrompt },
    ]
    if (input.imageBase64) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${input.imageBase64}` },
      })
    }

    try {
      const resp = await client.chat.completions.create({
        model,
        max_tokens: input.maxTokens ?? 1024,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: userContent },
        ],
      })

      const text = resp.choices[0]?.message?.content ?? ''
      return {
        text,
        usage: resp.usage
          ? { inputTokens: resp.usage.prompt_tokens, outputTokens: resp.usage.completion_tokens }
          : undefined,
      }
    } catch (err: unknown) {
      throw normalizeError(err)
    }
  }
}

function normalizeError(err: unknown): Error {
  const e = err as { status?: number; code?: string; message?: string }
  if (e.status === 429 || /quota|billing|insufficient/i.test(e.message ?? '')) {
    return new Error('Sem saldo/quota na API da OpenAI — verifique billing em platform.openai.com.')
  }
  return new Error(e.message ?? 'erro desconhecido na API OpenAI')
}
