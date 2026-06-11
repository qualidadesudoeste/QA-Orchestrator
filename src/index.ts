import { QAOrchestrator } from '@agents/orchestrator'
import { logger } from '@utils/logger'

async function main() {
  const orchestrator = new QAOrchestrator()

  await orchestrator.run({
    target: process.env.BASE_URL ?? 'http://localhost:3000',
    commitHash: process.env.COMMIT_HASH,
    prNumber: process.env.PR_NUMBER,
    scope: (process.env.TEST_SCOPE as any) ?? 'full',
  })
}

main().catch(err => {
  logger.error('Erro crítico no QA Orchestrator', err)
  process.exit(1)
})
