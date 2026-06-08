// ============================================================================
// 外键引用检查工具 — SQLite 适配版
// ============================================================================

import { pool } from '../config/database.js';

interface RefCheck {
  table: string;
  column: string;
}

const ALLOWED_TABLES = ['slot', 'order_info', 'slot_type', 'customer', 'payment'];
const ALLOWED_COLUMNS = ['slot_type_id', 'slot_id', 'customer_id', 'order_id'];

export async function checkReferences(id: string | number, refs: RefCheck[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const { table, column } of refs) {
    if (!ALLOWED_TABLES.includes(table) || !ALLOWED_COLUMNS.includes(column)) {
      throw new Error(`Invalid reference check: ${table}.${column}`);
    }
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${table} WHERE ${column} = ?`, [id]
    );
    result[table] = Number(rows[0].cnt);
  }
  return result;
}

export function sumReferences(refs: Record<string, number>): number {
  return Object.values(refs).reduce((a, b) => a + b, 0);
}
