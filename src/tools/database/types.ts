export interface TableInfo {
  name: string
  rowCount?: number
  schema?: string
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  defaultValue?: string
  isPrimaryKey: boolean
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
}

export interface FKInfo {
  column: string
  referencedTable: string
  referencedColumn: string
}

export interface ProcedureInfo {
  name: string
  type: 'PROCEDURE' | 'FUNCTION' | 'TRIGGER'
}

export interface SchemaSnapshot {
  capturedAt: string
  dbType: string
  database: string
  tables: Record<string, {
    columns: ColumnInfo[]
    indexes: IndexInfo[]
    foreignKeys: FKInfo[]
  }>
}

export interface SchemaDiff {
  tablesAdded: string[]
  tablesRemoved: string[]
  tablesModified: Record<string, {
    columnsAdded: string[]
    columnsRemoved: string[]
    columnsModified: string[]
  }>
  hasChanges: boolean
}

export interface DbAdapter {
  connect(): Promise<void>
  disconnect(): Promise<void>
  getTables(): Promise<TableInfo[]>
  getColumns(table: string): Promise<ColumnInfo[]>
  getIndexes(table: string): Promise<IndexInfo[]>
  getForeignKeys(table: string): Promise<FKInfo[]>
  getProcedures(): Promise<ProcedureInfo[]>
  validateRecord(table: string, where: Record<string, unknown>): Promise<boolean>
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
  getSnapshot(): Promise<SchemaSnapshot>
}
