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

// Códigos de controle do terminal (evita literais de controle no código-fonte).
const ENTER_CR = 13   // '\r'
const ENTER_LF = 10   // '\n'
const CTRL_C = 3      // ETX → cancelar
const CTRL_D = 4      // EOT → fim
const BACKSPACE = 127 // DEL
const BACKSPACE_BS = 8 // BS
const PRINTABLE_MIN = 32 // primeiro caractere imprimível (espaço)

/**
 * Pergunta um segredo (senha) com eco mascarado por '*'.
 * Lê em raw mode, char a char: trata Enter, Backspace, Ctrl+C e colagem.
 */
export function askSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    const stdout = process.stdout
    if (!stdin.isTTY) {
      reject(new Error('Senha exigida mas o terminal não é interativo (sem TTY). Rode num terminal interativo para informar a senha.'))
      return
    }

    let secret = ''
    stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    const cleanup = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
    }

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0)
        if (code === ENTER_CR || code === ENTER_LF || code === CTRL_D) {
          cleanup()
          stdout.write('\n')
          resolve(secret)
          return
        }
        if (code === CTRL_C) {
          cleanup()
          stdout.write('\n')
          reject(new Error('Entrada de senha cancelada pelo usuário (Ctrl+C).'))
          return
        }
        if (code === BACKSPACE || code === BACKSPACE_BS) {
          if (secret.length > 0) {
            secret = secret.slice(0, -1)
            stdout.write('\b \b')
          }
          continue
        }
        // ignora demais caracteres de controle; mascara os imprimíveis
        if (code >= PRINTABLE_MIN) {
          secret += ch
          stdout.write('*')
        }
      }
    }

    stdin.on('data', onData)
  })
}

// ── Resolução de senha (injetável p/ backend; prompt TTY como fallback de CLI) ─
//
// ESTE REPO É O BACKEND: um frontend/serviço vai dirigir o agente sem terminal.
// Por isso a senha é resolvida em camadas, da mais "programática" p/ a interativa:
//   1) senha já em cache (setPassword / pergunta anterior nesta sessão);
//   2) um PROVIDER injetado pelo backend (ex.: busca de um vault/sessão do front);
//   3) fallback CLI: pergunta no terminal (chat mascarado) — só quando há TTY.
let cachedPassword: string | undefined
let passwordProvider: ((userLabel: string) => string | Promise<string>) | null = null

/** Backend: injeta a senha diretamente (sem prompt). Fica em cache na sessão. */
export function setPassword(pw: string): void {
  cachedPassword = pw
}

/**
 * Backend: registra um provedor de senha (ex.: ler de um cofre, da sessão do
 * frontend, de variável de ambiente do serviço). Chamado sob demanda, 1×/processo.
 */
export function setPasswordProvider(fn: (userLabel: string) => string | Promise<string>): void {
  passwordProvider = fn
}

/**
 * Resolve a senha em camadas (cache → provider injetado → prompt TTY). Pergunta
 * UMA vez por processo (cache em memória) para que fluxos multi-passo — ex.: CRUD
 * full — não repitam. A senha nunca é gravada em disco/log.
 */
export async function resolvePassword(userLabel: string): Promise<string> {
  if (cachedPassword !== undefined) return cachedPassword
  if (passwordProvider) {
    const pw = await passwordProvider(userLabel)
    if (!pw) throw new Error('Provedor de senha (backend) retornou vazio.')
    cachedPassword = pw
    return pw
  }
  const pw = await askSecret(`🔐 Senha de "${userLabel}": `)
  if (!pw) throw new Error('Senha vazia — não dá para autenticar.')
  cachedPassword = pw
  return pw
}

/** Limpa o segredo (e o provider) da memória — ex.: ao fim de uma execução. */
export function clearPasswordCache(): void {
  cachedPassword = undefined
  passwordProvider = null
}
