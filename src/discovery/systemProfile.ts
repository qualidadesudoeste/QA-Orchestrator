/**
 * SystemProfile — a memória do que o agente APRENDEU sobre um sistema-alvo.
 *
 * Esta é a peça central da virada "testar qualquer sistema": em vez de seletores
 * fixos no código, o conhecimento de cada sistema
 * vive aqui, como dado persistido em disco. O agente descobre uma vez, guarda o
 * perfil e reusa nas próximas execuções — reaprendendo só quando a tela muda.
 *
 * Fase A (este arquivo): modelo + persistência local em JSON, 100% offline.
 * NÃO importa @config/environments nem @utils/logger de propósito: assim roda
 * sem ANTHROPIC_API_KEY, sem banco e sem servidor no ar.
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

/** Como o agente entra no sistema (descoberto ou informado manualmente). */
export interface LoginProfile {
  /** Trecho da URL do frame onde o formulário de login vive (SIGP usa iframe). */
  frameUrlPattern?: string
  /** Seletores candidatos do campo usuário, em ordem de preferência. */
  usernameSelectors: string[]
  /** Seletores candidatos do campo senha. */
  passwordSelectors: string[]
  /** Seletores candidatos do botão/ação de submit. */
  submitSelectors: string[]
  /** Sinais (seletores ou textos) que confirmam que o login deu certo. */
  authenticatedSignals: string[]
  /** Confiança da descoberta: 0..1. 1 = confirmado manualmente. */
  confidence: number
  /** Origem do conhecimento. */
  source: 'manual' | 'discovered'
  learnedAt: string
}

/** Um módulo/área navegável descoberto após o login. */
export interface ModuleProfile {
  name: string
  url?: string
  navSelectors: string[]
  discoveredAt: string
}

/** Tipo de sistema que o agente consegue tratar hoje. */
export type SystemKind = 'web-form-login' | 'unknown'

/** Tudo o que o agente sabe sobre um sistema-alvo. */
export interface SystemProfile {
  /** Identificador estável derivado da URL (slug do host). */
  id: string
  /** Código curto do sistema para as pastas (SIGP, CLE, SGOS...). */
  code?: string
  name: string
  baseUrl: string
  kind: SystemKind
  createdAt: string
  updatedAt: string
  /** Quantas vezes o agente já aprendeu/atualizou este perfil. */
  learnedRuns: number
  /** Assinatura estrutural da tela de login — detecta mudança de UI (Fase E). */
  loginFingerprint?: string
  login?: LoginProfile
  modules: ModuleProfile[]
  notes: string[]
}

const DEFAULT_DIR = path.join(process.cwd(), 'data', 'profiles')

/** Slug estável a partir da URL: usado como id e nome de arquivo. */
export function idFromUrl(rawUrl: string): string {
  let host = rawUrl
  try {
    host = new URL(rawUrl).host
  } catch {
    // Se não for URL válida, usa a string crua normalizada.
  }
  return host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sistema-desconhecido'
}

/**
 * Assinatura estrutural de uma tela (lista de pistas: nomes de campos, contagens...).
 * Mesma estrutura → mesmo hash. Mudou a tela → muda o hash. Base da Fase E.
 */
export function computeFingerprint(parts: string[]): string {
  const normalized = parts
    .map(p => p.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|')
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

/** Persistência de perfis em disco (um JSON por sistema). */
export class SystemProfileStore {
  constructor(private readonly dir: string = process.env.PROFILE_DIR || DEFAULT_DIR) {
    fs.mkdirSync(this.dir, { recursive: true })
  }

  private fileFor(id: string): string {
    return path.join(this.dir, `${id}.json`)
  }

  exists(id: string): boolean {
    return fs.existsSync(this.fileFor(id))
  }

  load(id: string): SystemProfile | null {
    const file = this.fileFor(id)
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as SystemProfile
  }

  loadByUrl(url: string): SystemProfile | null {
    return this.load(idFromUrl(url))
  }

  list(): SystemProfile[] {
    if (!fs.existsSync(this.dir)) return []
    return fs
      .readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8')) as SystemProfile)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  save(profile: SystemProfile): SystemProfile {
    const next: SystemProfile = { ...profile, updatedAt: new Date().toISOString() }
    fs.writeFileSync(this.fileFor(next.id), JSON.stringify(next, null, 2), 'utf-8')
    return next
  }

  /** Carrega o perfil da URL ou cria um esqueleto vazio (sem salvar ainda). */
  loadOrCreate(url: string, name?: string): SystemProfile {
    const existing = this.loadByUrl(url)
    if (existing) return existing
    const now = new Date().toISOString()
    return {
      id: idFromUrl(url),
      name: name || idFromUrl(url),
      baseUrl: url,
      kind: 'unknown',
      createdAt: now,
      updatedAt: now,
      learnedRuns: 0,
      modules: [],
      notes: [],
    }
  }

  /**
   * Compara a assinatura atual da tela de login com a guardada.
   * Retorna se mudou — o agente decide se precisa reaprender (Fase E).
   */
  loginChanged(profile: SystemProfile, currentFingerprint: string): boolean {
    return profile.loginFingerprint !== undefined && profile.loginFingerprint !== currentFingerprint
  }
}

/** Instância padrão pronta para uso. */
export const profileStore = new SystemProfileStore()
