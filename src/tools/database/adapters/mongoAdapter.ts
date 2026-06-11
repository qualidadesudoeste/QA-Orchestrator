import { MongoClient, type Db } from 'mongodb'
import { logger } from '@utils/logger'
import type { DbAdapter, TableInfo, ColumnInfo, IndexInfo, FKInfo, ProcedureInfo, SchemaSnapshot } from '../types'

// MongoDB has no SQL, no FK constraints, no procedures.
// "Tables" = collections; "Columns" = inferred from sampling documents.
export class MongoAdapter implements DbAdapter {
  private client: MongoClient
  private db?: Db

  constructor(private uri: string, private dbName: string) {
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 })
  }

  async connect(): Promise<void> {
    await this.client.connect()
    this.db = this.client.db(this.dbName)
    logger.info(`MongoDB conectado — banco: ${this.dbName}`)
  }

  async disconnect(): Promise<void> {
    await this.client.close()
    logger.info('MongoDB desconectado')
  }

  async getTables(): Promise<TableInfo[]> {
    const collections = await this.db!.listCollections().toArray()
    const results: TableInfo[] = []

    for (const col of collections) {
      const count = await this.db!.collection(col.name).estimatedDocumentCount()
      results.push({ name: col.name, rowCount: count })
    }

    return results
  }

  // Infers "columns" by sampling up to 20 documents and extracting field names/types
  async getColumns(collection: string): Promise<ColumnInfo[]> {
    const docs = await this.db!.collection(collection).find({}).limit(20).toArray()
    const fieldMap = new Map<string, Set<string>>()

    for (const doc of docs) {
      for (const [key, value] of Object.entries(doc)) {
        if (!fieldMap.has(key)) fieldMap.set(key, new Set())
        fieldMap.get(key)!.add(this.inferType(value))
      }
    }

    return [...fieldMap.entries()].map(([name, types]) => ({
      name,
      type: [...types].join(' | '),
      nullable: true,
      isPrimaryKey: name === '_id',
    }))
  }

  async getIndexes(collection: string): Promise<IndexInfo[]> {
    const indexes = await this.db!.collection(collection).indexes()
    return indexes.map(idx => ({
      name: idx.name ?? 'unnamed',
      columns: Object.keys(idx.key),
      unique: idx.unique === true,
    }))
  }

  // MongoDB has no FK constraints
  async getForeignKeys(_collection: string): Promise<FKInfo[]> {
    return []
  }

  // MongoDB has no stored procedures
  async getProcedures(): Promise<ProcedureInfo[]> {
    return []
  }

  async validateRecord(collection: string, where: Record<string, unknown>): Promise<boolean> {
    const count = await this.db!.collection(collection).countDocuments(where)
    return count > 0
  }

  // Runs aggregation pipelines; raw MQL wrapped as string for consistency
  async query<T = unknown>(pipeline: string, _params?: unknown[]): Promise<T[]> {
    const [collection, ...rest] = pipeline.split('|')
    const aggPipeline = rest.length ? JSON.parse(rest.join('|')) : []
    const cursor = this.db!.collection(collection.trim()).aggregate(aggPipeline)
    return cursor.toArray() as Promise<T[]>
  }

  async getSnapshot(): Promise<SchemaSnapshot> {
    const tables = await this.getTables()
    const snapshot: SchemaSnapshot = {
      capturedAt: new Date().toISOString(),
      dbType: 'mongodb',
      database: this.dbName,
      tables: {},
    }
    for (const t of tables) {
      const [columns, indexes] = await Promise.all([
        this.getColumns(t.name),
        this.getIndexes(t.name),
      ])
      snapshot.tables[t.name] = { columns, indexes, foreignKeys: [] }
    }
    return snapshot
  }

  private inferType(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (value instanceof Date) return 'date'
    if (typeof value === 'object') return 'object'
    return typeof value
  }
}
