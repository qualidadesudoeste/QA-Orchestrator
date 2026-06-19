/**
 * CLI simples para inspecionar a memória de perfis aprendidos.
 *
 * Uso:
 *   ts-node src/discovery/profileCli.ts list
 *   ts-node src/discovery/profileCli.ts show <id>
 *   ts-node src/discovery/profileCli.ts seed     (lê SEED_* do .env)
 *
 * 100% offline — não depende de banco ou servidor.
 */

import { profileStore } from './systemProfile'
import { seedProfileFromEnv } from './seedSigp'

function list(): void {
  const profiles = profileStore.list()
  if (profiles.length === 0) {
    console.log('Nenhum perfil aprendido ainda. Rode: npm run profile:seed (ou npm run discover)')
    return
  }
  console.log(`\n${profiles.length} sistema(s) na memória do agente:\n`)
  for (const p of profiles) {
    const login = p.login ? `login ✓ (confiança ${p.login.confidence})` : 'login ✗'
    console.log(`  • ${p.name}`)
    console.log(`    id: ${p.id} | tipo: ${p.kind} | ${login} | módulos: ${p.modules.length} | aprendizados: ${p.learnedRuns}`)
    console.log(`    url: ${p.baseUrl}`)
    console.log(`    atualizado: ${p.updatedAt}\n`)
  }
}

function show(id?: string): void {
  if (!id) {
    console.error('Informe o id. Ex.: npm run profile:show -- meu-sistema-exemplo')
    process.exit(1)
  }
  const profile = profileStore.load(id)
  if (!profile) {
    console.error(`Perfil "${id}" não encontrado. Rode "list" para ver os disponíveis.`)
    process.exit(1)
  }
  console.log(JSON.stringify(profile, null, 2))
}

const [command, arg] = process.argv.slice(2)

switch (command) {
  case 'list':
    list()
    break
  case 'show':
    show(arg)
    break
  case 'seed': {
    const saved = seedProfileFromEnv()
    console.log(`Perfil salvo na memória: ${saved.id} (aprendizados=${saved.learnedRuns})`)
    break
  }
  default:
    console.log('Comandos: list | show <id> | seed')
}
