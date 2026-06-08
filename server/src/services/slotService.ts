// ============================================================================
// slotService — SQLite 适配版
// ============================================================================

import { pool } from '../config/database.js';
import type { Slot, SlotCreate, SlotUpdate, PageParams, PaginatedResult, OrderInfo } from '../types/index.js';

const SLOT_JOIN_FIELDS = `s.id, s.name, COALESCE(st.name, s.type_name) AS type_name, s.slot_type_id,
  s.category, s.category_desc, s.current_price, s.min_price, s.max_price,
  s.max_quantity, s.accepted_quantity, s.cancelled_quantity,
  s.delivered_quantity, s.completed_quantity, s.avg_satisfaction,
  s.delivery_method, s.delivery_time, s.is_auto_close,
  s.status, s.close_date, s.close_reason, s.sort_order,
  s.description, s.remark, s.created_at, s.updated_at`;

export async function listSlots(
  { page, page_size }: PageParams,
  filters?: { status?: string; category?: string }
): Promise<PaginatedResult<Slot>> {
  const conditions: string[] = [];
  const values: any[] = [];

  if (filters?.status) {
    conditions.push('s.status = ?');
    values.push(filters.status);
  }
  if (filters?.category) {
    conditions.push('s.category = ?');
    values.push(filters.category);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM slot s ${where}`, values);
  const total = Number(countRows[0].total);

  const offset = (page - 1) * page_size;
  const [rows] = await pool.query(
    `SELECT ${SLOT_JOIN_FIELDS}
     FROM slot s
     LEFT JOIN slot_type st ON s.slot_type_id = st.id
     ${where}
     ORDER BY s.sort_order ASC, s.id ASC LIMIT ? OFFSET ?`,
    [...values, page_size, offset]
  );

  return { list: rows as Slot[], total, page, pageSize: page_size };
}

export async function createSlot(data: SlotCreate): Promise<Slot> {
  const [result] = await pool.query(
    `INSERT INTO slot (name, slot_type_id, status, category, category_desc, current_price, min_price, max_price, max_quantity,
      delivery_method, delivery_time, is_auto_close, sort_order, description, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name, data.slot_type_id, 'pending_publish', data.category ?? 'normal', data.category_desc ?? null,
      data.current_price, data.min_price ?? null, data.max_price ?? null, data.max_quantity,
      data.delivery_method, data.delivery_time,
      data.is_auto_close ?? 0, data.sort_order ?? 0, data.description ?? null, data.remark ?? null,
    ]
  );
  const insertId = (result as any).insertId;
  const [rows] = await pool.query(
    `SELECT ${SLOT_JOIN_FIELDS} FROM slot s LEFT JOIN slot_type st ON s.slot_type_id = st.id WHERE s.id = ?`,
    [insertId]
  );
  return rows[0] as Slot;
}

export async function getSlot(id: number): Promise<Slot | null> {
  const [rows] = await pool.query(
    `SELECT ${SLOT_JOIN_FIELDS} FROM slot s LEFT JOIN slot_type st ON s.slot_type_id = st.id WHERE s.id = ?`,
    [id]
  );
  return rows.length > 0 ? (rows[0] as Slot) : null;
}

export async function updateSlot(id: number, data: SlotUpdate): Promise<Slot | null> {
  const existing = await getSlot(id);
  if (!existing) return null;

  if (!['pending_publish', 'on_sale', 'off_shelf'].includes(existing.status)) {
    throw new Error(`当前状态 ${existing.status} 不允许编辑`);
  }

  const fields: string[] = [];
  const values: any[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (data.current_price !== undefined) {
    const newPrice = data.current_price;
    if (existing.min_price === null || newPrice < existing.min_price) {
      fields.push('min_price = ?');
      values.push(newPrice);
    }
    if (existing.max_price === null || newPrice > existing.max_price) {
      fields.push('max_price = ?');
      values.push(newPrice);
    }
  }

  if (fields.length === 0) return existing;

  values.push(id);
  await pool.query(`UPDATE slot SET ${fields.join(', ')} WHERE id = ?`, values);
  return getSlot(id);
}

export async function publishSlot(id: number): Promise<Slot> {
  const existing = await getSlot(id);
  if (!existing) throw new Error('橱窗不存在');
  if (existing.status !== 'pending_publish') {
    throw new Error(`当前状态 ${existing.status} 不允许上架`);
  }
  await pool.query("UPDATE slot SET status = 'on_sale' WHERE id = ?", [id]);
  return (await getSlot(id))!;
}

export async function offShelfSlot(id: number, reason: string): Promise<Slot> {
  const existing = await getSlot(id);
  if (!existing) throw new Error('橱窗不存在');
  if (existing.status !== 'on_sale') {
    throw new Error(`当前状态 ${existing.status} 不允许下架`);
  }
  await pool.query(
    "UPDATE slot SET status = 'off_shelf', close_date = date('now','localtime'), close_reason = ? WHERE id = ?",
    [reason, id]
  );
  return (await getSlot(id))!;
}

export async function relistSlot(id: number): Promise<Slot> {
  const existing = await getSlot(id);
  if (!existing) throw new Error('橱窗不存在');
  if (existing.status !== 'off_shelf') {
    throw new Error(`当前状态 ${existing.status} 不允许重新上架`);
  }
  await pool.query("UPDATE slot SET status = 'on_sale', close_date = NULL, close_reason = NULL WHERE id = ?", [id]);
  return (await getSlot(id))!;
}

export async function getSlotOrders(
  slotId: number,
  { page, page_size }: PageParams
): Promise<PaginatedResult<OrderInfo>> {
  const [countRows] = await pool.query(
    'SELECT COUNT(*) AS total FROM order_info WHERE slot_id = ?', [slotId]
  );
  const total = Number(countRows[0].total);

  const offset = (page - 1) * page_size;
  const [rows] = await pool.query(
    'SELECT * FROM order_info WHERE slot_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    [slotId, page_size, offset]
  );

  return { list: rows as OrderInfo[], total, page, pageSize: page_size };
}

export async function deleteSlot(id: number): Promise<void> {
  await pool.query('DELETE FROM slot WHERE id = ?', [id]);
}
