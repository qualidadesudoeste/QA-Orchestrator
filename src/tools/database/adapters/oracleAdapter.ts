import { logger } from '@utils/logger'
import type { DbAdapter, TableInfo, ColumnInfo, IndexInfo, FKInfo, ProcedureInfo, SchemaSnapshot } from '../types'

// oracledb is optional — requires Oracle Instant Client installed on the machine.
// If not present, this adapter throws a clear error at connect time.
let oracledb: any = null
try {
  oracledb = require('oracledb')
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT
} catch {
  // silently unavailable — error surfaces at connect()
}

export class OracleAdapter implements DbAdapter {
  private conn?: any

  constructor(
    private config: {
      user: string
      password: string
      connectString: string  // host:port/service_name
    }
  ) {}

  async connect(): Promise<void> {
    if (!oracledb) {
      throw new Error(
        'oracledb não instalado. Instale o Oracle Instant Client e execute: npm install oracledb'
      )
    }
    this.conn = await oracledb.getConnection(this.config)
    logger.info('Oracle conectado')
  }

  async disconnect(): Promise<void> {
    await this.conn?.close()
    logger.info('Oracle desconectado')
  }

  async getTables(): Promise<TableInfo[]> {
    const rows = await this.query<any>(
      `SELECT TABLE_NAME AS name, NUM_ROWS AS row_count
       FROM user_tables ORDER BY TABLE_NAME`
    )
    return rows.map(r => ({ name: r.NAME, rowCount: r.ROW_COUNT ?? 0 }))
  }

  async getColumns(table: string): Promise<ColumnInfo[]> {
    const rows = await this.query<any>(
      `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.NULLABLE, c.DATA_DEFAULT,
              CASE WHEN p.COLUMN_NAME IS NOT NULL THEN 'Y' ELSE 'N' END AS IS_PK
       FROM user_tab_columns c
       LEFT JOIN (
         SELECT cc.COLUMN_NAME FROM user_constraints con
         JOIN user_cons_columns cc ON cc.CONSTRAINT_NAME = con.CONSTRAINT_NAME
         WHERE con.TABLE_NAME = :1 AND con.CONSTRAINT_TYPE = 'P'
       ) p ON p.COLUMN_NAME = c.COLUMN_NAME
       WHERE c.TABLE_NAME = :1
       ORDER BY c.COLUMN_ID`,
      [table]
    )
    return rows.map(r => ({
      name: r.COLUMN_NAME,
      type: r.DATA_TYPE,
      nullable: r.NULLABLE === 'Y',
      defaultValue: r.DATA_DEFAULT?.trim() ?? undefined,
      isPrimaryKey: r.IS_PK === 'Y',
    }))
  }

  async getIndexes(table: string): Promise<IndexInfo[]> {
    const rows = await this.query<any>(
      `SELECT i.INDEX_NAME, i.UNIQUENESS, ic.COLUMN_NAME
       FROM user_indexes i
       JOIN user_ind_columns ic ON ic.INDEX_NAME = i.INDEX_NAME
       WHERE i.TABLE_NAME = :1
       ORDER BY i.INDEX_NAME, ic.COLUMN_POSITION`,
      [table]
    )
    const map = new Map<string, IndexInfo>()
    for (const r of rows) {
      if (!map.has(r.INDEX_NAME)) {
        map.set(r.INDEX_NAME, { name: r.INDEX_NAME, columns: [], unique: r.UNIQUENESS === 'UNIQUE' })
      }
      map.get(r.INDEX_NAME)!.columns.push(r.COLUMN_NAME)
    }
    return [...map.values()]
  }

  async getForeignKeys(table: string): Promise<FKInfo[]> {
    const rows = await this.query<any>(
      `SELECT a.COLUMN_NAME, c_pk.TABLE_NAME AS ref_table, b.COLUMN_NAME AS ref_column
       FROM user_cons_columns a
       JOIN user_constraints c ON a.CONSTRAINT_NAME = c.CONSTRAINT_NAME AND c.CONSTRAINT_TYPE = 'R'
       JOIN user_constraints c_pk ON c.R_CONSTRAINT_NAME = c_pk.CONSTRAINT_NAME
       JOIN user_cons_columns b ON b.CONSTRAINT_NAME = c_pk.CONSTRAINT_NAME AND b.POSITION = a.POSITION
       WHERE c.TABLE_NAME = :1`,
      [table]
    )
    return rows.map(r => ({
      column: r.COLUMN_NAME,
      referencedTable: r.REF_TABLE,
      referencedColumn: r.REF_COLUMN,
    }))
  }

  async getProcedures(): Promise<ProcedureInfo[]> {
    const rows = await this.query<any>(
      `SELECT OBJECT_NAME AS name, OBJECT_TYPE AS type
       FROM user_objects
       WHERE OBJECT_TYPE IN ('PROCEDURE','FUNCTION','TRIGGER')
       ORDER BY OBJECT_TYPE, OBJECT_NAME`
    )
    return rows.map(r => ({ name: r.NAME, type: r.TYPE }))
  }

  async validateRecord(table: string, where: Record<string, unknown>): Promise<boolean> {
    const binds: Record<string, unknown> = {}
    const conditions = Object.entries(where)
      .map(([k, v], i) => {
        binds[`p${i}`] = v
        return `"${k}" = :p${i}`
      })
      .join(' AND ')
    const rows = await this.query<any>(`SELECT COUNT(*) AS CNT FROM "${table}" WHERE ${conditions}`, binds)
    return parseInt(rows[0]?.CNT ?? '0') > 0
  }

  async query<T = unknown>(sql: string, params?: unknown[] | Record<string, unknown>): Promise<T[]> {
    const result = await this.conn.execute(sql, params ?? [], { outFormat: oracledb.OUT_FORMAT_OBJECT })
    return result.rows as T[]
  }

  async getSnapshot(): Promise<SchemaSnapshot> {
    const tables = await this.getTables()
    const snapshot: SchemaSnapshot = {
      capturedAt: new Date().toISOString(),
      dbType: 'oracle',
      database: this.config.connectString,
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
