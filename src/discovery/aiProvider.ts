/**
 * Camada de provedor de IA — torna o "cérebro" da descoberta plugável.
 *
 * O discoveryAgent monta o prompt e faz o parsing do JSON (lógica comum,
 * independente de fornecedor). Quem fala com a API é um AiProvider concreto:
 * Anthropic (padrão do projeto) ou OpenAI (alternativa temporária).
 *
 * Escolha por env: AI_PROVIDER=anthropic | openai  (default: anthropic).
 *
 * Self-contained quanto a env: lê chaves de process.env direto, sem passar
 * por @config/environments (que exigiria ANTHROPIC_API_KEY/DATABASE_URL).
 */

export interface VisionDiscoveryInput {
  systemPrompt: string
  userPrompt: string
  /** Screenshot em base64 (png), opcional — habilita visão. */
  imageBase64?: string
  /** Máximo de tokens de saída (default 1024). Geração de cenários pede mais. */
  maxTokens?: number
}

export interface VisionDiscoveryRaw {
  /** Texto bruto devolvido pelo modelo (esperado: JSON). */
  text: string
  usage?: { inputTokens: number; outputTokens: number }
}

export interface AiProvider {
  readonly name: string
  discover(input: VisionDiscoveryInput): Promise<VisionDiscoveryRaw>
}

export type ProviderName = 'anthropic' | 'openai' | 'gemini'

/** Retorna o provedor configurado em AI_PROVIDER (default: anthropic). */
export function getProvider(override?: ProviderName): AiProvider {
  const choice = (override ?? process.env.AI_PROVIDER ?? 'anthropic').toLowerCase()

  // Import tardio para não carregar SDKs que não serão usados.
  if (choice === 'openai') {
    const { OpenAiProvider } = require('./providers/openaiProvider') as typeof import('./providers/openaiProvider')
    return new OpenAiProvider()
  }

  if (choice === 'gemini') {
    const { GeminiProvider } = require('./providers/geminiProvider') as typeof import('./providers/geminiProvider')
    return new GeminiProvider()
  }

  const { AnthropicProvider } = require('./providers/anthropicProvider') as typeof import('./providers/anthropicProvider')
  return new AnthropicProvider()
}
