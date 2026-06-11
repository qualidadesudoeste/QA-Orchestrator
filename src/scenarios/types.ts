import type { SCENARIO_TYPES, RISK_LEVELS, SEVERITY } from '@config/constants'

export type ScenarioType = (typeof SCENARIO_TYPES)[number]
export type RiskLevel = keyof typeof RISK_LEVELS
export type SeverityLevel = keyof typeof SEVERITY

export interface TestStep {
  order: number
  action: string
  target?: string
  value?: string
  expectedOutcome?: string
}

export interface TestScenario {
  id: string
  type: ScenarioType
  title: string
  description: string
  module: string
  steps: TestStep[]
  expectedResult: string
  testData?: Record<string, unknown>
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  risk: RiskLevel
  automatable: boolean
  tags: string[]
  // populated after execution
  result?: ScenarioResult
}

export interface ScenarioResult {
  passed: boolean
  detail: string
  duration: number
  screenshotPath?: string
  error?: string
}

export interface ScenarioSuite {
  id: string
  module: string
  url: string
  generatedAt: string
  commitHash?: string
  prNumber?: string
  scenarios: TestScenario[]
  stats: {
    total: number
    byType: Record<ScenarioType, number>
    byPriority: Record<string, number>
  }
}
