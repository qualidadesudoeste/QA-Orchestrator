/**
 * Seed do perfil SIGP.
 *
 * Pega o conhecimento que hoje está ESPALHADO e FIXO no código de teste
 * (seletores [REDACTED_SEL]/535, textos de menu, padrão do iframe) e o
 * materializa como um SystemProfile aprendido. É a prova viva da virada:
 * o que era hardcode vira dado de memória, reutilizável e editável sem
 * tocar no código.
 *
 * Confiança = 1 (manual): foi confirmado por execução real em 2026-06-15.
 */

import { profileStore, type SystemProfile } from './systemProfile'

const SIGP_URL = 'https://sigp.[REDACTED_HOST]/SIGP/open.do?sys=ARH'

export function seedSigpProfile(): SystemProfile {
  const base = profileStore.loadOrCreate(SIGP_URL, 'SIGP — TechPulse (ARH)')
  const now = new Date().toISOString()

  const profile: SystemProfile = {
    ...base,
    kind: 'web-form-login',
    learnedRuns: base.learnedRuns + 1,
    login: {
      frameUrlPattern: 'openform.do',
      usernameSelectors: [
        'input[name="[REDACTED_SEL]"]',
        'input#[REDACTED_SEL]',
        'input[id*="user" i]',
        'input[id*="login" i]',
      ],
      passwordSelectors: [
        'input[name="[REDACTED_SEL]"]',
        'input#[REDACTED_SEL]',
        'input[type="password"]',
      ],
      submitSelectors: [
        'button:has-text("Entrar")',
        'button[type="submit"]',
        'input[type="submit"]',
      ],
      authenticatedSignals: [
        'text=Cadastros',
        'text=Relatórios Gerenciais',
        'text=Recrutamento',
        'text=Utilitários',
        '[class*="menu" i]',
      ],
      confidence: 1,
      source: 'manual',
      learnedAt: now,
    },
    notes: [
      'Sistema atrás de Cloudflare — pode retornar 522 quando a origem cai.',
      'Formulário de login vive em iframe (openform.do, [REDACTED]).',
      'Conhecimento migrado do hardcode de tests/sigp para perfil em 2026-06-15.',
    ],
  }

  return profileStore.save(profile)
}

// Permite rodar direto: `ts-node src/discovery/seedSigp.ts`
if (require.main === module) {
  const saved = seedSigpProfile()
  console.log(`Perfil SIGP salvo: ${saved.id} (learnedRuns=${saved.learnedRuns})`)
}
