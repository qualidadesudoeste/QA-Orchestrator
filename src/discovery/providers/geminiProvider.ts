/**
 * Provedor Google Gemini — opção com camada GRATUITA para testar a IA.
 *
 * Mesma interface dos outros adaptadores. Selecionado com AI_PROVIDER=gemini.
 * Modelo configurável com GEMINI_MODEL (default: gemini-1.5-flash, tem visão).
 * Requer GEMINI_API_KEY (grátis em aistudio.google.com).
 *
 * Bônus: força responseMimeType=application/json, então o modelo já devolve
 * JSON limpo (menos parsing frágil).
 */

import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai'
import type { Part, SafetySetting } from '@google/generative-ai'
import type { AiProvider, VisionDiscoveryInput, VisionDiscoveryRaw } from '../aiProvider'

// Teste de software de segurança (SQLi/XSS) é uso legítimo — não deixar o
// filtro do Gemini bloquear a geração de cenários.
const SAFETY: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
]

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini'

  async discover(input: VisionDiscoveryInput): Promise<VisionDiscoveryRaw> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY ausente no ambiente.')

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL ?? 'gemini-flash-latest',
      systemInstruction: input.systemPrompt,
      safetySettings: SAFETY,
      generationConfig: {
        maxOutputTokens: input.maxTokens ?? 1024,
        responseMimeType: 'application/json',
        // Temperatura mais alta reduz bloqueio por RECITATION (saída "decorada").
        temperature: Number(process.env.GEMINI_TEMPERATURE ?? 1),
      },
    })

    const parts: Part[] = [{ text: input.userPrompt }]
    if (input.imageBase64) {
      parts.push({ inlineData: { mimeType: 'image/png', data: input.imageBase64 } })
    }

    // Free tier sofre 429/503 transitórios — algumas tentativas com espera.
    const maxAttempts = 4
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await model.generateContent(parts)
        const text = result.response.text()
        const usage = result.response.usageMetadata
        return {
          text,
          usage: usage
            ? { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount }
            : undefined,
        }
      } catch (err: unknown) {
        const e = err as { status?: number; message?: string }
        const transient =
          e.status === 429 ||
          e.status === 503 ||
          /overload|too many|unavailable|recitation|blocked/i.test(e.message ?? '')
        if (transient && attempt < maxAttempts) {
          const waitMs = 4000 * attempt
          console.log(`      (Gemini ${e.status ?? ''} — tentativa ${attempt}/${maxAttempts}, aguardando ${waitMs / 1000}s)`)
          await sleep(waitMs)
          continue
        }
        throw normalizeError(err)
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function normalizeError(err: unknown): Error {
  const e = err as { status?: number; message?: string }
  if (e.status === 429 || /quota|resource_exhausted|rate limit/i.test(e.message ?? '')) {
    return new Error('Limite/quota do Gemini atingido — aguarde um pouco (free tier) ou veja aistudio.google.com.')
  }
  if (e.status === 400 && /api key/i.test(e.message ?? '')) {
    return new Error('GEMINI_API_KEY inválida — gere outra em aistudio.google.com.')
  }
  return new Error(e.message ?? 'erro desconhecido na API Gemini')
}
