import { PrismaClient } from '@prisma/client'
import { logger } from '@utils/logger'
import { BUG_CATEGORIES, RISK_LEVELS, SEVERITY } from '@config/constants'

const prisma = new PrismaClient()

export interface BugRecord {
  id?: string
  title: string
  category: keyof typeof BUG_CATEGORIES
  module: string
  path: string
  description: string
  actualResult: string
  expectedResult: string
  steps: string[]
  severity: keyof typeof SEVERITY
  priority: string
  risk: keyof typeof RISK_LEVELS
  evidencePaths: string[]
  possibleCause?: string
  commitHash?: string
  prNumber?: string
  version?: string
}

export interface KnowledgeEntry {
  module: string
  flowType: 'CRITICAL' | 'STABLE' | 'PROBLEMATIC'
  description: string
  businessRules: string[]
  knownIssues: string[]
}

export class KnowledgeBase {
  async saveBug(bug: BugRecord): Promise<string> {
    try {
      const existing = await prisma.bugReport.findFirst({
        where: { title: bug.title, module: bug.module },
        orderBy: { createdAt: 'desc' },
      })

      const isRecurrence = !!existing

      const record = await prisma.bugReport.create({
        data: {
          ...bug,
          steps: JSON.stringify(bug.steps),
          evidencePaths: JSON.stringify(bug.evidencePaths),
          isRecurrence,
          previousOccurrenceId: existing?.id,
        },
      })

      if (isRecurrence) {
        logger.warn(`[REINCIDÊNCIA] Bug "${bug.title}" já foi reportado anteriormente (ID: ${existing?.id})`)
      }

      logger.info(`Bug salvo na base de conhecimento: ${record.id}`)
      return record.id
    } catch (err) {
      logger.error('Erro ao salvar bug na base de conhecimento', err)
      throw err
    }
  }

  async findRecurringBugs(module: string): Promise<BugRecord[]> {
    const records = await prisma.bugReport.findMany({
      where: { module, isRecurrence: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return records.map(this.deserializeBug)
  }

  async getCriticalFlows(): Promise<KnowledgeEntry[]> {
    const records = await prisma.knowledgeEntry.findMany({
      where: { flowType: 'CRITICAL' },
    })
    return records.map(this.deserializeKnowledge)
  }

  async saveKnowledge(entry: KnowledgeEntry): Promise<void> {
    const data = this.serializeKnowledge(entry)
    await prisma.knowledgeEntry.upsert({
      where: { module: entry.module },
      update: data,
      create: data,
    })
  }

  async getBugHistory(module?: string): Promise<BugRecord[]> {
    const records = await prisma.bugReport.findMany({
      where: module ? { module } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return records.map(this.deserializeBug)
  }

  private deserializeBug(record: any): BugRecord {
    return {
      ...record,
      steps: JSON.parse(record.steps || '[]'),
      evidencePaths: JSON.parse(record.evidencePaths || '[]'),
    }
  }

  private serializeKnowledge(entry: KnowledgeEntry) {
    return {
      ...entry,
      businessRules: JSON.stringify(entry.businessRules),
      knownIssues: JSON.stringify(entry.knownIssues),
    }
  }

  private deserializeKnowledge(record: any): KnowledgeEntry {
    return {
      module: record.module,
      flowType: record.flowType,
      description: record.description,
      businessRules: JSON.parse(record.businessRules || '[]'),
      knownIssues: JSON.parse(record.knownIssues || '[]'),
    }
  }
}

export const knowledgeBase = new KnowledgeBase()
