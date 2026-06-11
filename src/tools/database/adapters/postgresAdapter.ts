import { Pool, type PoolClient } from 'pg'
import { logger } from '@utils/logger'
import type { DbAdapter, TableInfo, ColumnInfo, IndexInfo, FKInfo, ProcedureInfo, SchemaSnapshot } from '../types'

export class PostgresAdapter implements DbAdapter {
  private pool: Pool
  private client?: PoolClient

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 10000 })
  }

  async connect(): Promise<void> {
    this.client = await this.pool.connect()
    logger.info('PostgreSQL conectado')
  }

  async disconnect(): Promise<void> {
    this.client?.release()
    await this.pool.end()
    logger.info('PostgreSQL desconectado')
  }

  async getTables(): Promise<TableInfo[]> {
    const rows = await this.query<{ table_name: string; row_count: string }>(
      `SELECT c.relname AS table_name, c.reltuples::bigint AS row_count
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r' AND n.nspname = 'public'
       ORDER BY c.relname`
    )
    return rows.map(r => ({ name: r.table_name, rowCount: parseInt(r.row_count) }))
  }

  async getColumns(table: string): Promise<ColumnInfo[]> {
    const rows = await this.query<any>(
      `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
              CASE WHEN kcu.column_name IS NOT NULL THEN true ELSE false END AS is_pk
       FROM information_schema.columns c
       LEFT JOIN information_schema.table_constraints tc
         ON tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY'
       LEFT JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.column_name = c.column_name
       WHERE c.table_name = $1 AND c.table_schema = 'public'
       ORDER BY c.ordinal_position`,
      [table]
    )
    return rows.map(r => ({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === 'YES',
      defaultValue: r.column_default ?? undefined,
      isPrimaryKey: r.is_pk,
    }))
  }

  async getIndexes(table: string): Promise<IndexInfo[]> {
    const rows = await this.query<any>(
      `SELECT i.relname AS index_name, ix.indisunique AS is_unique,
              array_agg(a.attname ORDER BY k.i) AS columns
       FROM pg_class t
       JOIN pg_index ix ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, i) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
       WHERE t.relname = $1
       GROUP BY i.relname, ix.indisunique`,
      [table]
    )
    return rows.map(r => ({ name: r.index_name, columns: r.columns, unique: r.is_unique }))
  }

  async getForeignKeys(table: string): Promise<FKInfo[]> {
    const rows = await this.query<any>(
      `SELECT kcu.column_name, ccu.table_name AS referenced_table, ccu.column_name AS referenced_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1`,
      [table]
    )
    return rows.map(r => ({
      column: r.column_name,
      referencedTable: r.referenced_table,
      referencedColumn: r.referenced_column,
    }))
  }

  async getProcedures(): Promise<ProcedureInfo[]> {
    const rows = await this.query<any>(
      `SELECT routine_name AS name,
              CASE routine_type WHEN 'FUNCTION' THEN 'FUNCTION' ELSE 'PROCEDURE' END AS type
       FROM information_schema.routines
       WHERE routine_schema = 'public'
       ORDER BY routine_name`
    )
    return rows.map(r => ({ name: r.name, type: r.type }))
  }

  async validateRecord(table: string, where: Record<string, unknown>): Promise<boolean> {
    const keys = Object.keys(where)
    const conditions = keys.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ')
    const values = Object.values(where)
    const rows = await this.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "${table}" WHERE ${conditions}`,
      values
    )
    return parseInt(rows[0]?.count ?? '0') > 0
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const c = this.client ?? (await this.pool.connect())
    const result = await c.query(sql, params)
    return result.rows as T[]
  }

  async getSnapshot(): Promise<SchemaSnapshot> {
    const tables = await this.getTables()
    const snapshot: SchemaSnapshot = {
      capturedAt: new Date().toISOString(),
      dbType: 'postgres',
      database: this.pool.options.database ?? 'unknown',
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
