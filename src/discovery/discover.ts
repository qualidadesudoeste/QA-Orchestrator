/**
 * discover — o comando que junta tudo (Fase B completa).
 *
 * Fluxo: aponta uma URL → Explorer coleta campos → DiscoveryAgent (Claude)
 * entende o login → salva/atualiza o SystemProfile na memória. É o "aprender
 * qualquer sistema" de ponta a ponta.
 *
 * Uso:
 *   ts-node src/discovery/discover.ts <url> [--dry] [--vision] [--headed]
 *
 * --dry    : não chama o Claude; mostra o prompt que seria enviado (custo zero)
 * --vision : anexa o screenshot para o Claude usar visão
 * --headed : abre o navegador visível
 */

import 'dotenv/config'
import { explore } from './explorer'
import { discoverLogin, heuristicLogin } from './discoveryAgent'
import { profileStore, computeFingerprint, type SystemProfile } from './systemProfile'

export interface DiscoverOptions {
  dryRun?: boolean
  useVision?: boolean
  headed?: boolean
}

export async function discoverSystem(url: string, opts: DiscoverOptions = {}) {
  console.log(`\n[1/3] Explorando ${url} ...`)
  const exploration = await explore(url, { headless: !opts.headed })
  console.log(`      ${exploration.inputs.length} inputs, ${exploration.buttons.length} botões, ${exploration.frameCount} frame(s)`)
  if (exploration.blocked) {
    console.log(`      ⚠️  ${exploration.blocked.reason} — interrompendo (a tela não é o app real).`)
    return { exploration, profile: null as SystemProfile | null }
  }

  // Caminho rápido SEM IA: telas de login óbvias são resolvidas na hora,
  // de graça e imunes a outage do provedor. A IA fica para os casos ambíguos.
  const heuristic = opts.dryRun ? null : heuristicLogin(exploration)
  if (heuristic) {
    console.log('[2/3] Login óbvio detectado por heurística (sem IA) ...')
  } else {
    console.log(`[2/3] ${opts.dryRun ? 'Montando prompt (dry-run)' : 'Heurística inconclusiva — pedindo ao modelo de IA'} ...`)
  }
  const outcome = heuristic ?? (await discoverLogin(exploration, { dryRun: opts.dryRun, useVision: opts.useVision }))

  if (outcome.promptPreview) {
    console.log('\n--- PROMPT QUE SERIA ENVIADO ---\n')
    console.log(outcome.promptPreview)
    console.log('\n--- fim do dry-run (nenhum crédito gasto) ---\n')
    return { exploration, profile: null as SystemProfile | null }
  }

  if (outcome.error) {
    console.log(`      ✗ ${outcome.error}`)
    return { exploration, profile: null as SystemProfile | null }
  }

  console.log(`      [provedor: ${outcome.provider}] Login? ${outcome.isLoginScreen ? 'SIM' : 'não'} (confiança ${outcome.confidence}) — ${outcome.reasoning}`)
  if (outcome.usage) console.log(`      tokens: ${outcome.usage.inputTokens}/${outcome.usage.outputTokens}`)

  if (!outcome.isLoginScreen || !outcome.login) {
    return { exploration, profile: null as SystemProfile | null }
  }

  console.log('[3/3] Salvando perfil aprendido na memória ...')
  const base = profileStore.loadOrCreate(url)
  const loginFingerprint = computeFingerprint(
    exploration.inputs.filter(i => i.visible).map(i => `${i.name}:${i.type}`)
  )
  const profile: SystemProfile = {
    ...base,
    kind: 'web-form-login',
    learnedRuns: base.learnedRuns + 1,
    loginFingerprint,
    login: outcome.login,
    notes: base.notes,
  }
  const saved = profileStore.save(profile)
  console.log(`      ✓ Perfil salvo: ${saved.id} (aprendizados=${saved.learnedRuns})\n`)
  return { exploration, profile: saved }
}

if (require.main === module) {
  const url = process.argv[2]
  if (!url) {
    console.error('Uso: ts-node src/discovery/discover.ts <url> [--dry] [--vision] [--headed]')
    process.exit(1)
  }
  discoverSystem(url, {
    dryRun: process.argv.includes('--dry'),
    useVision: process.argv.includes('--vision'),
    headed: process.argv.includes('--headed'),
  }).catch(err => {
    console.error('Falha no discover:', err.message)
    process.exit(1)
  })
}
