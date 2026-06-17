/**
 * auto — pipeline completo: do ZERO (aprender o sistema) até o CRUD.
 *
 * Encadeia os comandos do próprio agente, sem nada manual:
 *   1. discover  → aprende o login (heurística sem IA; IA só p/ ambíguos) e salva o perfil
 *   2. navigate  → loga e mapeia o menu (salva os módulos no perfil)
 *   3. crud      → roda a operação pedida na tela (full = ciclo CRUD inteiro)
 *
 * Cada etapa persiste o que aprende em disco, então o agente fica mais
 * inteligente sobre o sistema a cada rodada. Genérico — vale p/ qualquer Maker
 * ou web comum; onde não casar, melhora-se em makerSession.ts (sem remendo).
 *
 * Uso:
 *   ts-node src/discovery/auto.ts <url> "<Tela>" [--op full|create|search|edit|delete] [--headed] [--token "x"]
 */

import 'dotenv/config'
import { discoverSystem } from './discover'
import { loginAndNavigate } from './navigator'
import { registerRecord } from './register'
import { runCrud, runFull } from './crud'

type Op = 'full' | 'create' | 'search' | 'edit' | 'delete'

export async function runPipeline(
  url: string,
  screenName: string,
  opts: { op?: Op; headed?: boolean; token?: string } = {}
): Promise<void> {
  const op = opts.op ?? 'full'
  console.log(`\n############ PIPELINE COMPLETO — do zero até o CRUD ############`)
  console.log(`Sistema: ${url}`)
  console.log(`Tela: ${screenName} | Operação: ${op}\n`)

  console.log(`========== ETAPA 1/3 — APRENDER O SISTEMA (discover) ==========`)
  const learned = await discoverSystem(url, { headed: opts.headed })
  if (!learned.profile) {
    console.log('⚠️  Não consegui aprender o login automaticamente. Verifique a URL/credenciais ou rode `explore` para diagnosticar. Abortando.')
    return
  }

  console.log(`\n========== ETAPA 2/3 — LOGAR E MAPEAR O MENU (navigate) ==========`)
  const nav = await loginAndNavigate(url, [], { headed: opts.headed })
  if (!nav.loggedIn) {
    console.log('⚠️  Login não confirmou na navegação. Abortando antes do CRUD.')
    return
  }

  console.log(`\n========== ETAPA 3/3 — CRUD (${op}) ==========`)
  if (op === 'full') await runFull(url, screenName, { headed: opts.headed })
  else if (op === 'create') await registerRecord(url, screenName, { headed: opts.headed, value: opts.token })
  else await runCrud(op, url, screenName, { headed: opts.headed, token: opts.token })

  console.log(`\n############ PIPELINE CONCLUÍDO ############`)
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const headed = args.includes('--headed')
  const opIdx = args.indexOf('--op')
  const op = (opIdx >= 0 ? args[opIdx + 1] : 'full') as Op
  const tIdx = args.indexOf('--token')
  const token = tIdx >= 0 ? args[tIdx + 1] : undefined
  const skip = new Set<number>()
  if (opIdx >= 0) skip.add(opIdx + 1)
  if (tIdx >= 0) skip.add(tIdx + 1)
  const pos = args.filter((a, i) => !a.startsWith('--') && !skip.has(i))
  const url = pos[0]
  const screenName = pos.slice(1).join(' ')
  if (!url || !screenName) {
    console.error('Uso: ts-node src/discovery/auto.ts <url> "<Tela>" [--op full|create|search|edit|delete] [--headed] [--token "x"]')
    process.exit(1)
  }
  runPipeline(url, screenName, { op, headed, token })
    .catch(err => { console.error('Falha no pipeline:', err.message); process.exit(1) })
}
