// ============================================================================
// platformService — SQLite 适配版
// ============================================================================

import { pool } from '../config/database.js';
import type { Platform, PlatformCreate, PlatformUpdate, PageParams, PaginatedResult } from '../types/index.js';

export async function listPlatforms(
  { page, page_size }: PageParams,
  filters?: { status?: string }
): Promise<PaginatedResult<Platform>> {
  const conditions: string[] = [];
  const values: any[] = [];

  if (filters?.status) {
    conditions.push('status = ?');
    values.push(filters.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM platform ${where}`, values);
  const total = Number(countRows[0].total);

  const offset = (page - 1) * page_size;
  const [rows] = await pool.query(
    `SELECT * FROM platform ${where} ORDER BY sort_order ASC, id ASC LIMIT ? OFFSET ?`,
    [...values, page_size, offset]
  );

  return { list: rows as Platform[], total, page, pageSize: page_size };
}

export async function createPlatform(data: PlatformCreate): Promise<Platform> {
  const [result] = await pool.query(
    `INSERT INTO platform (name, code, platform_type, url, commission_rate, sort_order, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.name, data.code, data.platform_type ?? 'commission', data.url ?? null, data.commission_rate ?? null, data.sort_order ?? 0, data.remark ?? null]
  );
  const [rows] = await pool.query('SELECT * FROM platform WHERE id = ?', [(result as any).insertId]);
  return rows[0] as Platform;
}

export async function getPlatform(id: number): Promise<Platform | null> {
  const [rows] = await pool.query('SELECT * FROM platform WHERE id = ?', [id]);
  return rows.length > 0 ? (rows[0] as Platform) : null;
}

export async function updatePlatform(id: number, data: PlatformUpdate): Promise<Platform | null> {
  const existing = await getPlatform(id);
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
  await pool.query(`UPDATE platform SET ${fields.join(', ')} WHERE id = ?`, values);

  return getPlatform(id);
}

export async function setPlatformStatus(id: number, status: string): Promise<Platform | null> {
  const existing = await getPlatform(id);
  if (!existing) return null;
  await pool.query('UPDATE platform SET status = ? WHERE id = ?', [status, id]);
  return getPlatform(id);
}

export async function deletePlatform(id: number): Promise<void> {
  await pool.query('DELETE FROM platform WHERE id = ?', [id]);
}
