/**
 * DiscoveryAgent — a metade COM IA da descoberta (Fase B2).
 *
 * Monta o prompt a partir do que o Explorer coletou, delega a chamada ao
 * provedor de IA configurado (Claude ou OpenAI — ver aiProvider.ts) e faz o
 * parsing da resposta num LoginProfile.
 *
 * Tem `dryRun` para inspecionar o prompt SEM gastar créditos.
 */

import fs from 'fs'
import { getProvider, type ProviderName } from './aiProvider'
import type { ExplorationResult, InputCandidate, ButtonCandidate } from './explorer'
import type { LoginProfile } from './systemProfile'

export interface DiscoveryOutcome {
  isLoginScreen: boolean
  confidence: number
  login?: LoginProfile
  reasoning: string
  /** Qual provedor respondeu (anthropic | openai). */
  provider?: string
  /** Preenchido quando houve erro de API (créditos, auth, etc.). */
  error?: string
  /** No dryRun, traz o prompt que SERIA enviado. */
  promptPreview?: string
  usage?: { inputTokens: number; outputTokens: number }
}

export interface DiscoveryOptions {
  dryRun?: boolean
  /** Anexa o screenshot para o modelo usar visão (melhora a precisão). */
  useVision?: boolean
  /** Força um provedor específico, ignorando AI_PROVIDER. */
  provider?: ProviderName
}

const SYSTEM_PROMPT = `Você é um especialista em automação de testes que identifica telas de login.
Recebe a lista de campos e botões coletados de uma página (possivelmente com várias frames) e,
opcionalmente, um screenshot. Sua tarefa é decidir se é uma tela de login e indicar os seletores CSS.

Regras para os seletores:
- Prefira [name="..."] quando houver name; senão #id; senão um seletor robusto por atributo.
- usernameSelector: campo de usuário/login/email/CPF.
- passwordSelector: campo de senha (geralmente type="password").
- submitSelector: botão que envia o login.
- Se NÃO for tela de login, isLoginScreen=false e deixe os seletores vazios.

Responda APENAS com JSON válido, sem markdown, no formato:
{"isLoginScreen": boolean, "confidence": number (0..1), "usernameSelector": string, "passwordSelector": string, "submitSelector": string, "reasoning": string}`

function buildUserPrompt(exploration: ExplorationResult): string {
  const inputs = exploration.inputs
    .filter(i => i.visible)
    .map(i => `- input: type="${i.type}" name="${i.name}" id="${i.id}" placeholder="${i.placeholder}" aria-label="${i.ariaLabel}" frame="${i.frameUrl}"`)
    .join('\n')
  const buttons = exploration.buttons
    .filter(b => b.visible)
    .map(b => `- button: text="${b.text}" type="${b.type}" id="${b.id}" name="${b.name}"`)
    .join('\n')

  return `URL: ${exploration.url}
Título: ${exploration.title}
Frames: ${exploration.frameCount}${exploration.blocked ? `\nATENÇÃO: página parece bloqueada (${exploration.blocked.reason})` : ''}

CAMPOS VISÍVEIS:
${inputs || '(nenhum)'}

BOTÕES VISÍVEIS:
${buttons || '(nenhum)'}

Identifique a tela de login e os seletores.`
}

// ---------------------------------------------------------------------------
// Fallback heurístico (SEM IA) — Fase B2-bis.
//
// Quando a tela é INEQUÍVOCA (exatamente 1 campo de senha + 1 campo de usuário
// claro), o agente não precisa do LLM: monta o LoginProfile sozinho. Isso o
// mantém funcional quando o provedor de IA está fora do ar / sem saldo, e zera
// o custo nos casos óbvios. A IA continua sendo o caminho para telas ambíguas.
// ---------------------------------------------------------------------------

const USERNAME_HINTS = /user|login|email|e-mail|cpf|usuario|usuário|matricula|matrícula|conta|account|nome/i
const SUBMIT_HINTS = /entrar|acessar|login|logon|sign\s?in|enviar|submit|ok|confirmar|continuar/i
const TEXTLIKE = new Set(['', 'text', 'email', 'tel', 'search', 'number'])

/** Seletor robusto e estável para um input: prefere name, depois id, depois placeholder. */
function selectorFor(i: InputCandidate): string {
  if (i.name) return `[name="${i.name}"]`
  if (i.id) return `[id="${i.id}"]`
  if (i.placeholder) return `input[placeholder="${i.placeholder}"]`
  return `input[type="${i.type || 'text'}"]`
}

function buttonSelectorFor(b: ButtonCandidate): string | undefined {
  if (b.id) return `[id="${b.id}"]`
  if (b.name) return `[name="${b.name}"]`
  if (b.text) return `text=${b.text}`
  return undefined
}

/**
 * Tenta resolver o login sem IA. Retorna um DiscoveryOutcome quando a tela é
 * suficientemente óbvia; senão `null` (deixando a decisão para a IA).
 */
export function heuristicLogin(exploration: ExplorationResult): DiscoveryOutcome | null {
  if (exploration.blocked) return null

  const visible = exploration.inputs.filter(i => i.visible)
  const passwords = visible.filter(i => (i.type || '').toLowerCase() === 'password')
  if (passwords.length !== 1) return null // 0 ou >1 senha => ambíguo, IA decide
  const password = passwords[0]

  // Candidatos a usuário: campos de texto visíveis que não são a senha.
  const textInputs = visible.filter(
    i => i !== password && TEXTLIKE.has((i.type || '').toLowerCase())
  )
  if (textInputs.length === 0) return null

  // Escolhe o melhor: por dica no name/id/placeholder/aria; empate => o último
  // antes da senha (layout típico usuário-em-cima-da-senha).
  const passIdx = visible.indexOf(password)
  const scored = textInputs
    .map(i => {
      const hay = `${i.name} ${i.id} ${i.placeholder} ${i.ariaLabel}`
      const hinted = USERNAME_HINTS.test(hay) ? 2 : 0
      const beforePass = visible.indexOf(i) < passIdx ? 1 : 0
      return { i, score: hinted + beforePass }
    })
    .sort((a, b) => b.score - a.score)

  const username = scored[0].i

  // Só é "óbvio" se houver 1 só campo de texto, OU se algum tiver dica clara.
  const obvious = textInputs.length === 1 || scored[0].score >= 2
  if (!obvious) return null

  const confidence = textInputs.length === 1 ? 0.95 : 0.85

  // Submit: botão visível com cara de login; senão deixamos a cargo dos
  // fallbacks do navigator (que ainda tenta Enter no campo de senha).
  const visibleButtons = exploration.buttons.filter(b => b.visible)
  const submitBtn =
    visibleButtons.find(b => (b.type || '').toLowerCase() === 'submit') ||
    visibleButtons.find(b => SUBMIT_HINTS.test(`${b.text} ${b.id} ${b.name}`))
  const submitSel = submitBtn ? buttonSelectorFor(submitBtn) : undefined

  const login: LoginProfile = {
    frameUrlPattern: password.frameUrl || undefined,
    usernameSelectors: [selectorFor(username)],
    passwordSelectors: [selectorFor(password)],
    submitSelectors: submitSel ? [submitSel] : [],
    authenticatedSignals: [],
    confidence,
    source: 'discovered',
    learnedAt: new Date().toISOString(),
  }

  const reasoning =
    `heurística: 1 campo de senha (${selectorFor(password)}) + ` +
    `usuário ${selectorFor(username)}` +
    (submitSel ? ` + submit ${submitSel}` : ' (sem botão claro — Enter como fallback)')

  return {
    isLoginScreen: true,
    confidence,
    login,
    reasoning,
    provider: 'heurística',
  }
}

/** Pede ao provedor de IA para interpretar a exploração e devolver um LoginProfile. */
export async function discoverLogin(
  exploration: ExplorationResult,
  opts: DiscoveryOptions = {}
): Promise<DiscoveryOutcome> {
  const userPrompt = buildUserPrompt(exploration)

  if (opts.dryRun) {
    return {
      isLoginScreen: false,
      confidence: 0,
      reasoning: 'dry-run: nenhuma chamada à API foi feita.',
      promptPreview: `[SYSTEM]\n${SYSTEM_PROMPT}\n\n[USER]\n${userPrompt}`,
    }
  }

  const provider = getProvider(opts.provider)
  const imageBase64 =
    opts.useVision && fs.existsSync(exploration.screenshotPath)
      ? fs.readFileSync(exploration.screenshotPath).toString('base64')
      : undefined

  try {
    const raw = await provider.discover({ systemPrompt: SYSTEM_PROMPT, userPrompt, imageBase64 })
    const parsed = parseJson(raw.text)

    const login: LoginProfile | undefined = parsed.isLoginScreen
      ? {
          frameUrlPattern: undefined,
          usernameSelectors: compact([parsed.usernameSelector]),
          passwordSelectors: compact([parsed.passwordSelector]),
          submitSelectors: compact([parsed.submitSelector]),
          authenticatedSignals: [],
          confidence: clamp(parsed.confidence),
          source: 'discovered',
          learnedAt: new Date().toISOString(),
        }
      : undefined

    return {
      isLoginScreen: !!parsed.isLoginScreen,
      confidence: clamp(parsed.confidence),
      login,
      reasoning: parsed.reasoning ?? '',
      provider: provider.name,
      usage: raw.usage,
    }
  } catch (err: unknown) {
    const e = err as { message?: string }
    return { isLoginScreen: false, confidence: 0, reasoning: '', provider: provider.name, error: e.message ?? 'erro desconhecido' }
  }
}

function parseJson(text: string): Record<string, any> {
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) return {}
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return {}
  }
}

function compact(arr: Array<string | undefined>): string[] {
  return arr.filter((s): s is string => !!s && s.trim().length > 0)
}

function clamp(n: unknown): number {
  const v = typeof n === 'number' ? n : 0
  return Math.max(0, Math.min(1, v))
}
