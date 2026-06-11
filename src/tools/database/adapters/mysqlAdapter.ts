import mysql from 'mysql2/promise'
import { logger } from '@utils/logger'
import type { DbAdapter, TableInfo, ColumnInfo, IndexInfo, FKInfo, ProcedureInfo, SchemaSnapshot } from '../types'

export class MySQLAdapter implements DbAdapter {
  private pool: mysql.Pool
  private conn?: mysql.PoolConnection
  private dbName: string

  constructor(private config: { host: string; port: number; user: string; password: string; database: string }) {
    this.dbName = config.database
    this.pool = mysql.createPool({ ...config, waitForConnections: true, connectionLimit: 3 })
  }

  async connect(): Promise<void> {
    this.conn = await this.pool.getConnection()
    logger.info('MySQL conectado')
  }

  async disconnect(): Promise<void> {
    this.conn?.release()
    await this.pool.end()
    logger.info('MySQL desconectado')
  }

  async getTables(): Promise<TableInfo[]> {
    const rows = await this.query<any>(
      `SELECT TABLE_NAME AS name, TABLE_ROWS AS row_count
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [this.dbName]
    )
    return rows.map(r => ({ name: r.name, rowCount: r.row_count ?? 0 }))
  }

  async getColumns(table: string): Promise<ColumnInfo[]> {
    const rows = await this.query<any>(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [this.dbName, table]
    )
    return rows.map(r => ({
      name: r.COLUMN_NAME,
      type: r.DATA_TYPE,
      nullable: r.IS_NULLABLE === 'YES',
      defaultValue: r.COLUMN_DEFAULT ?? undefined,
      isPrimaryKey: r.COLUMN_KEY === 'PRI',
    }))
  }

  async getIndexes(table: string): Promise<IndexInfo[]> {
    const rows = await this.query<any>(
      `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [this.dbName, table]
    )
    const map = new Map<string, IndexInfo>()
    for (const r of rows) {
      if (!map.has(r.INDEX_NAME)) {
        map.set(r.INDEX_NAME, { name: r.INDEX_NAME, columns: [], unique: r.NON_UNIQUE === 0 })
      }
      map.get(r.INDEX_NAME)!.columns.push(r.COLUMN_NAME)
    }
    return [...map.values()]
  }

  async getForeignKeys(table: string): Promise<FKInfo[]> {
    const rows = await this.query<any>(
      `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [this.dbName, table]
    )
    return rows.map(r => ({
      column: r.COLUMN_NAME,
      referencedTable: r.REFERENCED_TABLE_NAME,
      referencedColumn: r.REFERENCED_COLUMN_NAME,
    }))
  }

  async getProcedures(): Promise<ProcedureInfo[]> {
    const rows = await this.query<any>(
      `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type
       FROM information_schema.ROUTINES
       WHERE ROUTINE_SCHEMA = ?`,
      [this.dbName]
    )
    return rows.map(r => ({ name: r.name, type: r.type }))
  }

  async validateRecord(table: string, where: Record<string, unknown>): Promise<boolean> {
    const conditions = Object.keys(where).map(k => `\`${k}\` = ?`).join(' AND ')
    const rows = await this.query<any>(
      `SELECT COUNT(*) AS count FROM \`${table}\` WHERE ${conditions}`,
      Object.values(where)
    )
    return parseInt(rows[0]?.count ?? '0') > 0
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const [rows] = await this.pool.execute(sql, params)
    return rows as T[]
  }

  async getSnapshot(): Promise<SchemaSnapshot> {
    const tables = await this.getTables()
    const snapshot: SchemaSnapshot = {
      capturedAt: new Date().toISOString(),
      dbType: 'mysql',
      database: this.dbName,
      tables: {},
    }
    for (const t of tables) {
      const [columns, indexes, foreignKeys] = await Promise.all([
        this.getColumns(t.name),
        this.getIndexes(t.name),
        this.getForeignKeys(t.name),
      ])
      snapshot.tables[t.name] = { columns, indexes, foreignKeys }
    }
    return snapshot
  }
}
