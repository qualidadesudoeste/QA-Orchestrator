import { faker } from '@faker-js/faker/locale/pt_BR'

// All generated data is synthetic — never use real PII (LGPD compliance)
export const testData = {
  person: () => ({
    name: faker.person.fullName(),
    email: faker.internet.email(),
    phone: faker.phone.number('(##) #####-####'),
    cpf: generateFakeCPF(),
    birthDate: faker.date.birthdate({ min: 18, max: 80, mode: 'age' }),
  }),

  company: () => ({
    name: faker.company.name(),
    cnpj: generateFakeCNPJ(),
    email: faker.internet.email(),
    phone: faker.phone.number('(##) ####-####'),
  }),

  address: () => ({
    street: faker.location.street(),
    number: faker.number.int({ min: 1, max: 9999 }).toString(),
    city: faker.location.city(),
    state: faker.location.state({ abbreviated: true }),
    zipCode: faker.location.zipCode('#####-###'),
  }),

  credentials: () => ({
    username: faker.internet.username(),
    password: faker.internet.password({ length: 16, memorable: false }),
  }),

  text: {
    short: () => faker.lorem.words(3),
    medium: () => faker.lorem.sentence(),
    long: () => faker.lorem.paragraph(),
    special: () => `<script>alert('xss')</script> ' OR 1=1-- ${faker.lorem.word()}`,
    maxLength: (max: number) => faker.lorem.words(max).slice(0, max),
  },
}

function generateFakeCPF(): string {
  const digits = Array.from({ length: 9 }, () => faker.number.int({ min: 0, max: 9 }))
  const d1 = calcDigit(digits, 10)
  const d2 = calcDigit([...digits, d1], 11)
  return `${digits.slice(0, 3).join('')}.${digits.slice(3, 6).join('')}.${digits.slice(6).join('')}-${d1}${d2}`
}

function generateFakeCNPJ(): string {
  const n = Array.from({ length: 12 }, () => faker.number.int({ min: 0, max: 9 }))
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const d1 = calcMod11(n, weights1)
  const d2 = calcMod11([...n, d1], weights2)
  return `${n.slice(0, 2).join('')}.${n.slice(2, 5).join('')}.${n.slice(5, 8).join('')}/${n.slice(8).join('')}-${d1}${d2}`
}

function calcDigit(digits: number[], start: number): number {
  const sum = digits.reduce((acc, d, i) => acc + d * (start - i), 0)
  const rem = sum % 11
  return rem < 2 ? 0 : 11 - rem
}

function calcMod11(digits: number[], weights: number[]): number {
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0)
  const rem = sum % 11
  return rem < 2 ? 0 : 11 - rem
}
