// ============================================================================
// SQLite database — sql.js 封装 (替换 mysql2 pool)
// 所有数据存储在 %APPDATA%/side-business-system/data/main.db
// 金额字段: INTEGER(分) 存储，通过 centsToYuan/yuanToCents 转换
// ============================================================================

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { getDataPath } from './paths.js';

let db: Database | null = null;
let SQL: SqlJsStatic | null = null;

/** 获取数据库文件路径 */
export function getDbPath(): string {
  return path.join(getDataPath(), 'main.db');
}

/** 初始化 sql.js 并加载/创建数据库 */
export async function initDatabase(): Promise<Database> {
  if (db) return db;

  SQL = await initSqlJs();

  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
  db.run('PRAGMA busy_timeout=5000');

  return db;
}

export function getDatabase(): Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

/** 执行 SQL 查询（返回行数组） */
export function queryAll(sql: string, params?: any[]): any[] {
  const database = getDatabase();
  const stmt = database.prepare(sql);
  if (params) stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/** 执行 DML，返回 lastInsertRowid 和 changes */
export function run(sql: string, params?: any[]): { lastInsertRowid: number; changes: number } {
  const database = getDatabase();
  database.run(sql, params);
  const lastId = (() => {
    const r = queryAll('SELECT last_insert_rowid() AS id');
    return r[0]?.id ?? 0;
  })();
  return { lastInsertRowid: lastId, changes: database.getRowsModified() };
}

/** 持久化数据库 */
export function saveDatabase(): void {
  const d = getDatabase();
  const data = d.export();
  fs.writeFileSync(getDbPath(), Buffer.from(data));
}

/** 关闭数据库 */
export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    SQL = null;
  }
}

// ============================================================================
// MySQL pool 兼容层 — 使现有 service 代码无需大规模重写
// ============================================================================

/**
 * 兼容 mysql2 pool.query():
 *   const [rows] = await pool.query(sql, params);
 * 返回 [rows_array, null_fields]
 */
export const pool = {
  async query(sql: string, params?: any[]): Promise<[any[], any]> {
    let cleanSql = sql
      .replace(/\bFOR UPDATE\b/gi, '')
      .replace(/\bUSE\s+\w+\s*;/gi, '')
      .replace(/FROM\s+dwd\./gi, 'FROM ')
      .replace(/FROM\s+dws\./gi, 'FROM ')
      .replace(/FROM\s+ads\./gi, 'FROM ')
      .replace(/FROM\s+ods_draw\./gi, 'FROM ')
      .replace(/JOIN\s+dwd\./gi, 'JOIN ')
      .replace(/JOIN\s+dws\./gi, 'JOIN ')
      .replace(/JOIN\s+ads\./gi, 'JOIN ')
      .replace(/JOIN\s+ods_draw\./gi, 'JOIN ')
      .replace(/\bNOW\(\)/gi, "datetime('now','localtime')")
      .replace(/\bCURDATE\(\)/gi, "date('now','localtime')")
      .replace(/DATE_ADD\(NOW\(\),\s*INTERVAL\s+(\d+)\s+HOUR\)/gi, "datetime('now','localtime','+$1 hours')")
      .replace(/DATE_ADD\(NOW\(\),\s*INTERVAL\s+(\d+)\s+DAY\)/gi, "datetime('now','localtime','+$1 days')")
      .replace(/DATE_FORMAT\(([^,]+),\s*'%Y-%m'\)/gi, "strftime('%Y-%m', $1)")
      .replace(/DATE_FORMAT\(([^,]+),\s*'%Y-%u'\)/gi, "strftime('%Y-%W', $1)")
      .replace(/DATE_FORMAT\(([^,]+),\s*'%Y-%m-%d'\)/gi, "strftime('%Y-%m-%d', $1)")
      .replace(/DATEDIFF\(([^,]+),\s*([^)]+)\)/gi, "CAST(julianday($1) - julianday($2) AS INTEGER)")
      .replace(/\bTRUNCATE\s+TABLE\b/gi, 'DELETE FROM')
      .replace(/INFORMATION_SCHEMA\s*\.\s*TABLES/gi, 'sqlite_master')
      .replace(/TABLE_SCHEMA\s*=\s*'[^']*'\s+AND\s+/gi, '')
      .replace(/table_schema\s*=\s*'[^']*'\s+AND\s+/gi, '')
      .replace(/TABLE_NAME/gi, 'tbl_name');

    const trimmed = cleanSql.trim().toUpperCase();
    const isSelect = trimmed.startsWith('SELECT') || trimmed.startsWith('WITH') || trimmed.startsWith('PRAGMA');
    const isInsert = trimmed.startsWith('INSERT');
    const isUpdate = trimmed.startsWith('UPDATE');
    const isDelete = trimmed.startsWith('DELETE') || trimmed.startsWith('DROP');

    if (isSelect) {
      const rows = queryAll(cleanSql, params);
      return [rows, null];
    }

    // DML: INSERT/UPDATE/DELETE — 返回 { insertId, affectedRows } 数组
    const db = getDatabase();
    db.run(cleanSql, params);
    const changes = db.getRowsModified();
    let insertId = 0;
    if (isInsert) {
      const idRow = queryAll('SELECT last_insert_rowid() AS id');
      insertId = (idRow[0] as any)?.id ?? 0;
    }
    const result = { insertId, affectedRows: changes };
    return [[result], null];
  },

  async getConnection(): Promise<any> {
    return {
      query: async (sql: string, params?: any[]) => {
        let cleanSql = sql
          .replace(/\bFOR UPDATE\b/gi, '')
          .replace(/FROM\s+dwd\./gi, 'FROM ')
          .replace(/FROM\s+dws\./gi, 'FROM ')
          .replace(/FROM\s+ads\./gi, 'FROM ')
          .replace(/FROM\s+ods_draw\./gi, 'FROM ')
          .replace(/JOIN\s+dwd\./gi, 'JOIN ')
          .replace(/JOIN\s+dws\./gi, 'JOIN ')
          .replace(/JOIN\s+ads\./gi, 'JOIN ')
          .replace(/JOIN\s+ods_draw\./gi, 'JOIN ')
          .replace(/\bNOW\(\)/gi, "datetime('now','localtime')")
          .replace(/\bCURDATE\(\)/gi, "date('now','localtime')")
          .replace(/DATE_ADD\(NOW\(\),\s*INTERVAL\s+(\d+)\s+HOUR\)/gi, "datetime('now','localtime','+$1 hours')")
          .replace(/DATE_ADD\(NOW\(\),\s*INTERVAL\s+(\d+)\s+DAY\)/gi, "datetime('now','localtime','+$1 days')")
          .replace(/DATE_FORMAT\(([^,]+),\s*'%Y-%m'\)/gi, "strftime('%Y-%m', $1)")
          .replace(/DATE_FORMAT\(([^,]+),\s*'%Y-%u'\)/gi, "strftime('%Y-%W', $1)")
          .replace(/DATE_FORMAT\(([^,]+),\s*'%Y-%m-%d'\)/gi, "strftime('%Y-%m-%d', $1)")
          .replace(/DATEDIFF\(([^,]+),\s*([^)]+)\)/gi, "CAST(julianday($1) - julianday($2) AS INTEGER)")
          .replace(/\bTRUNCATE\s+TABLE\b/gi, 'DELETE FROM')
          .replace(/INFORMATION_SCHEMA\s*\.\s*TABLES/gi, 'sqlite_master')
          .replace(/TABLE_SCHEMA\s*=\s*'[^']*'\s+AND\s+/gi, '')
          .replace(/table_schema\s*=\s*'[^']*'\s+AND\s+/gi, '')
          .replace(/TABLE_NAME/gi, 'tbl_name');

        const rows = queryAll(cleanSql, params);
        return [rows];
      },
      beginTransaction: () => getDatabase().run('BEGIN TRANSACTION'),
      commit: () => getDatabase().run('COMMIT'),
      rollback: () => getDatabase().run('ROLLBACK'),
      release: () => {},
    };
  },
};
