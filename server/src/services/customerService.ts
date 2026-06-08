// ============================================================================
// customerService — SQLite 适配版
// ============================================================================

import { pool } from '../config/database.js';
import type { Customer, CustomerCreate, CustomerUpdate, OrderInfo, PageParams, PaginatedResult } from '../types/index.js';

export async function listCustomers(
  { page, page_size }: PageParams,
  filters?: { platform_id?: number; keyword?: string }
): Promise<PaginatedResult<Customer>> {
  const conditions: string[] = [];
  const values: any[] = [];

  if (filters?.platform_id) {
    conditions.push('platform_id = ?');
    values.push(filters.platform_id);
  }
  if (filters?.keyword) {
    conditions.push('(name LIKE ? OR customer_uid LIKE ?)');
    const kw = `%${filters.keyword}%`;
    values.push(kw, kw);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM customer ${where}`, values);
  const total = Number(countRows[0].total);

  const offset = (page - 1) * page_size;
  const [rows] = await pool.query(
    `SELECT * FROM customer ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...values, page_size, offset]
  );

  return { list: rows as Customer[], total, page, pageSize: page_size };
}

export async function createCustomer(data: CustomerCreate): Promise<Customer> {
  const [result] = await pool.query(
    `INSERT INTO customer (customer_uid, name, platform_id, remark) VALUES (?, ?, ?, ?)`,
    [data.customer_uid, data.name, data.platform_id, data.remark ?? null]
  );
  const [rows] = await pool.query('SELECT * FROM customer WHERE id = ?', [(result as any).insertId]);
  return rows[0] as Customer;
}

export async function getCustomer(id: number): Promise<Customer | null> {
  const [rows] = await pool.query('SELECT * FROM customer WHERE id = ?', [id]);
  return rows.length > 0 ? (rows[0] as Customer) : null;
}

export async function updateCustomer(id: number, data: CustomerUpdate): Promise<Customer | null> {
  const existing = await getCustomer(id);
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
  await pool.query(`UPDATE customer SET ${fields.join(', ')} WHERE id = ?`, values);
  return getCustomer(id);
}

export async function getCustomerOrders(
  customerId: number,
  { page, page_size }: PageParams
): Promise<PaginatedResult<OrderInfo>> {
  const [countRows] = await pool.query(
    'SELECT COUNT(*) AS total FROM order_info WHERE customer_id = ?', [customerId]
  );
  const total = Number(countRows[0].total);

  const offset = (page - 1) * page_size;
  const [rows] = await pool.query(
    'SELECT * FROM order_info WHERE customer_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    [customerId, page_size, offset]
  );

  return { list: rows as OrderInfo[], total, page, pageSize: page_size };
}

export async function setCustomerStatus(id: number, status: string): Promise<Customer | null> {
  const existing = await getCustomer(id);
  if (!existing) return null;
  await pool.query('UPDATE customer SET status = ? WHERE id = ?', [status, id]);
  return getCustomer(id);
}

export async function deleteCustomer(id: number): Promise<void> {
  await pool.query('DELETE FROM customer WHERE id = ?', [id]);
}
