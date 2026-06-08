// ============================================================================
// paymentService — SQLite 适配版
// 金额字段: INTEGER(分)
// ============================================================================

import { pool } from '../config/database.js';
import { generateDocNo } from '../utils/numberGenerator.js';
import { yuanToCents } from '../types/index.js';
import type {
  Payment, PaymentCreate, PaymentIncomeCreate, PaymentRefundCreate,
  PaymentUpdate, OrderInfo, PageParams, PaginatedResult,
} from '../types/index.js';

export interface PaymentStats {
  totalOrderAmount: number;
  settledAmount: number;
  pendingAmount: number;
}

export async function recordIncome(data: PaymentIncomeCreate): Promise<{ payment: Payment; should_settle: boolean }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT * FROM order_info WHERE id = ?', [data.order_id]);
    if (orders.length === 0) throw new Error('订单不存在');

    const [existing] = await conn.query(
      'SELECT id FROM payment WHERE order_id = ? AND payment_type = ? LIMIT 1',
      [data.order_id, 'income']
    );
    if (existing.length > 0) {
      throw new Error('该订单已存在收款记录（income），每个订单最多 1 条收款记录');
    }

    const docNo = await generateDocNo('PMNT', 'payment', conn, new Date().toISOString().slice(0, 10));

    const today = new Date().toISOString().slice(0, 10);
    const orderAmountCents = Number(orders[0].order_amount) || 0;
    const amountCents = data.amount !== undefined ? yuanToCents(data.amount) : orderAmountCents;

    const [result] = await conn.query(
      `INSERT INTO payment (doc_no, order_id, payment_type, payment_status, record_date, arrival_date, amount, payment_method, is_platform_settlement, remark)
       VALUES (?, ?, 'income', ?, ?, ?, ?, ?, ?, ?)`,
      [docNo, data.order_id, data.payment_status ?? 'received', data.record_date ?? today,
        data.arrival_date ?? today, amountCents, data.payment_method ?? null, data.is_platform_settlement ?? 1, data.remark ?? null]
    );

    const [payment] = await pool.query('SELECT * FROM payment WHERE id = ?', [(result as any).insertId]);

    const { should_settle } = await checkSettlementConditions(conn, data.order_id);

    await conn.commit();

    return { payment: payment[0] as Payment, should_settle };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function recordRefund(data: PaymentRefundCreate): Promise<{ payment: Payment; should_refund: boolean }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT * FROM order_info WHERE id = ?', [data.order_id]);
    if (orders.length === 0) throw new Error('订单不存在');

    const [existing] = await conn.query(
      'SELECT id FROM payment WHERE order_id = ? AND payment_type = ? LIMIT 1',
      [data.order_id, 'refund']
    );
    if (existing.length > 0) {
      throw new Error('该订单已存在退款记录（refund），每个订单最多 1 条退款记录');
    }

    const docNo = await generateDocNo('PMNT', 'payment', conn, new Date().toISOString().slice(0, 10));

    const amountCents = yuanToCents(data.amount);

    const [result] = await conn.query(
      `INSERT INTO payment (doc_no, order_id, payment_type, payment_status, record_date, arrival_date, amount, payment_method, is_platform_settlement, refund_reason_id, remark)
       VALUES (?, ?, 'refund', 'received', ?, ?, ?, ?, 0, ?, ?)`,
      [docNo, data.order_id, data.record_date ?? new Date().toISOString().slice(0, 10),
        data.arrival_date ?? null, amountCents, data.payment_method ?? null, data.refund_reason_id, data.remark ?? null]
    );

    const [payment] = await pool.query('SELECT * FROM payment WHERE id = ?', [(result as any).insertId]);

    const { should_refund } = await checkRefundConditions(conn, data.order_id);

    await conn.commit();

    return { payment: payment[0] as Payment, should_refund };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function recordPayment(orderId: number, data: PaymentCreate): Promise<{
  payment: Payment;
  should_settle: boolean;
  should_refund: boolean;
}> {
  const ALLOWED_PAYMENT_TYPES = ['income', 'refund'];
  if (!ALLOWED_PAYMENT_TYPES.includes(data.payment_type)) {
    throw new Error(`非法的 payment_type: ${data.payment_type}，仅允许 income 或 refund`);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT * FROM order_info WHERE id = ?', [orderId]);
    if (orders.length === 0) throw new Error('订单不存在');

    if (data.payment_type === 'refund' && !data.refund_reason_id) {
      throw new Error('退款类型必须填写 refund_reason_id');
    }

    const [existing] = await conn.query(
      'SELECT id FROM payment WHERE order_id = ? AND payment_type = ? LIMIT 1',
      [orderId, data.payment_type]
    );
    if (existing.length > 0) {
      throw new Error(`该订单已存在${data.payment_type === 'income' ? '收款' : '退款'}记录，每个订单每种类型最多 1 条`);
    }

    const docNo = await generateDocNo('PMNT', 'payment', conn, new Date().toISOString().slice(0, 10));

    const today = new Date().toISOString().slice(0, 10);
    const isIncome = data.payment_type === 'income';
    const orderAmountCents = Number(orders[0].order_amount) || 0;
    const amountCents = isIncome ? (data.amount !== undefined ? yuanToCents(data.amount) : orderAmountCents) : yuanToCents(data.amount);
    const arrivalDate = isIncome ? (data.arrival_date ?? today) : (data.arrival_date ?? null);
    const isPlatformSettlement = isIncome ? (data.is_platform_settlement ?? 1) : (data.is_platform_settlement ?? 0);

    const [result] = await conn.query(
      `INSERT INTO payment (doc_no, order_id, payment_type, payment_status, record_date, arrival_date, amount, payment_method, is_platform_settlement, refund_reason_id, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [docNo, orderId, data.payment_type, data.payment_status ?? 'received', data.record_date ?? today,
        arrivalDate, amountCents, data.payment_method ?? null, isPlatformSettlement,
        data.refund_reason_id ?? null, data.remark ?? null]
    );

    const [payment] = await pool.query('SELECT * FROM payment WHERE id = ?', [(result as any).insertId]);

    const settlement = await checkSettlementConditions(conn, orderId);
    const refund = await checkRefundConditions(conn, orderId);

    await conn.commit();

    return { payment: payment[0] as Payment, should_settle: settlement.should_settle, should_refund: refund.should_refund };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function listOrderPayments(
  orderId: number,
  { page, page_size }: PageParams
): Promise<PaginatedResult<Payment>> {
  const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM payment WHERE order_id = ?', [orderId]);
  const total = Number(countRows[0].total);

  const offset = (page - 1) * page_size;
  const [rows] = await pool.query(
    'SELECT * FROM payment WHERE order_id = ? ORDER BY record_date DESC, id DESC LIMIT ? OFFSET ?',
    [orderId, page_size, offset]
  );
  return { list: rows as Payment[], total, page, pageSize: page_size };
}

async function checkSettlementConditions(conn: any, orderId: number): Promise<{ should_settle: boolean; total_income: number; total_refund: number }> {
  const [payments] = await conn.query(
    `SELECT SUM(CASE WHEN payment_type='income' AND payment_status='received' THEN amount ELSE 0 END) AS total_income,
            SUM(CASE WHEN payment_type='refund' THEN amount ELSE 0 END) AS total_refund
     FROM payment WHERE order_id = ?`,
    [orderId]
  );
  const totalIncome = Number(payments[0].total_income) || 0;
  const totalRefund = Number(payments[0].total_refund) || 0;
  const netReceived = totalIncome - totalRefund;

  const [orders] = await conn.query('SELECT net_income, order_status FROM order_info WHERE id = ?', [orderId]);
  if (orders.length === 0) return { should_settle: false, total_income: totalIncome, total_refund: totalRefund };

  const netIncome = Number(orders[0].net_income) || 0;
  const status = orders[0].order_status;

  const should_settle = status === 'delivered' && netReceived >= netIncome;
  return { should_settle, total_income: totalIncome, total_refund: totalRefund };
}

async function checkRefundConditions(conn: any, orderId: number): Promise<{ should_refund: boolean; total_income: number; total_refund: number }> {
  const [payments] = await conn.query(
    `SELECT SUM(CASE WHEN payment_type='income' AND payment_status='received' THEN amount ELSE 0 END) AS total_income,
            SUM(CASE WHEN payment_type='refund' THEN amount ELSE 0 END) AS total_refund
     FROM payment WHERE order_id = ?`,
    [orderId]
  );
  const totalIncome = Number(payments[0].total_income) || 0;
  const totalRefund = Number(payments[0].total_refund) || 0;

  const should_refund = totalRefund >= totalIncome && totalIncome > 0;
  return { should_refund, total_income: totalIncome, total_refund: totalRefund };
}

export async function getPayment(id: number): Promise<Payment | null> {
  const [rows] = await pool.query("SELECT * FROM payment WHERE id = ?", [id]);
  if (rows.length === 0) return null;
  return rows[0] as Payment;
}

export async function updatePayment(id: number, data: PaymentUpdate): Promise<Payment | null> {
  const [rows] = await pool.query("SELECT * FROM payment WHERE id = ?", [id]);
  if (rows.length === 0) return null;

  const fields: string[] = [];
  const values: any[] = [];
  const allowedFields = ["payment_type", "amount", "payment_status", "record_date", "arrival_date", "payment_method", "is_platform_settlement", "refund_reason_id", "remark"];

  for (const key of allowedFields) {
    if ((data as any)[key] !== undefined) {
      // amount 字段：元→分
      if (key === 'amount') {
        fields.push("amount = ?");
        values.push(yuanToCents((data as any)[key]));
      } else {
        fields.push(key + " = ?");
        values.push((data as any)[key]);
      }
    }
  }

  if (fields.length === 0) return rows[0] as Payment;

  values.push(id);
  await pool.query("UPDATE payment SET " + fields.join(", ") + " WHERE id = ?", values);

  const [updated] = await pool.query("SELECT * FROM payment WHERE id = ?", [id]);
  return updated[0] as Payment;
}

export async function getPaymentStats(startDate: string, endDate: string): Promise<PaymentStats> {
  const [rows] = await pool.query(
    `SELECT
       (SELECT COALESCE(SUM(order_amount), 0) FROM order_info WHERE order_date BETWEEN ? AND ?) AS totalOrderAmount,
       (SELECT COALESCE(SUM(p.amount), 0) FROM payment p JOIN order_info o ON p.order_id = o.id
        WHERE o.order_date BETWEEN ? AND ? AND p.payment_type = 'income' AND p.payment_status = 'received') AS settledAmount`,
    [startDate, endDate, startDate, endDate]
  );

  const totalOrderAmount = Number(rows[0].totalOrderAmount) || 0;
  const settledAmount = Number(rows[0].settledAmount) || 0;

  return {
    totalOrderAmount,
    settledAmount,
    pendingAmount: parseFloat((totalOrderAmount - settledAmount).toFixed(2)),
  };
}

export async function listPayments(
  { page, page_size }: PageParams,
  filters?: {
    payment_type?: string; order_id?: number;
    record_date_from?: string; record_date_to?: string;
    arrival_date_from?: string; arrival_date_to?: string;
  }
): Promise<PaginatedResult<Payment>> {
  const conditions: string[] = [];
  const values: any[] = [];

  if (filters?.payment_type) { conditions.push('p.payment_type = ?'); values.push(filters.payment_type); }
  if (filters?.order_id) { conditions.push('p.order_id = ?'); values.push(filters.order_id); }

  const dateConditions: string[] = [];
  if (filters?.record_date_from) { dateConditions.push('(p.record_date >= ? AND p.record_date <= ?)'); values.push(filters.record_date_from, filters.record_date_to ?? filters.record_date_from); }
  if (filters?.arrival_date_from) { dateConditions.push('(p.arrival_date >= ? AND p.arrival_date <= ?)'); values.push(filters.arrival_date_from, filters.arrival_date_to ?? filters.arrival_date_from); }
  if (dateConditions.length > 0) {
    conditions.push(`(${dateConditions.join(' OR ')})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM payment p ${where}`, values);
  const total = Number(countRows[0].total);

  const offset = (page - 1) * page_size;
  const [rows] = await pool.query(
    `SELECT p.*, o.order_no FROM payment p JOIN order_info o ON p.order_id = o.id ${where} ORDER BY p.record_date DESC, p.id DESC LIMIT ? OFFSET ?`,
    [...values, page_size, offset]
  );
  return { list: rows as Payment[], total, page, pageSize: page_size };
}

export async function deletePayment(id: number): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT * FROM payment WHERE id = ?', [id]);
    if (rows.length === 0) { await conn.rollback(); conn.release(); return false; }

    await conn.query('DELETE FROM payment WHERE id = ?', [id]);

    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
