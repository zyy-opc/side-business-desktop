// ============================================================================
// slotTypeService — SQLite 适配版
// ============================================================================

import { pool } from '../config/database.js';
import type { SlotType, SlotTypeCreate, SlotTypeUpdate, PageParams, PaginatedResult } from '../types/index.js';

export async function listSlotTypes(
  { page, page_size }: PageParams,
  filters?: { name?: string }
): Promise<PaginatedResult<SlotType>> {
  const conditions: string[] = [];
  const values: any[] = [];

  if (filters?.name) {
    conditions.push('name LIKE ?');
    values.push(`%${filters.name}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM slot_type ${where}`, values);
  const total = Number(countRows[0].total);

  const offset = (page - 1) * page_size;
  const [rows] = await pool.query(
    `SELECT * FROM slot_type ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...values, page_size, offset]
  );

  return { list: rows as SlotType[], total, page, pageSize: page_size };
}

export async function createSlotType(data: SlotTypeCreate): Promise<SlotType> {
  const [result] = await pool.query(
    `INSERT INTO slot_type (id, name) VALUES (?, ?)`,
    [data.id, data.name]
  );
  const [rows] = await pool.query('SELECT * FROM slot_type WHERE id = ?', [data.id]);
  return rows[0] as SlotType;
}

export async function getSlotType(id: string): Promise<SlotType | null> {
  const [rows] = await pool.query('SELECT * FROM slot_type WHERE id = ?', [id]);
  return rows.length > 0 ? (rows[0] as SlotType) : null;
}

export async function updateSlotType(id: string, data: SlotTypeUpdate): Promise<SlotType | null> {
  const existing = await getSlotType(id);
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
  await pool.query(`UPDATE slot_type SET ${fields.join(', ')} WHERE id = ?`, values);

  return getSlotType(id);
}

export async function deleteSlotType(id: string): Promise<void> {
  await pool.query('DELETE FROM slot_type WHERE id = ?', [id]);
}
