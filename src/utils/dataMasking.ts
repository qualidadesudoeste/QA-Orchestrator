import { SENSITIVE_PATTERNS } from '@config/constants'

export function maskSensitiveData(input: string): string {
  let masked = input

  masked = masked.replace(SENSITIVE_PATTERNS.CPF, '***.***.***-**')
  masked = masked.replace(SENSITIVE_PATTERNS.CNPJ, '**.***.***/****-**')
  masked = masked.replace(SENSITIVE_PATTERNS.EMAIL, '***@***.***')
  masked = masked.replace(SENSITIVE_PATTERNS.PHONE, '(**) *****-****')
  masked = masked.replace(SENSITIVE_PATTERNS.TOKEN, 'Bearer [REDACTED]')
  masked = masked.replace(SENSITIVE_PATTERNS.PASSWORD_FIELD, '"$1": "[REDACTED]"')

  return masked
}

export function maskObject(obj: unknown): unknown {
  if (typeof obj === 'string') return maskSensitiveData(obj)
  if (typeof obj !== 'object' || obj === null) return obj

  if (Array.isArray(obj)) return obj.map(maskObject)

  const masked: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const sensitiveKeys = ['password', 'senha', 'token', 'secret', 'api_key', 'cpf', 'cnpj']
    if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
      masked[key] = '[REDACTED]'
    } else {
      masked[key] = maskObject(value)
    }
  }
  return masked
}

export function maskScreenshotText(text: string): string {
  return maskSensitiveData(text)
}
