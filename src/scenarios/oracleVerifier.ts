/**
 * oracleVerifier — liga o ORÁCULO (business_rules.json, extraído do Maker) à
 * EXECUÇÃO REAL: depois que a UI executou a regra, confere na tabela se o
 * "deveria ser" aconteceu de verdade.
 *
 * Por que existe: até aqui o agente sabia o que a regra DEVE fazer (oráculo
 * determinístico) mas não conferia o EFEITO. Este módulo transforma cada
 * `SqlOperation` do oráculo num PLANO DE VERIFICAÇÃO e confere contra o banco
 * via os adaptadores em src/tools/database/ (Postgres/MySQL/Oracle/Mongo).
 *
 * Dois modos:
 *   - dry (padrão): NÃO conecta. Mostra o plano e o SQL/where exato que SERIA
 *     conferido. Custo zero, seguro, roda sem credencial de banco.
 *   - live (--live): conecta usando DATABASE_URL/DB_TYPE e emite veredito
 *     PASSOU/FALHOU por afirmação do oráculo.
 *
 * Governança: produção é só leitura — este módulo NUNCA escreve no banco, só
 * faz COUNT/SELECT de verificação.
 *
 * Uso:
 *   ts-node src/scenarios/oracleVerifier.ts <CODE> <ruleCode> -p pOS_COD=123 -p pMotivo="Teste" [--live]
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { knowledgeDir, evidencesDir, today } from '../knowledge/layout'
import type { BusinessRule, FieldValue, SqlOperation } from '../knowledge/makerRules'

// ── Modelo do plano de verificação ──────────────────────────────────────────

export type CheckKind = 'update' | 'insert' | 'delete' | 'select-precondition' | 'manual'

export interface CheckPlan {
  ruleCode: string
  ruleName: string
  kind: CheckKind
  table: string
  /** Afirmação humana do oráculo que este check valida. */
  oracle: string
  /** Igualdades resolvidas (campos SET + WHERE soEqual) p/ validateRecord. */
  where: Record<string, unknown>
  /** Só os campos SET (o EFEITO que deve aparecer) — usado na verificação por UI. */
  setFields: Record<string, unknown>
  /** Só as restrições WHERE soEqual (o LOCALIZADOR do registro) — usado na UI. */
  matchFields: Record<string, unknown>
  /** Para record-checks: o registro DEVE existir (true) ou NÃO existir (false). */
  expectRecord?: boolean
  /** Para SELECT de pré-condição: SQL cru + binds resolvidos. */
  rawSql?: string
  rawBinds?: Record<string, unknown>
  /** SELECT deve retornar linha (true) — vazio significa bloquear. */
  expectRows?: boolean
  /** Variáveis que não conseguimos resolver com os parâmetros informados. */
  unresolved: string[]
  /** Restrições não-igualdade que validateRecord não cobre (revisar manual). */
  nonEquality: string[]
}

export type Verdict = 'PASSOU' | 'FALHOU' | 'PULADO'

export interface CheckResult extends CheckPlan {
  verdict: Verdict
  detail: string
}

// ── Resolução de parâmetros ─────────────────────────────────────────────────

/** Converte "Inteiro" → number; o resto fica string. */
function coerce(type: string | undefined, raw: string): unknown {
  if (type && /inteiro|number|numero|num/i.test(type)) {
    const n = Number(raw)
    return Number.isNaN(n) ? raw : n
  }
  return raw
}

/** Resolve um FieldValue para um valor concreto usando os params informados. */
function resolve(
  v: FieldValue,
  values: Record<string, unknown>,
  paramTypes: Record<string, string>,
  unresolved: string[]
): { ok: true; value: unknown } | { ok: false } {
  if (v.kind === 'constant') return { ok: true, value: coerce(v.type, v.value) }
  if (v.kind === 'variable') {
    if (v.name in values) return { ok: true, value: values[v.name] }
    unresolved.push(v.name)
    return { ok: false }
  }
  unresolved.push(v.raw)
  return { ok: false }
}

const COMPARE_SQL: Record<string, string> = {
  soEqual: '=', soDifferent: '<>', soGreater: '>', soLess: '<',
  soGreaterEqual: '>=', soLessEqual: '<=', soLike: 'LIKE',
}

// ── Construção do plano a partir de uma SqlOperation ─────────────────────────

function planFromSql(
  rule: BusinessRule,
  s: SqlOperation,
  oracleLine: string,
  values: Record<string, unknown>,
  paramTypes: Record<string, string>
): CheckPlan {
  const unresolved: string[] = []
  const nonEquality: string[] = []
  const where: Record<string, unknown> = {}

  // SELECT de pré-condição (SQL cru): roda a consulta e checa se retorna linha.
  if (s.op === 'SELECT' && s.rawCommand) {
    const rawBinds: Record<string, unknown> = {}
    // binds nomeados :NOME presentes no SQL — tenta casar com os params (case-insensitive)
    const names = Array.from(new Set((s.rawCommand.match(/:([A-Za-z_][A-Za-z0-9_]*)/g) || []).map(x => x.slice(1))))
    for (const n of names) {
      const hit = Object.keys(values).find(k => k.toLowerCase() === n.toLowerCase())
      if (hit) rawBinds[n] = values[hit]
      else unresolved.push(n)
    }
    return {
      ruleCode: rule.code, ruleName: rule.name, kind: 'select-precondition',
      table: s.table, oracle: oracleLine, where: {}, setFields: {}, matchFields: {},
      rawSql: s.rawCommand, rawBinds, expectRows: true, unresolved, nonEquality,
    }
  }

  // UPDATE/INSERT/DELETE: separa EFEITO (campos SET) de LOCALIZADOR (WHERE soEqual).
  const setFields: Record<string, unknown> = {}
  const matchFields: Record<string, unknown> = {}

  if (s.op === 'UPDATE' || s.op === 'INSERT') {
    for (const f of s.fields) {
      const r = resolve(f.value, values, paramTypes, unresolved)
      if (r.ok) { setFields[f.name] = r.value; where[f.name] = r.value }
    }
  }
  for (const r of s.restrictions) {
    if (r.compare === 'soEqual') {
      const v = resolve(r.against, values, paramTypes, unresolved)
      if (v.ok) { matchFields[r.field] = v.value; where[r.field] = v.value }
    } else {
      nonEquality.push(`${r.field} ${COMPARE_SQL[r.compare] || r.compare} (?)`)
    }
  }

  const kind: CheckKind = s.op === 'UPDATE' ? 'update' : s.op === 'INSERT' ? 'insert' : s.op === 'DELETE' ? 'delete' : 'manual'
  // DELETE: o registro NÃO deve mais existir; os demais: DEVE existir.
  const expectRecord = kind !== 'delete'

  return {
    ruleCode: rule.code, ruleName: rule.name, kind, table: s.table,
    oracle: oracleLine, where, setFields, matchFields, expectRecord, unresolved, nonEquality,
  }
}

/** Monta os planos de verificação de UMA regra (1 por função SQL com efeito). */
export function planRule(rule: BusinessRule, values: Record<string, unknown>): CheckPlan[] {
  const paramTypes: Record<string, string> = {}
  for (const p of [...rule.params, ...rule.variables, ...rule.outParams]) paramTypes[p.name] = p.type

  const plans: CheckPlan[] = []
  let oracleIdx = 0
  for (const fn of rule.functions) {
    const oracleLine = rule.oracle[oracleIdx] || `${fn.realName || fn.name}`
    oracleIdx++
    if (!fn.sql) continue // funções não-SQL (refresh, close) não geram efeito verificável
    plans.push(planFromSql(rule, fn.sql, oracleLine, values, paramTypes))
  }
  return plans
}

// ── Carregamento do oráculo ─────────────────────────────────────────────────

export interface RulesFile {
  code: string
  source: string
  generatedAt: string
  rules: BusinessRule[]
}

export function loadRules(code: string): RulesFile {
  const p = path.join(knowledgeDir(code), 'business_rules.json')
  if (!fs.existsSync(p)) {
    throw new Error(`Oráculo não encontrado: ${p}\nRode antes: npm run rules -- <export.xml> --code ${code}`)
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as RulesFile
}

// ── Verificação contra o banco (live) ───────────────────────────────────────

/** Converte binds nomeados (:NOME) p/ o placeholder do dialeto e ordena os valores. */
function bindForDialect(sql: string, binds: Record<string, unknown>, dbType: string): { sql: string; params: unknown[] | Record<string, unknown> } {
  if (dbType === 'oracle') return { sql, params: binds } // oracle aceita binds nomeados
  const params: unknown[] = []
  let i = 0
  const out = sql.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name: string) => {
    const hit = Object.keys(binds).find(k => k.toLowerCase() === name.toLowerCase())
    params.push(hit ? binds[hit] : null)
    i++
    return dbType === 'postgres' ? `$${i}` : '?'
  })
  return { sql: out, params }
}

async function verifyLive(plans: CheckPlan[]): Promise<CheckResult[]> {
  // import tardio: só carrega o driver de banco quando realmente vamos conectar
  const { DbAnalyzer } = await import('../tools/database/dbAnalyzer')
  const dbType = (process.env.DB_TYPE as string) || 'postgres'
  const db = new DbAnalyzer(dbType as any)
  await db.connect()
  const results: CheckResult[] = []
  try {
    for (const plan of plans) {
      if (plan.unresolved.length) {
        results.push({ ...plan, verdict: 'PULADO', detail: `parâmetros não resolvidos: ${plan.unresolved.join(', ')}` })
        continue
      }
      if (plan.kind === 'select-precondition' && plan.rawSql) {
        const { sql, params } = bindForDialect(plan.rawSql, plan.rawBinds || {}, dbType)
        const rows = await db.query(sql, params as unknown[])
        const has = rows.length > 0
        const ok = has === !!plan.expectRows
        results.push({ ...plan, verdict: ok ? 'PASSOU' : 'FALHOU', detail: `consulta retornou ${rows.length} linha(s) (esperado: ${plan.expectRows ? '≥1' : '0'})` })
        continue
      }
      if (plan.kind === 'manual' || !Object.keys(plan.where).length) {
        results.push({ ...plan, verdict: 'PULADO', detail: 'sem efeito verificável automaticamente (revisar manual)' })
        continue
      }
      const found = await db.validateRecord(plan.table, plan.where)
      const ok = found === !!plan.expectRecord
      results.push({ ...plan, verdict: ok ? 'PASSOU' : 'FALHOU', detail: `registro ${found ? 'encontrado' : 'NÃO encontrado'} (esperado: ${plan.expectRecord ? 'existir' : 'não existir'})` })
    }
  } finally {
    await db.disconnect()
  }
  return results
}

// ── Saída / evidência ───────────────────────────────────────────────────────

function whereStr(where: Record<string, unknown>): string {
  return Object.entries(where).map(([k, v]) => `${k}=${typeof v === 'string' ? `'${v}'` : v}`).join(' AND ') || '(vazio)'
}

function planLine(p: CheckPlan): string {
  if (p.kind === 'select-precondition') {
    const binds = Object.entries(p.rawBinds || {}).map(([k, v]) => `${k}=${typeof v === 'string' ? `'${v}'` : v}`).join(', ')
    return `[${p.kind}] em \`${p.table}\` deve retornar registro — binds: ${binds || '(nenhum)'}`
  }
  const expect = p.expectRecord ? 'DEVE existir' : 'NÃO deve existir'
  return `[${p.kind}] registro em \`${p.table}\` ${expect} ONDE ${whereStr(p.where)}`
}

export function renderReport(code: string, ruleCode: string, results: CheckResult[], live: boolean): string {
  const L: string[] = []
  L.push(`# Verificação de oráculo — ${code} / regra [${ruleCode}]`, '')
  L.push(`> ${live ? 'LIVE (conferido no banco)' : 'DRY (plano — banco não consultado)'} — ${new Date().toISOString()}`, '')
  for (const r of results) {
    L.push(`## ${live ? r.verdict + ' — ' : ''}${r.oracle}`)
    L.push(`- Plano: ${planLine(r)}`)
    if (r.unresolved.length) L.push(`- ⚠️ Não resolvido: ${r.unresolved.join(', ')}`)
    if (r.nonEquality.length) L.push(`- ⚠️ Restrição não-igualdade (revisar manual): ${r.nonEquality.join('; ')}`)
    if (live) L.push(`- Resultado: **${r.verdict}** — ${r.detail}`)
    L.push('')
  }
  return L.join('\n')
}

/** Localiza a regra no oráculo do sistema (lança se não existir). */
export function findRule(code: string, ruleCode: string): BusinessRule {
  const file = loadRules(code)
  const rule = file.rules.find(r => r.code === ruleCode)
  if (!rule) throw new Error(`Regra [${ruleCode}] não está no oráculo de ${code}. Disponíveis: ${file.rules.map(r => r.code).join(', ')}`)
  return rule
}

function writeEvidence(code: string, ruleCode: string, payload: object, md: string): { mdPath: string; jsonPath: string } {
  const dir = evidencesDir(code, 'scenarios')
  const stamp = `${today()}_${Date.now().toString().slice(-6)}`
  const base = `verify_${ruleCode}_${stamp}`
  const mdPath = path.join(dir, `${base}.md`)
  const jsonPath = path.join(dir, `${base}.json`)
  fs.writeFileSync(mdPath, md, 'utf-8')
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf-8')
  return { mdPath, jsonPath }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const values: Record<string, unknown> = {}
  const positional: string[] = []
  let live = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--live') live = true
    else if (a === '-p' || a === '--param') {
      const kv = argv[++i] || ''
      const eq = kv.indexOf('=')
      if (eq > 0) values[kv.slice(0, eq).trim()] = kv.slice(eq + 1)
    } else if (!a.startsWith('--')) positional.push(a)
  }
  return { code: positional[0], ruleCode: positional[1], values, live }
}

async function main() {
  const { code, ruleCode, values, live } = parseArgs(process.argv.slice(2))
  if (!code || !ruleCode) {
    console.error('Uso: ts-node src/scenarios/oracleVerifier.ts <CODE> <ruleCode> [-p nome=valor ...] [--live]')
    process.exit(1)
  }

  const rule = findRule(code, ruleCode)

  // coerção de tipos dos params informados conforme o oráculo (Inteiro → number)
  const paramTypes: Record<string, string> = {}
  for (const p of [...rule.params, ...rule.variables]) paramTypes[p.name] = p.type
  for (const k of Object.keys(values)) {
    if (paramTypes[k]) values[k] = coerce(paramTypes[k], String(values[k]))
  }
  const finalPlans = planRule(rule, values)

  let results: CheckResult[]
  if (live) {
    if (!process.env.DATABASE_URL && !process.env.DB_HOST && !process.env.MONGO_URI) {
      console.error('⚠️  --live exige DATABASE_URL (ou DB_HOST/MONGO_URI) + DB_TYPE no .env. Abortando.')
      process.exit(2)
    }
    results = await verifyLive(finalPlans)
  } else {
    results = finalPlans.map(p => ({ ...p, verdict: 'PULADO' as Verdict, detail: 'modo dry — não conferido' }))
  }

  const md = renderReport(code, ruleCode, results, live)
  const payload = { code, ruleCode, ruleName: rule.name, live, generatedAt: new Date().toISOString(), params: values, results }
  const { mdPath, jsonPath } = writeEvidence(code, ruleCode, payload, md)

  console.log(`\n=== Verificação de oráculo — ${code} / [${ruleCode}] ${rule.name} ===`)
  console.log(`Modo: ${live ? 'LIVE (banco consultado)' : 'DRY (plano apenas)'}\n`)
  for (const r of results) {
    const tag = live ? `${r.verdict}` : 'PLANO'
    console.log(`• [${tag}] ${r.oracle}`)
    console.log(`    → ${planLine(r)}`)
    if (r.unresolved.length) console.log(`    ⚠️ não resolvido: ${r.unresolved.join(', ')}`)
    if (live) console.log(`    resultado: ${r.detail}`)
  }
  if (live) {
    const pass = results.filter(r => r.verdict === 'PASSOU').length
    const fail = results.filter(r => r.verdict === 'FALHOU').length
    const skip = results.filter(r => r.verdict === 'PULADO').length
    console.log(`\nResumo: ${pass} passou / ${fail} falhou / ${skip} pulado`)
  } else {
    const unresolved = new Set(results.flatMap(r => r.unresolved))
    if (unresolved.size) console.log(`\nℹ️ Para conferir de verdade, informe: ${[...unresolved].map(u => `-p ${u}=...`).join(' ')} e rode com --live`)
  }
  console.log(`\nEvidência:`)
  console.log(`  - ${path.relative(process.cwd(), mdPath)}`)
  console.log(`  - ${path.relative(process.cwd(), jsonPath)}`)
}

if (require.main === module) {
  main().catch(err => { console.error(err.message || err); process.exit(1) })
}
