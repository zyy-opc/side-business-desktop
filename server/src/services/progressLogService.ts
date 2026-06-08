// ============================================================================
// progressLogService — SQLite 适配版
// ============================================================================

import { pool } from '../config/database.js';
import { formatDuration } from '../utils/response.js';
import type { ProgressLog, ProgressLogCreate, ProgressOrderRecord, PageParams, PaginatedResult } from '../types/index.js';

export async function createProgressLog(data: ProgressLogCreate): Promise<ProgressLog> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT order_status FROM order_info WHERE id = ?', [data.order_id]);
    if (orders.length === 0) throw new Error('订单不存在');

    const status = orders[0].order_status;
    if (!['queued', 'in_progress', 'overdue', 'revising'].includes(status)) {
      throw new Error(`订单状态 ${status} 不允许新建进度记录`);
    }

    const [lastPL] = await conn.query(
      'SELECT total_duration FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1',
      [data.order_id]
    );
    const inheritedDuration = lastPL.length > 0 ? (lastPL[0].total_duration || 0) : 0;

    const [result] = await conn.query(
      `INSERT INTO progress_log (order_id, current_progress, timer_status, total_duration, progress_desc, attachment_desc, session_duration, update_time)
       VALUES (?, ?, 'idle', ?, ?, ?, ?, datetime('now','localtime'))`,
      [data.order_id, data.current_progress, inheritedDuration, data.progress_desc ?? null, data.attachment_desc ?? null, data.session_duration ?? null]
    );

    await conn.commit();

    const [rows] = await pool.query('SELECT * FROM progress_log WHERE id = ?', [(result as any).insertId]);
    return rows[0] as ProgressLog;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function listProgressOrders(
  { page, page_size }: PageParams,
  filters?: { order_status?: string; include_settled?: boolean; settlement_date?: string }
): Promise<PaginatedResult<ProgressOrderRecord>> {
  const conditions: string[] = [];
  const values: any[] = [];

  if (filters?.include_settled) {
    conditions.push("o.order_status IN ('queued', 'in_progress', 'overdue', 'revising', 'settled', 'delivered')");
  } else {
    conditions.push("o.order_status IN ('queued', 'in_progress', 'overdue', 'revising')");
  }

  if (filters?.order_status) {
    conditions.push('o.order_status = ?');
    values.push(filters.order_status);
  }

  if (filters?.settlement_date) {
    conditions.push('DATE(o.actual_settlement_time) = ?');
    values.push(filters.settlement_date);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM order_info o ${where}`, values
  );
  const total = Number(countRows[0].total);

  const offset = (page - 1) * page_size;
  const [rows] = await pool.query(
    `SELECT o.id, o.order_no, o.customer_id, o.platform_id, o.order_status,
            o.accepted_time,
            pl.current_progress, pl.timer_status, pl.total_duration,
            pl.update_time AS last_progress_time
     FROM order_info o
     LEFT JOIN progress_log pl ON pl.id = (
       SELECT id FROM progress_log WHERE order_id = o.id ORDER BY id DESC LIMIT 1
     )
     ${where}
     ORDER BY
       CASE WHEN o.actual_settlement_time IS NULL THEN 0 ELSE 1 END,
       o.accepted_time ASC
     LIMIT ? OFFSET ?`,
    [...values, page_size, offset]
  );

  return { list: rows.map((row: any) => ({
    ...row,
    total_duration: formatDuration(row.total_duration),
  })) as ProgressOrderRecord[], total, page, pageSize: page_size };
}

export async function listOrderProgressLogs(
  orderId: number,
  { page, page_size }: PageParams
): Promise<PaginatedResult<ProgressLog>> {
  const [countRows] = await pool.query(
    'SELECT COUNT(*) AS total FROM progress_log WHERE order_id = ?', [orderId]
  );
  const total = Number(countRows[0].total);

  const offset = (page - 1) * page_size;
  const [rows] = await pool.query(
    `SELECT pl.*,
            CASE pl.current_progress
              WHEN 'queued' THEN oi.accepted_time
              WHEN 'in_progress' THEN oi.start_drawing_time
              WHEN 'delivered' THEN oi.actual_delivery_time
              WHEN 'settled' THEN oi.actual_settlement_time
              ELSE pl.update_time
            END AS status_time
     FROM progress_log pl
     INNER JOIN order_info oi ON oi.id = pl.order_id
     WHERE pl.order_id = ?
     ORDER BY pl.update_time DESC
     LIMIT ? OFFSET ?`,
    [orderId, page_size, offset]
  );

  return { list: rows.map((row: any) => ({
    ...row,
    total_duration: formatDuration(row.total_duration),
    session_duration: formatDuration(row.session_duration),
  })) as ProgressLog[], total, page, pageSize: page_size };
}
