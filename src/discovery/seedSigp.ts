/**
 * Seed de perfil a partir de variáveis de ambiente.
 *
 * Materializa um SystemProfile "manual" (confiança 1) a partir de config
 * EXTERNA (`.env`, gitignored) — nada de hostname/seletor de cliente fixo no
 * código. É a prova da virada: o que era hardcode vira dado de memória local,
 * reutilizável e editável sem tocar no código. Para descobrir um sistema novo
 * automaticamente, prefira `npm run discover`.
 *
 * Variáveis usadas (todas no `.env`, que é gitignored):
 *   SEED_URL              URL de entrada do sistema (obrigatória)
 *   SEED_NAME             rótulo amigável do perfil (opcional)
 *   SEED_FRAME_PATTERN    trecho da URL do iframe de login (opcional)
 *   SEED_USER_SELECTORS   seletores de usuário, separados por vírgula (opcional)
 *   SEED_PASS_SELECTORS   seletores de senha, separados por vírgula (opcional)
 *   SEED_SUBMIT_SELECTORS seletores de submit, separados por vírgula (opcional)
 */

import 'dotenv/config'
import { profileStore, type SystemProfile } from './systemProfile'

const csv = (v: string | undefined, fallback: string[]): string[] => {
  const list = (v || '').split(',').map(s => s.trim()).filter(Boolean)
  return list.length ? list : fallback
}

export function seedProfileFromEnv(): SystemProfile {
  const url = process.env.SEED_URL
  if (!url) throw new Error('SEED_URL ausente no .env — defina a URL do sistema (ou use `npm run discover`).')

  const base = profileStore.loadOrCreate(url, process.env.SEED_NAME || 'Perfil (seed via .env)')
  const now = new Date().toISOString()

  const profile: SystemProfile = {
    ...base,
    kind: 'web-form-login',
    learnedRuns: base.learnedRuns + 1,
    login: {
      frameUrlPattern: process.env.SEED_FRAME_PATTERN || 'openform.do',
      usernameSelectors: csv(process.env.SEED_USER_SELECTORS, [
        'input[id*="user" i]', 'input[id*="login" i]', 'input[name*="user" i]', 'input[name*="login" i]',
      ]),
      passwordSelectors: csv(process.env.SEED_PASS_SELECTORS, [
        'input[type="password"]', 'input[name*="senha" i]', 'input[name*="pass" i]',
      ]),
      submitSelectors: csv(process.env.SEED_SUBMIT_SELECTORS, [
        'button:has-text("Entrar")', 'button[type="submit"]', 'input[type="submit"]',
      ]),
      authenticatedSignals: ['[class*="menu" i]', '[role="navigation"]', 'nav'],
      confidence: 1,
      source: 'manual',
      learnedAt: now,
    },
    notes: [
      'Perfil semeado a partir do .env (config local, não versionada).',
      'Para sistemas atrás de proxy/Cloudflare, a origem pode retornar 5xx quando cai.',
    ],
  }

  return profileStore.save(profile)
}

// Permite rodar direto: `ts-node src/discovery/seedSigp.ts`
if (require.main === module) {
  const saved = seedProfileFromEnv()
  console.log(`Perfil salvo: ${saved.id} (learnedRuns=${saved.learnedRuns})`)
}
