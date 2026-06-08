// ============================================================================
// refundReasonService — SQLite 适配版
// ============================================================================

import { pool } from '../config/database.js';
import type { RefundReason, RefundReasonCreate, RefundReasonUpdate, PageParams, PaginatedResult } from '../types/index.js';

export async function listRefundReasons(
  { page, page_size }: PageParams,
  filters?: { applicable_type?: string; status?: string }
): Promise<PaginatedResult<RefundReason>> {
  const conditions: string[] = [];
  const values: any[] = [];

  if (filters?.applicable_type) {
    conditions.push('applicable_type IN (?, ?)');
    values.push(filters.applicable_type, 'all');
  }
  if (filters?.status) {
    conditions.push('status = ?');
    values.push(filters.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM refund_reason ${where}`, values);
  const total = Number(countRows[0].total);

  const offset = (page - 1) * page_size;
  const [rows] = await pool.query(
    `SELECT * FROM refund_reason ${where} ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?`,
    [...values, page_size, offset]
  );

  return { list: rows as RefundReason[], total, page, pageSize: page_size };
}

export async function createRefundReason(data: RefundReasonCreate): Promise<RefundReason> {
  const [result] = await pool.query(
    `INSERT INTO refund_reason (name, applicable_type, description, sort_order) VALUES (?, ?, ?, ?)`,
    [data.name, data.applicable_type, data.description ?? null, data.sort_order ?? 0]
  );
  const [rows] = await pool.query('SELECT * FROM refund_reason WHERE id = ?', [(result as any).insertId]);
  return rows[0] as RefundReason;
}

export async function getRefundReason(id: number): Promise<RefundReason | null> {
  const [rows] = await pool.query('SELECT * FROM refund_reason WHERE id = ?', [id]);
  return rows.length > 0 ? (rows[0] as RefundReason) : null;
}

export async function updateRefundReason(id: number, data: RefundReasonUpdate): Promise<RefundReason | null> {
  const existing = await getRefundReason(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return existing;

  values.push(id);
  await pool.query(`UPDATE refund_reason SET ${fields.join(', ')} WHERE id = ?`, values);
  return getRefundReason(id);
}

export async function setRefundReasonStatus(id: number, status: string): Promise<RefundReason | null> {
  const existing = await getRefundReason(id);
  if (!existing) return null;
  await pool.query('UPDATE refund_reason SET status = ? WHERE id = ?', [status, id]);
  return getRefundReason(id);
}

export async function deleteRefundReason(id: number): Promise<void> {
  await pool.query('DELETE FROM refund_reason WHERE id = ?', [id]);
}
