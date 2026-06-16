/**
 * testGen — Fase D (parte 1): gerar cenários de teste BDD com IA.
 *
 * Pega os campos/botões de uma tela (via Explorer, frame-aware) e pede ao
 * provedor de IA configurado (Gemini grátis, por padrão) para gerar cenários
 * de teste em BDD (Dado/Quando/Então) com DADOS de teste — positivos,
 * negativos, borda e segurança (SQLi/XSS).
 *
 * Saída: um arquivo .feature (Gherkin pt-BR, legível) + JSON dos cenários,
 * em evidence/scenarios/. A EXECUÇÃO dos cenários é a próxima parte.
 *
 * Uso: ts-node src/discovery/testGen.ts <url> [--vision] [--headed]
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { explore } from './explorer'
import { getProvider } from './aiProvider'
import { idFromUrl, profileStore } from './systemProfile'

export interface BddScenarioGen {
  tipo: string
  titulo: string
  prioridade: string
  dado: string[]
  quando: string[]
  entao: string[]
  dadosTeste?: Record<string, string>
}

const OUT_DIR = path.join('evidence', 'scenarios')

const SYSTEM_PROMPT = `Você é um QA Sênior que gera cenários de teste automatizados em BDD (português).
Recebe os campos e botões de uma tela e gera cenários CONCRETOS e executáveis.

Regras:
- Para cada campo de entrada gere ao menos: 1 positivo, 1 negativo, 1 de borda.
- Inclua cenários de SEGURANÇA (SQL Injection e XSS) nos campos de texto.
- Cada cenário tem fases BDD: "dado" (pré-condições), "quando" (ações), "entao" (resultados esperados).
- Refira os campos pelos nomes/labels reais mostrados. Forneça "dadosTeste" com valores plausíveis.
- tipo ∈ POSITIVO, NEGATIVO, BORDA, SEGURANCA. prioridade ∈ ALTA, MEDIA, BAIXA.

Responda APENAS com um array JSON, sem markdown, no formato:
[{"tipo":"POSITIVO","titulo":"...","prioridade":"ALTA","dado":["..."],"quando":["..."],"entao":["..."],"dadosTeste":{"campo":"valor"}}]`

function buildPrompt(title: string, url: string, fields: string[], buttons: string[]): string {
  return `TELA: ${title}
URL: ${url}

CAMPOS:
${fields.length ? fields.map(f => `- ${f}`).join('\n') : '(nenhum)'}

BOTÕES:
${buttons.length ? buttons.map(b => `- ${b}`).join('\n') : '(nenhum)'}

Gere entre 8 e 14 cenários cobrindo positivo, negativo, borda e segurança.`
}

export async function generateTests(
  url: string,
  opts: { useVision?: boolean; headed?: boolean } = {}
): Promise<{ scenarios: BddScenarioGen[]; featurePath: string; jsonPath: string }> {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const id = idFromUrl(url)

  console.log(`\n[1/3] Mapeando a tela ${url} ...`)
  // settle maior: sistemas Maker carregam o form num iframe aninhado depois.
  const exploration = await explore(url, { headless: !opts.headed, settleMs: 8000 })
  let fields = exploration.inputs
    .filter(i => i.visible)
    .map(i => `${i.type} name="${i.name}" id="${i.id}" placeholder="${i.placeholder}" aria="${i.ariaLabel}"`)
  const buttons = exploration.buttons.filter(b => b.visible).map(b => `"${b.text}" type=${b.type}`)

  // Fallback Maker/iframe: se o scrape não achou campos mas o perfil aprendido
  // (via visão) já conhece o login, usa esses campos conhecidos.
  if (fields.length === 0) {
    const profile = profileStore.loadByUrl(url)
    if (profile?.login) {
      const uSel = profile.login.usernameSelectors[0] ?? '(usuário)'
      const pSel = profile.login.passwordSelectors[0] ?? '(senha)'
      fields = [
        `campo de usuário/login (seletor aprendido: ${uSel})`,
        `campo de senha (seletor aprendido: ${pSel})`,
      ]
      console.log(`      (scrape vazio — usando campos do perfil aprendido: usuário + senha)`)
    }
  }

  console.log(`      ${fields.length} campos, ${buttons.length} botões`)
  if (exploration.blocked) console.log(`      ⚠️ ${exploration.blocked.reason}`)

  console.log(`[2/3] Gerando cenários BDD com IA ...`)
  const provider = getProvider()
  const imageBase64 =
    opts.useVision && fs.existsSync(exploration.screenshotPath)
      ? fs.readFileSync(exploration.screenshotPath).toString('base64')
      : undefined

  const raw = await provider.discover({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildPrompt(exploration.title, url, fields, buttons),
    imageBase64,
    maxTokens: 4096,
  })
  const scenarios = parseScenarios(raw.text)
  console.log(`      [provedor: ${provider.name}] ${scenarios.length} cenário(s) gerado(s)` + (raw.usage ? ` | tokens: ${raw.usage.inputTokens}/${raw.usage.outputTokens}` : ''))

  console.log(`[3/3] Escrevendo .feature e JSON ...`)
  const feature = toFeature(exploration.title || id, scenarios)
  const featurePath = path.join(OUT_DIR, `${id}.feature`)
  const jsonPath = path.join(OUT_DIR, `${id}.scenarios.json`)
  fs.writeFileSync(featurePath, feature, 'utf-8')
  fs.writeFileSync(jsonPath, JSON.stringify(scenarios, null, 2), 'utf-8')
  console.log(`      ✓ ${featurePath}`)
  console.log(`      ✓ ${jsonPath}`)

  return { scenarios, featurePath, jsonPath }
}

function parseScenarios(text: string): BddScenarioGen[] {
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1)) as BddScenarioGen[]
    return arr.filter(s => s.titulo && (s.quando?.length || s.dado?.length))
  } catch {
    return []
  }
}

function toFeature(title: string, scenarios: BddScenarioGen[]): string {
  const lines = ['# language: pt', `Funcionalidade: ${title}`, '']
  for (const s of scenarios) {
    lines.push(`  @${slug(s.tipo)} @${slug(s.prioridade)}`)
    lines.push(`  Cenário: ${s.titulo}`)
    for (const d of s.dado ?? []) lines.push(`    Dado ${d}`)
    for (let i = 0; i < (s.quando ?? []).length; i++) lines.push(`    ${i === 0 ? 'Quando' : 'E'} ${s.quando[i]}`)
    for (let i = 0; i < (s.entao ?? []).length; i++) lines.push(`    ${i === 0 ? 'Então' : 'E'} ${s.entao[i]}`)
    if (s.dadosTeste && Object.keys(s.dadosTeste).length) {
      lines.push(`    # dados: ${Object.entries(s.dadosTeste).map(([k, v]) => `${k}=${v}`).join(', ')}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function slug(s: string): string {
  return (s || 'geral').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const url = args.filter(a => !a.startsWith('--'))[0]
  if (!url) {
    console.error('Uso: ts-node src/discovery/testGen.ts <url> [--vision] [--headed]')
    process.exit(1)
  }
  generateTests(url, { useVision: args.includes('--vision'), headed: args.includes('--headed') })
    .then(r => console.log(`\n✓ Fase D (geração) concluída: ${r.scenarios.length} cenários em ${r.featurePath}`))
    .catch(err => {
      console.error('Falha na geração:', err.message)
      process.exit(1)
    })
}
