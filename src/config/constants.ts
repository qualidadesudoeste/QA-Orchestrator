export const RISK_LEVELS = {
  LOW: 'BAIXO',
  MEDIUM: 'MÉDIO',
  HIGH: 'ALTO',
  CRITICAL: 'CRÍTICO',
} as const

export const BUG_CATEGORIES = {
  FUNCTIONAL: 'BUG_FUNCIONAL',
  VISUAL: 'BUG_VISUAL',
  API: 'BUG_API',
  DATA: 'BUG_DADOS',
  SECURITY: 'BUG_SEGURANCA',
  PERFORMANCE: 'BUG_PERFORMANCE',
  USABILITY: 'BUG_USABILIDADE',
  INTEGRATION: 'BUG_INTEGRACAO',
} as const

export const SEVERITY = {
  CRITICAL: 'CRÍTICA',
  HIGH: 'ALTA',
  MEDIUM: 'MÉDIA',
  LOW: 'BAIXA',
} as const

export const SCENARIO_TYPES = [
  'POSITIVO',
  'NEGATIVO',
  'BORDA',
  'EXPLORATORIO',
  'REGRESSAO',
  'INTEGRACAO',
  'API',
  'SEGURANCA',
  'USABILIDADE',
  'PERMISSAO',
] as const

// Patterns used for sensitive data masking (LGPD)
export const SENSITIVE_PATTERNS = {
  CPF: /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g,
  CNPJ: /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g,
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  PHONE: /(\+?55\s?)?(\(?\d{2}\)?\s?)(\d{4,5}-?\d{4})/g,
  TOKEN: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  PASSWORD_FIELD: /"(password|senha|secret|token|key|api_key)":\s*"[^"]+"/gi,
}

export const PRODUCTION_RESTRICTIONS = [
  'Não criar registros de massa de teste',
  'Não excluir registros existentes',
  'Não alterar configurações do sistema',
  'Não executar testes destrutivos',
  'Apenas leitura e validação passiva',
]

// Cost-first model strategy: default to Sonnet, Haiku for trivial tasks.
// Opus is disabled by default — only enable manually for critical security analysis.
export const CLAUDE_MODELS = {
  DEFAULT: 'claude-sonnet-4-6',   // analysis, scenario gen, most tasks
  LIGHT: 'claude-haiku-4-5-20251001', // data generation, simple checks, formatting
  // OPUS: 'claude-opus-4-8',     // disabled — high cost, use only when explicitly needed
} as const
