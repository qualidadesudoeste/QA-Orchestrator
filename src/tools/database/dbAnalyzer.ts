import { logger } from '@utils/logger'
import { PostgresAdapter } from './adapters/postgresAdapter'
import { MySQLAdapter } from './adapters/mysqlAdapter'
import { OracleAdapter } from './adapters/oracleAdapter'
import { MongoAdapter } from './adapters/mongoAdapter'
import type { DbAdapter, SchemaSnapshot, SchemaDiff } from './types'

export type DbType = 'postgres' | 'mysql' | 'oracle' | 'mongodb'

function buildAdapter(type: DbType): DbAdapter {
  switch (type) {
    case 'postgres':
      return new PostgresAdapter(process.env.DATABASE_URL!)
    case 'mysql':
      return new MySQLAdapter({
        host: process.env.DB_HOST!,
        port: parseInt(process.env.DB_PORT ?? '3306'),
        user: process.env.DB_USER!,
        password: process.env.DB_PASSWORD!,
        database: process.env.DB_NAME!,
      })
    case 'oracle':
      return new OracleAdapter({
        user: process.env.DB_USER!,
        password: process.env.DB_PASSWORD!,
        connectString: process.env.ORACLE_CONNECT_STRING!, // host:port/service
      })
    case 'mongodb':
      return new MongoAdapter(process.env.MONGO_URI!, process.env.DB_NAME!)
    default:
      throw new Error(`Tipo de banco não suportado: ${type}`)
  }
}

export class DbAnalyzer {
  private adapter: DbAdapter
  private type: DbType

  constructor(type?: DbType) {
    this.type = type ?? ((process.env.DB_TYPE as DbType) ?? 'postgres')
    this.adapter = buildAdapter(this.type)
    logger.info(`DbAnalyzer inicializado — banco: ${this.type}`)
  }

  async connect(): Promise<void> {
    await this.adapter.connect()
  }

  async disconnect(): Promise<void> {
    await this.adapter.disconnect()
  }

  // Retorna snapshot completo do schema atual
  async captureSnapshot(): Promise<SchemaSnapshot> {
    logger.info('Capturando snapshot do schema...')
    const snapshot = await this.adapter.getSnapshot()
    const tableCount = Object.keys(snapshot.tables).length
    logger.info(`Snapshot capturado — ${tableCount} tabela(s)/coleção(ões)`)
    return snapshot
  }

  // Compara dois snapshots e retorna o diff (para análise de impacto de migrations)
  diffSnapshots(before: SchemaSnapshot, after: SchemaSnapshot): SchemaDiff {
    const beforeTables = new Set(Object.keys(before.tables))
    const afterTables = new Set(Object.keys(after.tables))

    const tablesAdded = [...afterTables].filter(t => !beforeTables.has(t))
    const tablesRemoved = [...beforeTables].filter(t => !afterTables.has(t))
    const tablesModified: SchemaDiff['tablesModified'] = {}

    for (const table of beforeTables) {
      if (!afterTables.has(table)) continue

      const beforeCols = new Set(before.tables[table].columns.map(c => c.name))
      const afterCols = new Set(after.tables[table].columns.map(c => c.name))

      const columnsAdded = [...afterCols].filter(c => !beforeCols.has(c))
      const columnsRemoved = [...beforeCols].filter(c => !afterCols.has(c))

      // Detect type changes on existing columns
      const columnsModified = [...beforeCols]
        .filter(c => afterCols.has(c))
        .filter(c => {
          const bCol = before.tables[table].columns.find(col => col.name === c)
          const aCol = after.tables[table].columns.find(col => col.name === c)
          return bCol?.type !== aCol?.type || bCol?.nullable !== aCol?.nullable
        })

      if (columnsAdded.length || columnsRemoved.length || columnsModified.length) {
        tablesModified[table] = { columnsAdded, columnsRemoved, columnsModified }
      }
    }

    const hasChanges = tablesAdded.length > 0 || tablesRemoved.length > 0 || Object.keys(tablesModified).length > 0

    if (hasChanges) {
      logger.warn(`Schema diff — +${tablesAdded.length} tabela(s) | -${tablesRemoved.length} tabela(s) | ~${Object.keys(tablesModified).length} modificada(s)`)
    } else {
      logger.info('Schema diff — sem alterações detectadas')
    }

    return { tablesAdded, tablesRemoved, tablesModified, hasChanges }
  }

  // Valida se um registro existe no banco após operação da UI
  async validateRecord(table: string, where: Record<string, unknown>): Promise<boolean> {
    const found = await this.adapter.validateRecord(table, where)
    logger.info(`validateRecord [${table}] — ${found ? 'encontrado' : 'NÃO encontrado'}`)
    return found
  }

  // Inspeciona tabela específica
  async inspectTable(table: string) {
    const [columns, indexes, fks] = await Promise.all([
      this.adapter.getColumns(table),
      this.adapter.getIndexes(table),
      this.adapter.getForeignKeys(table),
    ])
    return { table, columns, indexes, foreignKeys: fks }
  }

  // Lista todas as tabelas/coleções com contagem de linhas
  async listTables() {
    return this.adapter.getTables()
  }

  // Lista procedures/functions/triggers (não disponível em MongoDB)
  async listProcedures() {
    return this.adapter.getProcedures()
  }

  // Executa query direta (uso cuidadoso — somente SELECT em produção)
  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.adapter.query<T>(sql, params)
  }
}
