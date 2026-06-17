/**
 * makerRules — parser do export de REGRAS do Maker (FRZ/XML) → ORÁCULO de teste.
 *
 * Por que existe: testar regra de negócio = comparar o que o sistema FEZ contra
 * o que ele DEVERIA fazer (o oráculo). O Maker guarda a regra de forma
 * determinística (o SQL, os parâmetros, as restrições) dentro do XML exportado,
 * codificada em base64 (DFM Delphi) na propriedade REG_INTERFACE. Este módulo
 * decodifica isso e produz:
 *   1) um modelo estruturado (BusinessRule) — o oráculo de máquina (JSON)
 *   2) um business_rules.md legível — o oráculo humano
 *   3) cenários de teste DERIVADOS (positivo + negativos), sem IA
 *
 * É genérico p/ qualquer export Maker (vale SGOS, CLE, SIGP). SEM IA externa:
 * tudo aqui é parsing determinístico. Onde um export novo não casar, melhora-se
 * AQUI (sem remendo por sistema).
 *
 * Uso: ts-node src/knowledge/makerRules.ts <arquivo.xml> [--code SGOS]
 */

import fs from 'fs'
import path from 'path'
import { knowledgeDir, resolveCode, slug } from './layout'

// ── Modelo do oráculo ───────────────────────────────────────────────────────

export interface RuleParam {
  name: string
  type: string // Letras | Inteiro | Tabela | Data | ...
  size?: number
  direction: 'in' | 'out' | 'var'
}

export type FieldValue =
  | { kind: 'constant'; type: string; value: string }
  | { kind: 'variable'; name: string }
  | { kind: 'unknown'; raw: string }

export interface SqlField {
  name: string
  value: FieldValue
}

export interface SqlRestriction {
  compare: string // soEqual, soGreater, ...
  field: string
  against: FieldValue
}

export interface SqlOperation {
  op: string // UPDATE | INSERT | SELECT | DELETE
  table: string
  fields: SqlField[]
  restrictions: SqlRestriction[]
  /** SQL cru, quando a função usa <PSQL><COMMAND> (ex.: consultas/permissão). */
  rawCommand?: string
}

export interface RuleFunction {
  realName: string // ebfSQLExecuteUpdate, ...
  name: string
  sql?: SqlOperation
}

export interface BusinessRule {
  code: string
  name: string
  description: string
  params: RuleParam[]
  variables: RuleParam[]
  outParams: RuleParam[]
  functions: RuleFunction[]
  oracle: string[] // afirmações legíveis do "deveria ser"
}

// ── Decodificação de entidades / strings Delphi ─────────────────────────────

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Decodifica entidades XML: &#xNN; &#NNN; e nomeadas. */
export function decodeEntities(s: string): string {
  return (s || '')
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, n) => NAMED[n])
}

/**
 * Reconstrói uma expressão de string Delphi (DFM): sequência de literais
 * 'texto' (com '' = aspa escapada) e códigos #NN / #xNN, possivelmente unidos
 * por + e quebras de linha. Retorna a string concatenada.
 */
export function delphiExpr(raw: string): string {
  const tokens = raw.match(/'(?:[^']|'')*'|#x[0-9A-Fa-f]+|#\d+/g) || []
  let out = ''
  for (const t of tokens) {
    if (t.startsWith("'")) out += t.slice(1, -1).replace(/''/g, "'")
    else if (t.startsWith('#x')) out += String.fromCharCode(parseInt(t.slice(2), 16))
    else out += String.fromCharCode(parseInt(t.slice(1), 10))
  }
  return out
}

// ── Parsing das regras ──────────────────────────────────────────────────────

/** "pMotivo,Letras,50,;pOS_COD,Inteiro,," → params (após decodificar entidades). */
function parseParamList(raw: string, direction: RuleParam['direction']): RuleParam[] {
  const decoded = decodeEntities(raw).trim()
  if (!decoded) return []
  return decoded
    .split(';')
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(chunk => {
      const [name, type = '', size = ''] = chunk.split(',')
      const p: RuleParam = { name: name.trim(), type: (type || 'Texto').trim(), direction }
      if (size && /^\d+$/.test(size.trim())) p.size = parseInt(size.trim(), 10)
      return p
    })
    .filter(p => p.name)
}

function prop(block: string, name: string): string {
  const m = block.match(new RegExp(`<property name="${name}"[^>]*>([\\s\\S]*?)</property>`))
  return m ? m[1] : ''
}

/** Extrai o valor de um <SQLFIELD>/<COMPARE> filho: CONSTANT ou VARIABLE. */
function parseValue(inner: string): FieldValue {
  const v = inner.match(/<VARIABLE NAME="([^"]*)"/)
  if (v) return { kind: 'variable', name: decodeEntities(v[1]) }
  const c = inner.match(/<CONSTANT TYPE="([^"]*)"[^>]*>([\s\S]*?)<\/CONSTANT>/)
  if (c) return { kind: 'constant', type: decodeEntities(c[1]).trim(), value: decodeEntities(c[2]).trim() }
  return { kind: 'unknown', raw: inner.trim().slice(0, 60) }
}

/** Colapsa espaços/quebras e tira marcadores de comentário do SQL cru. */
function compactSql(s: string): string {
  return decodeEntities(s)
    .replace(/\/\*[^*]*\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Parseia o <SQL ...>...</SQL> (DML estruturado) ou <PSQL><COMMAND> (SQL cru). */
function parseSql(funcXml: string): SqlOperation | undefined {
  // Forma 2: PSQL com SQL cru (consultas, permissão) — <COMMAND>...</COMMAND>.
  const cmdM = funcXml.match(/<COMMAND>([\s\S]*?)<\/COMMAND>/)
  if (cmdM && !/<SQL TYPE=/.test(funcXml)) {
    const raw = compactSql(cmdM[1])
    const op = (raw.match(/^\s*(select|update|insert|delete)/i)?.[1] || 'SELECT').toUpperCase()
    const table = (raw.match(/\bfrom\s+([A-Za-z0-9_]+)/i)?.[1] || raw.match(/\b(?:update|into)\s+([A-Za-z0-9_]+)/i)?.[1] || '').trim()
    return { op, table, fields: [], restrictions: [], rawCommand: raw }
  }

  const sqlM = funcXml.match(/<SQL TYPE="([^"]+)">([\s\S]*?)<\/SQL>/)
  if (!sqlM) return undefined
  const op = sqlM[1].toUpperCase()
  const body = sqlM[2]
  const table = (body.match(/<TABLE>([^<]+)<\/TABLE>/)?.[1] || '').trim()

  // restrições primeiro (e remove do corpo p/ não confundir com SQLFIELDs do SET)
  const restrictions: SqlRestriction[] = []
  const restrM = body.match(/<RESTRICTIONS>([\s\S]*?)<\/RESTRICTIONS>/)
  if (restrM) {
    const re = /<COMPARE TYPE="([^"]+)">([\s\S]*?)<\/COMPARE>/g
    let c: RegExpExecArray | null
    while ((c = re.exec(restrM[1]))) {
      const field = (c[2].match(/<SQLFIELD NAME="([^"]*)"\s*\/?>/)?.[1] || '').trim()
      restrictions.push({ compare: c[1], field, against: parseValue(c[2]) })
    }
  }
  const setBody = restrM ? body.replace(restrM[0], '') : body

  const fields: SqlField[] = []
  const fre = /<SQLFIELD NAME="([^"]*)">([\s\S]*?)<\/SQLFIELD>/g
  let f: RegExpExecArray | null
  while ((f = fre.exec(setBody))) {
    fields.push({ name: decodeEntities(f[1]).trim(), value: parseValue(f[2]) })
  }
  return { op, table, fields, restrictions }
}

/** Decodifica o REG_INTERFACE (base64 → DFM) e extrai as FUNCTIONs embutidas. */
function parseInterface(cdataB64: string): RuleFunction[] {
  const dfm = Buffer.from(cdataB64.replace(/\s+/g, ''), 'base64').toString('latin1')
  // cada Expression = <sequência de literais Delphi> contém uma FUNCTION XML
  const out: RuleFunction[] = []
  const ex = /Expression =\s*((?:(?:'(?:[^']|'')*'|#x[0-9A-Fa-f]+|#\d+)\s*\+?\s*)+)/g
  let m: RegExpExecArray | null
  while ((m = ex.exec(dfm))) {
    const funcXml = decodeEntities(delphiExpr(m[1]))
    if (!/<FUNCTION/i.test(funcXml)) continue
    const realName = funcXml.match(/REALNAME="([^"]*)"/)?.[1] || ''
    const name = decodeEntities(funcXml.match(/<FUNCTION NAME="([^"]*)"/)?.[1] || '')
    out.push({ realName, name, sql: parseSql(funcXml) })
  }
  return out
}

/** Frase legível do "deveria ser" a partir de um valor. */
function valueStr(v: FieldValue): string {
  if (v.kind === 'constant') return `"${v.value}"`
  if (v.kind === 'variable') return `:${v.name}`
  return '?'
}

const COMPARE_PT: Record<string, string> = {
  soEqual: '=', soDifferent: '≠', soGreater: '>', soLess: '<',
  soGreaterEqual: '≥', soLessEqual: '≤', soLike: 'contém',
}

/** Monta as afirmações de oráculo (o que o sistema DEVE fazer). */
function buildOracle(rule: BusinessRule): string[] {
  const lines: string[] = []
  for (const fn of rule.functions) {
    if (!fn.sql) {
      lines.push(`Executa a função \`${fn.realName || fn.name}\` (não-SQL — verificar efeito manualmente).`)
      continue
    }
    const s = fn.sql
    const sets = s.fields.map(f => `${f.name} ${f.value.kind === 'constant' ? '=' : '←'} ${valueStr(f.value)}`)
    const where = s.restrictions.map(r => `${r.field} ${COMPARE_PT[r.compare] || r.compare} ${valueStr(r.against)}`)
    if (s.op === 'UPDATE') {
      lines.push(`Deve ATUALIZAR \`${s.table}\` definindo ${sets.join('; ')}${where.length ? ` ONDE ${where.join(' E ')}` : ''}.`)
    } else if (s.op === 'INSERT') {
      lines.push(`Deve INSERIR em \`${s.table}\` com ${sets.join('; ')}.`)
    } else if (s.op === 'DELETE') {
      lines.push(`Deve EXCLUIR de \`${s.table}\`${where.length ? ` ONDE ${where.join(' E ')}` : ''}.`)
    } else if (s.op === 'SELECT') {
      if (s.rawCommand) {
        lines.push(`Pré-condição via consulta em \`${s.table}\` — só prossegue se a consulta RETORNAR registro (vazio ⇒ regra deve bloquear). SQL: \`${s.rawCommand}\``)
      } else {
        lines.push(`Deve CONSULTAR \`${s.table}\`${where.length ? ` ONDE ${where.join(' E ')}` : ''} (validação/pré-condição).`)
      }
    } else {
      lines.push(`Operação ${s.op} em \`${s.table}\`.`)
    }
  }
  return lines
}

/** Parseia o XML inteiro → lista de regras com oráculo. */
export function parseMakerRules(xml: string): BusinessRule[] {
  const rules: BusinessRule[] = []
  const re = /<rule\b([^>]*)>([\s\S]*?)<\/rule>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const attrs = m[1]
    const block = m[2]
    const code = (prop(block, 'REG_COD') || attrs.match(/REG_COD="([^"]*)"/)?.[1] || '').trim()
    const name = decodeEntities(prop(block, 'REG_NOME') || attrs.match(/REG_NOME="([^"]*)"/)?.[1] || '').trim()
    const description = decodeEntities(prop(block, 'REG_DESCRICAO')).trim()
    const params = parseParamList(prop(block, 'REG_PARAMS'), 'in')
    const variables = parseParamList(prop(block, 'REG_VARIAVEIS'), 'var')
    const outParams = parseParamList(prop(block, 'REG_PARAMS_OUT'), 'out')
    const ifaceB64 = block.match(/REG_INTERFACE"[^>]*><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] || ''
    const functions = ifaceB64 ? parseInterface(ifaceB64) : []
    const rule: BusinessRule = { code, name, description, params, variables, outParams, functions, oracle: [] }
    rule.oracle = buildOracle(rule)
    rules.push(rule)
  }
  return rules
}

// ── Saídas: markdown (oráculo humano) + JSON (oráculo de máquina) ────────────

export function rulesToMarkdown(code: string, sourceFile: string, rules: BusinessRule[]): string {
  const L: string[] = []
  L.push(`# Regras de Negócio — ${code}`, '')
  L.push(`> Gerado automaticamente do export Maker em ${new Date().toISOString()}.`)
  L.push(`> Fonte: \`${sourceFile}\` — ${rules.length} regra(s). Oráculo determinístico (sem IA).`, '')
  for (const r of rules) {
    L.push(`## [${r.code}] ${r.name}`)
    if (r.description) L.push('', r.description)
    if (r.params.length) L.push('', `**Parâmetros de entrada:** ${r.params.map(p => `\`${p.name}\` (${p.type}${p.size ? `, máx ${p.size}` : ''})`).join(', ')}`)
    if (r.variables.length) L.push('', `**Variáveis:** ${r.variables.map(p => `\`${p.name}\` (${p.type})`).join(', ')}`)
    if (r.outParams.length) L.push('', `**Saída:** ${r.outParams.map(p => `\`${p.name}\` (${p.type})`).join(', ')}`)
    L.push('', '**Oráculo (o que o sistema DEVE fazer):**')
    if (r.oracle.length) r.oracle.forEach(o => L.push(`- ${o}`))
    else L.push('- _(não foi possível extrair efeito SQL — revisar o export)_')
    L.push('')
  }
  return L.join('\n')
}

// ── Cenários derivados (determinísticos, sem IA) ────────────────────────────

export interface DerivedScenario {
  ruleCode: string
  type: 'positivo' | 'negativo'
  title: string
  given: string
  when: string
  then: string
}

/** Deriva cenários positivo/negativos de cada regra a partir do oráculo. */
export function deriveScenarios(rules: BusinessRule[]): DerivedScenario[] {
  const out: DerivedScenario[] = []
  for (const r of rules) {
    const inParams = r.params
    const provide = inParams.length ? inParams.map(p => `\`${p.name}\` válido`).join(', ') : 'os dados exigidos'

    // Positivo: fornece os parâmetros e espera o efeito do oráculo.
    out.push({
      ruleCode: r.code,
      type: 'positivo',
      title: `${r.name} — caminho feliz`,
      given: `que o usuário tem acesso à regra "${r.name}"`,
      when: `executa a ação fornecendo ${provide}`,
      then: r.oracle.length ? r.oracle.join(' E ') : 'a operação é concluída com sucesso',
    })

    // Negativos: 1 por parâmetro de entrada (ausente/ inválido).
    for (const p of inParams) {
      const invalid = p.size ? `\`${p.name}\` acima de ${p.size} caracteres` : `\`${p.name}\` em branco`
      out.push({
        ruleCode: r.code,
        type: 'negativo',
        title: `${r.name} — ${p.name} inválido`,
        given: `que o usuário vai executar a regra "${r.name}"`,
        when: `informa ${invalid}`,
        then: `o sistema NÃO deve persistir a operação e deve sinalizar o erro de validação`,
      })
    }

    // Negativo de permissão, quando a regra cheira a controle de acesso.
    if (/permiss|acesso|autoriza/i.test(r.name)) {
      out.push({
        ruleCode: r.code,
        type: 'negativo',
        title: `${r.name} — sem permissão`,
        given: `que o usuário NÃO tem permissão para a regra "${r.name}"`,
        when: `tenta executar a ação`,
        then: `o sistema deve bloquear e não executar o efeito`,
      })
    }
  }
  return out
}

export function scenariosToMarkdown(code: string, scenarios: DerivedScenario[]): string {
  const L: string[] = []
  L.push(`# Cenários derivados das regras — ${code}`, '')
  L.push(`> ${scenarios.length} cenário(s) derivados deterministicamente do oráculo (sem IA).`, '')
  let current = ''
  for (const s of scenarios) {
    if (s.ruleCode !== current) { L.push(`## Regra [${s.ruleCode}]`, ''); current = s.ruleCode }
    L.push(`### (${s.type}) ${s.title}`)
    L.push(`- **Dado** ${s.given}`)
    L.push(`- **Quando** ${s.when}`)
    L.push(`- **Então** ${s.then}`, '')
  }
  return L.join('\n')
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export function ingestRulesFile(file: string, codeOverride?: string) {
  const xml = fs.readFileSync(file, 'utf-8')
  const code = codeOverride || resolveCode(file) || 'SISTEMA'
  const rules = parseMakerRules(xml)
  const scenarios = deriveScenarios(rules)

  const dir = knowledgeDir(code)
  const mdPath = path.join(dir, 'business_rules.md')
  const jsonPath = path.join(dir, 'business_rules.json')
  const scnPath = path.join(dir, 'cenarios_regras.md')
  fs.writeFileSync(mdPath, rulesToMarkdown(code, path.basename(file), rules), 'utf-8')
  fs.writeFileSync(jsonPath, JSON.stringify({ code, source: path.basename(file), generatedAt: new Date().toISOString(), rules }, null, 2), 'utf-8')
  fs.writeFileSync(scnPath, scenariosToMarkdown(code, scenarios), 'utf-8')

  return { code, rules, scenarios, mdPath, jsonPath, scnPath }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const cIdx = args.indexOf('--code')
  const code = cIdx >= 0 ? args[cIdx + 1] : undefined
  const file = args.filter((a, i) => !a.startsWith('--') && !(cIdx >= 0 && i === cIdx + 1))[0]
  if (!file) {
    console.error('Uso: ts-node src/knowledge/makerRules.ts <arquivo.xml> [--code SGOS]')
    process.exit(1)
  }
  if (!fs.existsSync(file)) {
    console.error(`Arquivo não encontrado: ${file}`)
    process.exit(1)
  }
  const r = ingestRulesFile(file, code)
  console.log(`\n=== Regras extraídas de ${path.basename(file)} (sistema ${r.code}) ===\n`)
  for (const rule of r.rules) {
    console.log(`[${rule.code}] ${rule.name}`)
    if (rule.params.length) console.log(`   entrada: ${rule.params.map(p => `${p.name}:${p.type}${p.size ? `(${p.size})` : ''}`).join(', ')}`)
    rule.oracle.forEach(o => console.log(`   ⇒ ${o}`))
    console.log('')
  }
  console.log(`Cenários derivados: ${r.scenarios.length} (${r.scenarios.filter(s => s.type === 'positivo').length} positivos / ${r.scenarios.filter(s => s.type === 'negativo').length} negativos)`)
  console.log(`\nGravado:`)
  console.log(`  - ${path.relative(process.cwd(), r.mdPath)}   (oráculo humano)`)
  console.log(`  - ${path.relative(process.cwd(), r.jsonPath)} (oráculo de máquina — contrato p/ outros projetos)`)
  console.log(`  - ${path.relative(process.cwd(), r.scnPath)}  (cenários derivados)`)
}
