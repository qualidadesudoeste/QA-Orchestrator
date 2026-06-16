import { z } from 'zod'
import 'dotenv/config'

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'homologacao', 'production']).default('homologacao'),
  BASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  QDRANT_URL: z.string().default('http://localhost:6333'),
  QDRANT_COLLECTION: z.string().default('qa_knowledge'),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_OWNER: z.string().optional(),
  GITHUB_REPO: z.string().optional(),
  SECRETS_BACKEND: z.enum(['vault', 'aws', 'azure']).default('vault'),
  VAULT_ADDR: z.string().optional(),
  VAULT_TOKEN: z.string().optional(),
  ZAP_API_URL: z.string().default('http://localhost:8090'),
  ZAP_API_KEY: z.string().optional(),
  EVIDENCE_DIR: z.string().default('artifacts/evidence'),
  REPORTS_DIR: z.string().default('artifacts/reports'),
  TEST_DATA_LOCALE: z.string().default('pt_BR'),
})

export const env = envSchema.parse(process.env)

export const isProduction = env.APP_ENV === 'production'
export const isDevelopment = env.APP_ENV === 'development'
export const isHomologacao = env.APP_ENV === 'homologacao'

export type Environment = typeof env
