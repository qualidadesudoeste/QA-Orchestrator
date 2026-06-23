/**
 * Chat do agente (versão CLI) — pergunta coisas ao usuário em tempo de execução.
 *
 * Hoje a "conversa" acontece pelo terminal; quando houver uma UI de chat de verdade,
 * basta trocar a implementação por baixo mantendo estas mesmas chamadas.
 *
 * Governança: a senha é lida com eco MASCARADO (não aparece na tela), fica apenas
 * em memória durante o processo e NUNCA é gravada em disco, log ou relatório.
 */
import * as readline from 'readline'

/** Pergunta uma linha de texto comum (eco normal). */
export function ask(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error(`Entrada exigida ("${question.trim()}") mas o terminal não é interativo (sem TTY).`))
      return
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

/** Pergunta um segredo (senha) com eco mascarado por '*'. */
export function askSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error(`Senha exigida mas o terminal não é interativo (sem TTY). Rode num terminal interativo para informar a senha.`))
      return
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    let muted = false
    ;(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (str: string) => {
      if (muted) {
        // mascara qualquer eco enquanto o usuário digita o segredo
        process.stdout.write('*')
      } else {
        process.stdout.write(str)
      }
    }
    process.stdout.write(question)
    muted = true
    rl.question('', (answer) => {
      muted = false
      process.stdout.write('\n')
      rl.close()
      resolve(answer.trim())
    })
  })
}

// ── Resolução de senha (sempre perguntar, com cache em memória) ───────────────
let cachedPassword: string | undefined

/**
 * Resolve a senha perguntando ao usuário no chat. Pergunta UMA vez por processo
 * (cache em memória) para que fluxos multi-passo — ex.: CRUD full — não repitam.
 */
export async function resolvePassword(userLabel: string): Promise<string> {
  if (cachedPassword !== undefined) return cachedPassword
  const pw = await askSecret(`🔐 Senha de "${userLabel}": `)
  if (!pw) throw new Error('Senha vazia — não dá para autenticar.')
  cachedPassword = pw
  return pw
}

/** Limpa o segredo da memória (ex.: ao fim de uma execução). */
export function clearPasswordCache(): void {
  cachedPassword = undefined
}
