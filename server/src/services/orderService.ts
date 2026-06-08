// ============================================================================
// orderService — SQLite 适配版
// 金额字段: INTEGER(分)，应用层需转换
// ============================================================================

import { pool } from '../config/database.js';
import { generateOrderNo, generateDocNo } from '../utils/numberGenerator.js';
import { formatDuration } from '../utils/response.js';
import { yuanToCents, centsToYuan } from '../types/index.js';
import type {
  OrderInfo, OrderCreate, OrderUpdate,
  PageParams, PaginatedResult,
} from '../types/index.js';

export async function listOrders(
  { page, page_size }: PageParams,
  filters?: {
    order_status?: string; platform_id?: number; customer_id?: number;
    slot_id?: number; order_date_from?: string; order_date_to?: string;
    estimated_delivery_date?: string;
    exclude_statuses?: string;
  }
): Promise<PaginatedResult<OrderInfo>> {
  const conditions: string[] = [];
  const values: any[] = [];

  if (filters?.order_status) { conditions.push('order_status = ?'); values.push(filters.order_status); }
  if (filters?.platform_id) { conditions.push('platform_id = ?'); values.push(filters.platform_id); }
  if (filters?.customer_id) { conditions.push('customer_id = ?'); values.push(filters.customer_id); }
  if (filters?.slot_id) { conditions.push('slot_id = ?'); values.push(filters.slot_id); }
  if (filters?.order_date_from) { conditions.push('order_date >= ?'); values.push(filters.order_date_from); }
  if (filters?.order_date_to) { conditions.push('order_date <= ?'); values.push(filters.order_date_to); }
  if (filters?.estimated_delivery_date) { conditions.push('DATE(estimated_delivery_time) = ?'); values.push(filters.estimated_delivery_date); }
  if (filters?.exclude_statuses) {
    const excludeList = filters.exclude_statuses.split(',').map(s => s.trim()).filter(Boolean);
    if (excludeList.length > 0) {
      conditions.push(`order_status NOT IN (${excludeList.map(() => '?').join(',')})`);
      values.push(...excludeList);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM order_info ${where}`, values);
  const total = Number(countRows[0].total);

  const offset = (page - 1) * page_size;
  const [rows] = await pool.query(
    `SELECT * FROM order_info ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...values, page_size, offset]
  );

  return { list: rows as OrderInfo[], total, page, pageSize: page_size };
}

export async function createOrder(data: OrderCreate): Promise<OrderInfo> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. 获取平台信息
    const [platforms] = await conn.query('SELECT * FROM platform WHERE id = ?', [data.platform_id]);
    if (platforms.length === 0) throw new Error('平台不存在');
    const platform = platforms[0];

    // 2. 生成订单编号
    const orderNo = await generateOrderNo(platform.code, conn, data.order_date);

    // 3. 计算平台抽成 (金额: 元→分)
    const orderAmountCents = yuanToCents(data.order_amount);
    const commissionRate = data.commission_rate ?? platform.commission_rate ?? 0;
    const commissionAmountCents = Math.round(orderAmountCents * commissionRate / 10000);
    const netIncomeCents = orderAmountCents - commissionAmountCents;

    // 4. 校验橱窗状态与容量
    if (data.slot_id) {
      const [slots] = await conn.query(
        'SELECT status, accepted_quantity, max_quantity FROM slot WHERE id = ?', [data.slot_id]
      );
      if (slots.length === 0) throw new Error('橱窗不存在');
      const slot = slots[0];
      if (slot.status !== 'on_sale') throw new Error('橱窗已下架，无法创建订单');
      if (slot.accepted_quantity >= slot.max_quantity) throw new Error('橱窗已满额，无法创建订单');
    }

    // 5. 生成 doc_no
    const docNo = await generateDocNo('PROG', 'order_info', conn, data.order_date);

    // 6. 插入
    const [result] = await conn.query(
      `INSERT INTO order_info (order_no, doc_no, customer_id, platform_id, platform_order_id, slot_id,
        order_amount, commission_rate, commission_amount, net_income, order_date,
        estimated_delivery_time, requirement_desc, order_status, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [orderNo, docNo, data.customer_id, data.platform_id, data.platform_order_id ?? null, data.slot_id ?? null,
        orderAmountCents, commissionRate, commissionAmountCents, netIncomeCents, data.order_date,
        data.estimated_delivery_time ?? null, data.requirement_desc ?? null, data.remark ?? null]
    );

    // 下单即更新客户最近下单日期
    await conn.query("UPDATE customer SET last_order_date = date('now','localtime') WHERE id = ?", [data.customer_id]);
    await conn.commit();

    const [rows] = await pool.query('SELECT * FROM order_info WHERE id = ?', [(result as any).insertId]);
    return rows[0] as OrderInfo;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getOrder(id: number): Promise<{ order_info: OrderInfo; progress_log?: any; delivery_ids?: number[]; payment_ids?: number[] } | null> {
  const [rows] = await pool.query('SELECT * FROM order_info WHERE id = ?', [id]);
  if (rows.length === 0) return null;

  const [logs] = await pool.query(
    'SELECT timer_status, timer_start_time, total_duration, session_duration FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [id]
  );

  const [deliveries] = await pool.query('SELECT id FROM delivery WHERE order_id = ? ORDER BY id', [id]);
  const [payments] = await pool.query('SELECT id FROM payment WHERE order_id = ? ORDER BY id', [id]);

  const progressLog = logs.length > 0 ? {
    ...(logs[0] as any),
    total_duration: formatDuration((logs[0] as any).total_duration),
    session_duration: formatDuration((logs[0] as any).session_duration),
  } : null;

  const orderInfo = {
    ...(rows[0] as any),
    session_duration: formatDuration((rows[0] as any).session_duration),
  };

  return {
    order_info: orderInfo as OrderInfo,
    progress_log: progressLog,
    delivery_ids: (deliveries as any[]).map((d: any) => d.id),
    payment_ids: (payments as any[]).map((p: any) => p.id),
  };
}

export async function updateOrder(id: number, data: OrderUpdate): Promise<OrderInfo | null> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT * FROM order_info WHERE id = ?', [id]);
    if (rows.length === 0) { await conn.rollback(); return null; }
    const order = rows[0] as OrderInfo;

    // slot_id 变更时的稿位容量校验与计数器转移
    const slotChanged = data.slot_id !== undefined && data.slot_id !== order.slot_id;

    if (slotChanged) {
      const oldSlotId = order.slot_id;
      const newSlotId = data.slot_id;

      if (newSlotId !== null && newSlotId !== undefined) {
        const [slots] = await conn.query(
          'SELECT accepted_quantity, max_quantity FROM slot WHERE id = ?', [newSlotId]
        );
        if (slots.length === 0) {
          throw Object.assign(new Error('橱窗不存在'), { status: 400 });
        }
        const slot = slots[0];
        if (slot.accepted_quantity >= slot.max_quantity) {
          throw Object.assign(new Error('该橱窗已满'), { status: 400 });
        }
      }

      if (oldSlotId !== null && oldSlotId !== undefined) {
        await conn.query('UPDATE slot SET accepted_quantity = GREATEST(accepted_quantity - 1, 0) WHERE id = ?', [oldSlotId]);
      }
      if (newSlotId !== null && newSlotId !== undefined) {
        await conn.query('UPDATE slot SET accepted_quantity = accepted_quantity + 1 WHERE id = ?', [newSlotId]);
      }
    }

    // 限制可编辑字段
    const editableByStatus: Record<string, string[]> = {
      pending: ['customer_id', 'platform_id', 'platform_order_id', 'slot_id',
        'order_amount', 'commission_rate', 'order_date',
        'requirement_desc', 'remark'],
      queued: ['requirement_desc', 'remark'],
      in_progress: ['requirement_desc', 'remark'],
      overdue: ['remark'],
      delivered: ['remark'],
      revising: ['remark'],
      settled: [],
      rejected: [],
      cancelled: [],
    };
    const allowed = editableByStatus[order.order_status] || [];

    const fields: string[] = [];
    const values: any[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (!allowed.includes(key)) continue;

      // 金额字段：元→分
      if (key === 'order_amount') {
        fields.push(`order_amount = ?`);
        values.push(yuanToCents(value as number));
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    // 如果修改了金额/抽成，重新计算
    if (data.order_amount !== undefined || data.commission_rate !== undefined) {
      const amtCents = data.order_amount !== undefined ? yuanToCents(data.order_amount) : order.order_amount;
      const rate = data.commission_rate ?? order.commission_rate ?? 0;
      const commissionCents = Math.round(amtCents * rate / 10000);
      const netIncCents = amtCents - commissionCents;
      fields.push('commission_amount = ?', 'net_income = ?');
      values.push(commissionCents, netIncCents);
    }

    if (fields.length === 0) { await conn.rollback(); return order; }
    values.push(id);
    await conn.query(`UPDATE order_info SET ${fields.join(', ')} WHERE id = ?`, values);

    await conn.commit();

    const [updated] = await pool.query('SELECT * FROM order_info WHERE id = ?', [id]);
    return updated[0] as OrderInfo;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getOrderWithProgress(id: number): Promise<any> {
  return getOrder(id);
}

export async function updateDuration(
  id: number,
  total_duration: number,
): Promise<{ order_info: OrderInfo; progress_log: any }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT * FROM order_info WHERE id = ?', [id]);
    if (orders.length === 0) throw new Error('订单不存在');
    const order = orders[0] as OrderInfo;

    if (!['in_progress', 'overdue', 'delivered', 'settled'].includes(order.order_status)) {
      throw new Error('仅 in_progress/overdue/delivered/settled 状态的订单可以修改累计耗时');
    }

    const [logResult] = await conn.query(
      'SELECT id FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1', [id]
    );
    if (logResult.length === 0) throw new Error('该订单无进度记录');

    await conn.query('UPDATE progress_log SET total_duration = ? WHERE id = ?', [total_duration, logResult[0].id]);
    await conn.query('UPDATE order_info SET session_duration = ? WHERE id = ?', [total_duration, id]);

    await conn.commit();

    const [updatedOrder] = await conn.query('SELECT * FROM order_info WHERE id = ?', [id]);
    const [updatedLog] = await conn.query('SELECT * FROM progress_log WHERE id = ?', [logResult[0].id]);

    const log = updatedLog[0] as any;
    return {
      order_info: updatedOrder[0] as OrderInfo,
      progress_log: {
        ...log,
        total_duration: formatDuration(log.total_duration),
        session_duration: formatDuration(log.session_duration),
      },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function deleteOrder(id: number): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT * FROM order_info WHERE id = ?', [id]);
    if (orders.length === 0) { await conn.rollback(); conn.release(); return false; }
    const order = orders[0] as any;

    if (order.slot_id) {
      const status = order.order_status;
      if (['queued', 'in_progress', 'delivered', 'revising', 'overdue', 'settled'].includes(status)) {
        await conn.query('UPDATE slot SET accepted_quantity = GREATEST(accepted_quantity - 1, 0) WHERE id = ?', [order.slot_id]);
      }
      if (status === 'cancelled') {
        await conn.query('UPDATE slot SET cancelled_quantity = GREATEST(cancelled_quantity - 1, 0) WHERE id = ?', [order.slot_id]);
      }
      if (['delivered', 'revising', 'settled'].includes(status)) {
        await conn.query('UPDATE slot SET delivered_quantity = GREATEST(delivered_quantity - 1, 0) WHERE id = ?', [order.slot_id]);
      }
      if (status === 'settled') {
        await conn.query('UPDATE slot SET completed_quantity = GREATEST(completed_quantity - 1, 0) WHERE id = ?', [order.slot_id]);
      }
    }

    if (order.order_status === 'settled') {
      await conn.query(
        `UPDATE customer SET total_spent = GREATEST(COALESCE(total_spent, 0) - ?, 0) WHERE id = ?`,
        [order.net_income || 0, order.customer_id]
      );
    }

    if (['queued', 'in_progress', 'delivered', 'revising', 'overdue', 'settled'].includes(order.order_status)) {
      await conn.query('UPDATE customer SET total_orders = GREATEST(total_orders - 1, 0) WHERE id = ?', [order.customer_id]);
    }

    if (order.order_status === 'cancelled') {
      await conn.query('UPDATE customer SET cancelled_order_count = GREATEST(cancelled_order_count - 1, 0) WHERE id = ?', [order.customer_id]);
    }

    await conn.query('DELETE FROM payment WHERE order_id = ?', [id]);
    await conn.query('DELETE FROM delivery WHERE order_id = ?', [id]);
    await conn.query('DELETE FROM progress_log WHERE order_id = ?', [id]);

    // 重算满意度
    await conn.query(
      `UPDATE customer c SET avg_satisfaction = COALESCE(
         (SELECT ROUND(AVG(d.customer_satisfaction), 2) FROM delivery d JOIN order_info o ON d.order_id = o.id WHERE o.customer_id = c.id AND d.customer_satisfaction IS NOT NULL), 0),
       total_satisfaction = COALESCE(
         (SELECT SUM(d.customer_satisfaction) FROM delivery d JOIN order_info o ON d.order_id = o.id WHERE o.customer_id = c.id AND d.customer_satisfaction IS NOT NULL), 0)
       WHERE c.id = ?`, [order.customer_id]
    );
    if (order.slot_id) {
      await conn.query(
        `UPDATE slot s SET avg_satisfaction = COALESCE(
           (SELECT ROUND(AVG(d.customer_satisfaction), 2) FROM delivery d JOIN order_info o ON d.order_id = o.id WHERE o.slot_id = ? AND d.customer_satisfaction IS NOT NULL), 0)
         WHERE s.id = ?`, [order.slot_id, order.slot_id]
      );
    }

    await conn.query('DELETE FROM order_info WHERE id = ?', [id]);
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
