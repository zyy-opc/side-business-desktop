// ============================================================================
// 状态机引擎 — SQLite 适配版
// 9 状态 + 守卫条件 + 16 条副作用钩子
// ============================================================================

import { pool } from '../config/database.js';
import { formatDuration } from '../utils/response.js';
import type { OrderInfo, OrderStatus } from '../types/index.js';

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending:     ['queued', 'rejected', 'cancelled'],
  queued:      ['in_progress', 'rejected', 'cancelled'],
  in_progress: ['in_progress', 'delivered', 'overdue', 'rejected', 'cancelled'],
  delivered:   ['revising', 'settled', 'rejected', 'cancelled'],
  revising:    ['delivered', 'rejected', 'cancelled'],
  overdue:     ['delivered', 'rejected', 'cancelled'],
  settled:     [],
  rejected:    [],
  cancelled:   [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

// ---- 转换处理器 ----

async function handleAccept(conn: any, orderId: number, order: OrderInfo): Promise<{ data: any }> {
  const slotId = order.slot_id;

  if (slotId) {
    await conn.query('UPDATE slot SET accepted_quantity = accepted_quantity + 1 WHERE id = ?', [slotId]);
  }

  await conn.query("UPDATE customer SET total_orders = total_orders + 1, first_order_date = COALESCE(first_order_date, date('now','localtime')) WHERE id = ?", [order.customer_id]);

  let estimatedDeliveryTime: string | null = null;
  if (slotId) {
    const [slots] = await conn.query('SELECT delivery_method, delivery_time FROM slot WHERE id = ?', [slotId]);
    if (slots.length > 0) {
      const slot = slots[0];
      if (slot.delivery_method === 'before_deadline') {
        estimatedDeliveryTime = toSqliteDatetime(slot.delivery_time);
      } else if (slot.delivery_method === 'after_acceptance') {
        estimatedDeliveryTime = calcAfterAcceptanceTime(slot.delivery_time);
      }
    }
  }

  await conn.query(
    "UPDATE order_info SET order_status = ?, estimated_delivery_time = ?, accepted_time = datetime('now','localtime') WHERE id = ?",
    ['queued', estimatedDeliveryTime, orderId]
  );

  const [lastPL] = await conn.query(
    'SELECT total_duration FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [orderId]
  );
  const inheritedDuration = lastPL.length > 0 ? (lastPL[0].total_duration || 0) : 0;

  await conn.query(
    `INSERT INTO progress_log (order_id, current_progress, timer_status, total_duration, update_time)
     VALUES (?, 'queued', 'idle', ?, datetime('now','localtime'))`,
    [orderId, inheritedDuration]
  );

  let acceptedQty = 0;
  if (slotId) {
    const [slots] = await conn.query(
      'SELECT accepted_quantity, max_quantity, is_auto_close FROM slot WHERE id = ?', [slotId]
    );
    if (slots.length > 0) {
      acceptedQty = slots[0].accepted_quantity;
      const { max_quantity, is_auto_close } = slots[0];
      if (is_auto_close && acceptedQty >= max_quantity) {
        await conn.query(
          "UPDATE slot SET status = 'off_shelf', close_date = date('now','localtime'), close_reason = 'full' WHERE id = ?",
          [slotId]
        );
      }
    }
  }

  return { data: { slot: { accepted_quantity: acceptedQty }, estimated_delivery_time: estimatedDeliveryTime } };
}

async function handleReject(conn: any, orderId: number, params: { refund_reason_id: number; remark?: string }): Promise<{ data: any }> {
  await conn.query(
    "UPDATE order_info SET order_status = ?, refund_reason_id = ? WHERE id = ?",
    ['rejected', params.refund_reason_id, orderId]
  );
  if (params.remark) {
    await conn.query('UPDATE order_info SET remark = ? WHERE id = ?', [params.remark, orderId]);
  }
  const [lastPL] = await conn.query(
    'SELECT total_duration FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [orderId]
  );
  const inheritedDuration = lastPL.length > 0 ? (lastPL[0].total_duration || 0) : 0;
  await conn.query(
    `INSERT INTO progress_log (order_id, current_progress, timer_status, total_duration, progress_desc, update_time)
     VALUES (?, 'rejected', 'idle', ?, ?, datetime('now','localtime'))`,
    [orderId, inheritedDuration, `状态变更为 rejected`]
  );
  return { data: { order_info: { order_status: 'rejected' } } };
}

async function handleCancel(conn: any, orderId: number, order: OrderInfo, params: { refund_reason_id: number; remark?: string }): Promise<{ data: any }> {
  await conn.query(
    "UPDATE order_info SET order_status = ?, refund_reason_id = ? WHERE id = ?",
    ['cancelled', params.refund_reason_id, orderId]
  );
  if (params.remark) {
    await conn.query('UPDATE order_info SET remark = ? WHERE id = ?', [params.remark, orderId]);
  }

  const [lastPL] = await conn.query(
    'SELECT total_duration FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [orderId]
  );
  const inheritedDuration = lastPL.length > 0 ? (lastPL[0].total_duration || 0) : 0;
  await conn.query(
    `INSERT INTO progress_log (order_id, current_progress, timer_status, total_duration, progress_desc, update_time)
     VALUES (?, 'cancelled', 'idle', ?, ?, datetime('now','localtime'))`,
    [orderId, inheritedDuration, `状态变更为 cancelled`]
  );

  let cancelledQty = 0;
  if (order.slot_id) {
    await conn.query('UPDATE slot SET cancelled_quantity = cancelled_quantity + 1 WHERE id = ?', [order.slot_id]);
    const [slots] = await conn.query('SELECT cancelled_quantity FROM slot WHERE id = ?', [order.slot_id]);
    if (slots.length > 0) cancelledQty = slots[0].cancelled_quantity;
  }
  await conn.query('UPDATE customer SET cancelled_order_count = cancelled_order_count + 1 WHERE id = ?', [order.customer_id]);
  return { data: { slot: { cancelled_quantity: cancelledQty } } };
}

async function handleStart(conn: any, orderId: number, order: OrderInfo): Promise<{ data: any }> {
  if (order.order_status === 'queued') {
    await conn.query(
      "UPDATE order_info SET order_status = ?, start_drawing_time = datetime('now','localtime') WHERE id = ?",
      ['in_progress', orderId]
    );
  }

  const [existing] = await conn.query(
    "UPDATE progress_log SET timer_status = 'running', timer_start_time = datetime('now','localtime'), update_time = datetime('now','localtime') WHERE order_id = ? AND id = (SELECT id FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1)",
    [orderId, orderId]
  );

  const [logs] = await conn.query(
    'SELECT timer_status, timer_start_time FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [orderId]
  );
  return { data: { progress_log: logs[0] ?? { timer_status: 'running', timer_start_time: null } } };
}

async function handlePause(conn: any, orderId: number): Promise<{ data: any }> {
  const [logs] = await conn.query(
    "SELECT id, total_duration, timer_start_time FROM progress_log WHERE order_id = ? AND timer_status = 'running' ORDER BY id DESC LIMIT 1",
    [orderId]
  );
  if (logs.length === 0) throw new Error('无正在运行的计时器');

  const log = logs[0];
  const now = new Date();
  const startTime = new Date(log.timer_start_time);
  const sessionSeconds = Math.round((now.getTime() - startTime.getTime()) / 1000);
  const newTotal = (log.total_duration || 0) + sessionSeconds;

  await conn.query(
    "UPDATE progress_log SET timer_status = 'paused', total_duration = ?, session_duration = ?, timer_start_time = NULL, update_time = datetime('now','localtime') WHERE id = ?",
    [newTotal, sessionSeconds, log.id]
  );
  await conn.query('UPDATE order_info SET session_duration = ? WHERE id = ?', [sessionSeconds, orderId]);

  return { data: { progress_log: { timer_status: 'paused', session_duration: formatDuration(sessionSeconds), total_duration: formatDuration(newTotal) } } };
}

async function handleResume(conn: any, orderId: number): Promise<{ data: any }> {
  const [logs] = await conn.query(
    'SELECT id, timer_status FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [orderId]
  );
  if (logs.length === 0) throw new Error('计时器尚未开始，请先点击开始绘制');

  const currentStatus = logs[0].timer_status as string;
  if (currentStatus === 'running') throw new Error('计时器已在运行中');
  if (currentStatus === 'idle') throw new Error('计时器尚未开始，请先点击开始绘制');
  if (currentStatus !== 'paused') throw new Error(`计时器状态异常(${currentStatus})，无法继续`);

  await conn.query(
    "UPDATE progress_log SET timer_status = 'running', timer_start_time = datetime('now','localtime'), update_time = datetime('now','localtime') WHERE id = ?",
    [logs[0].id]
  );

  const [updated] = await conn.query('SELECT timer_status, timer_start_time FROM progress_log WHERE id = ?', [logs[0].id]);
  return { data: { progress_log: updated[0] ?? { timer_status: 'running', timer_start_time: null } } };
}

async function handleComplete(conn: any, orderId: number, order: OrderInfo): Promise<{ data: any }> {
  const [logs] = await conn.query(
    "SELECT id, total_duration, timer_start_time FROM progress_log WHERE order_id = ? AND timer_status IN ('running', 'paused') ORDER BY id DESC LIMIT 1",
    [orderId]
  );

  let sessionSeconds = 0;
  let newTotal = 0;
  if (logs.length > 0) {
    const log = logs[0];
    if (log.timer_status === 'running') {
      const now = new Date();
      const startTime = new Date(log.timer_start_time!);
      sessionSeconds = Math.round((now.getTime() - startTime.getTime()) / 1000);
      newTotal = (log.total_duration || 0) + sessionSeconds;
    } else {
      sessionSeconds = 0;
      newTotal = log.total_duration || 0;
    }
    await conn.query(
      "UPDATE progress_log SET timer_status = 'idle', total_duration = ?, session_duration = ?, timer_start_time = NULL, update_time = datetime('now','localtime') WHERE id = ?",
      [newTotal, sessionSeconds, log.id]
    );
  }

  await conn.query(
    "UPDATE order_info SET order_status = ?, session_duration = ?, actual_delivery_time = datetime('now','localtime') WHERE id = ?",
    ['delivered', sessionSeconds, orderId]
  );

  const [lastPL] = await conn.query(
    'SELECT total_duration FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [orderId]
  );
  const inheritedDuration = lastPL.length > 0 ? (lastPL[0].total_duration || 0) : 0;
  await conn.query(
    `INSERT INTO progress_log (order_id, current_progress, timer_status, total_duration, progress_desc, update_time)
     VALUES (?, 'delivered', 'idle', ?, ?, datetime('now','localtime'))`,
    [orderId, inheritedDuration, `状态变更为 delivered`]
  );

  let deliveredQty = 0;
  if (order.slot_id && order.order_status !== 'revising') {
    await conn.query('UPDATE slot SET delivered_quantity = delivered_quantity + 1 WHERE id = ?', [order.slot_id]);
    const [slots] = await conn.query('SELECT delivered_quantity FROM slot WHERE id = ?', [order.slot_id]);
    if (slots.length > 0) deliveredQty = slots[0].delivered_quantity;
  }

  const [updatedOrder] = await conn.query(
    'SELECT actual_delivery_time FROM order_info WHERE id = ?', [orderId]
  );
  return { data: { slot: { delivered_quantity: deliveredQty }, actual_delivery_time: updatedOrder[0]?.actual_delivery_time } };
}

async function handleResetTimer(conn: any, orderId: number): Promise<{ data: any }> {
  await conn.query(
    "UPDATE progress_log SET timer_status = 'idle', total_duration = 0, session_duration = 0, timer_start_time = NULL, update_time = datetime('now','localtime') WHERE order_id = ? AND id = (SELECT id FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1)",
    [orderId, orderId]
  );
  await conn.query('UPDATE order_info SET session_duration = 0 WHERE id = ?', [orderId]);
  return { data: { message: '计时器已清空' } };
}

async function handleRevise(conn: any, orderId: number): Promise<void> {
  await conn.query("UPDATE order_info SET order_status = 'revising' WHERE id = ?", [orderId]);
  const [lastPL] = await conn.query(
    'SELECT total_duration FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [orderId]
  );
  const inheritedDuration = lastPL.length > 0 ? (lastPL[0].total_duration || 0) : 0;

  await conn.query(
    "INSERT INTO progress_log (order_id, current_progress, timer_status, total_duration, update_time) VALUES (?, 'revising', 'idle', ?, datetime('now','localtime'))",
    [orderId, inheritedDuration]
  );
}

async function handleSettle(conn: any, orderId: number, order: OrderInfo): Promise<{ data: any }> {
  const [payments] = await conn.query(
    `SELECT SUM(CASE WHEN payment_type='income' AND payment_status='received' THEN amount ELSE 0 END) AS total_income,
            SUM(CASE WHEN payment_type='refund' THEN amount ELSE 0 END) AS total_refund
     FROM payment WHERE order_id = ?`,
    [orderId]
  );
  const totalIncome = Number(payments[0].total_income) || 0;
  const totalRefund = Number(payments[0].total_refund) || 0;
  const netReceived = totalIncome - totalRefund;
  const netIncome = Number(order.net_income) || 0;

  if (netReceived < netIncome) {
    throw new Error(`收款未达标：净收款 ${netReceived} < 应收 ${netIncome}`);
  }

  await conn.query(
    "UPDATE order_info SET order_status = ?, actual_settlement_time = datetime('now','localtime') WHERE id = ?",
    ['settled', orderId]
  );

  const [lastPL] = await conn.query(
    'SELECT total_duration FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [orderId]
  );
  const inheritedDuration = lastPL.length > 0 ? (lastPL[0].total_duration || 0) : 0;
  await conn.query(
    `INSERT INTO progress_log (order_id, current_progress, timer_status, total_duration, progress_desc, update_time)
     VALUES (?, 'settled', 'idle', ?, ?, datetime('now','localtime'))`,
    [orderId, inheritedDuration, `状态变更为 settled`]
  );

  let completedQty = 0;
  if (order.slot_id) {
    await conn.query('UPDATE slot SET completed_quantity = completed_quantity + 1 WHERE id = ?', [order.slot_id]);
    const [slots] = await conn.query('SELECT completed_quantity FROM slot WHERE id = ?', [order.slot_id]);
    if (slots.length > 0) completedQty = slots[0].completed_quantity;
  }

  await conn.query(
    `UPDATE customer SET total_spent = COALESCE(total_spent, 0) + ?,
     last_order_date = date('now','localtime') WHERE id = ?`,
    [netReceived, order.customer_id]
  );

  const [customers] = await conn.query(
    'SELECT total_orders, total_spent FROM customer WHERE id = ?', [order.customer_id]
  );

  return { data: { slot: { completed_quantity: completedQty }, customer: customers[0] ?? { total_orders: 0, total_spent: 0 } } };
}

// ============================================================================
// 公开 API
// ============================================================================

export interface TransitionParams {
  action: 'accept' | 'reject' | 'cancel' | 'start' | 'pause' | 'resume' | 'complete' | 'revise' | 'settle' | 'reset-timer';
  orderId: number;
  params?: any;
}

const ACTION_TO_STATUS: Record<TransitionParams['action'], OrderStatus> = {
  accept:   'queued',
  reject:   'rejected',
  cancel:   'cancelled',
  start:    'in_progress',
  pause:    'in_progress',
  resume:   'in_progress',
  complete: 'delivered',
  revise:   'revising',
  settle:   'settled',
  'reset-timer': 'in_progress',
};

const TERMINAL_STATUSES = ['settled', 'rejected', 'cancelled'];

export async function executeTransition(
  conn: any,
  action: TransitionParams['action'],
  orderId: number,
  params?: any
): Promise<{ success: boolean; message: string; data?: any }> {
  const [rows] = await conn.query('SELECT * FROM order_info WHERE id = ?', [orderId]);
  if (rows.length === 0) return { success: false, message: '订单不存在' };
  const order = rows[0] as OrderInfo;

  if (action === 'pause') {
    if (order.order_status !== 'in_progress' && order.order_status !== 'overdue') {
      return { success: false, message: `当前状态 ${order.order_status} 不允许暂停` };
    }
    try {
      const result = await handlePause(conn, orderId);
      return { success: true, message: '计时已暂停', data: result.data };
    } catch (e: any) { return { success: false, message: e.message }; }
  }

  if (action === 'resume') {
    if (order.order_status !== 'in_progress' && order.order_status !== 'overdue') {
      return { success: false, message: `当前状态 ${order.order_status} 不允许继续` };
    }
    try {
      const result = await handleResume(conn, orderId);
      return { success: true, message: '计时继续', data: result.data };
    } catch (e: any) { return { success: false, message: e.message }; }
  }

  if (action === 'reset-timer') {
    if (order.order_status !== 'in_progress' && order.order_status !== 'overdue') {
      return { success: false, message: `当前状态 ${order.order_status} 不允许清空计时器` };
    }
    try {
      const result = await handleResetTimer(conn, orderId);
      return { success: true, message: '计时器已清空', data: result.data };
    } catch (e: any) { return { success: false, message: e.message }; }
  }

  if (action === 'start' && order.order_status === 'overdue') {
    try {
      const result = await handleStart(conn, orderId, order);
      return { success: true, message: '计时已开始', data: result.data };
    } catch (e: any) { return { success: false, message: e.message }; }
  }

  const targetStatus = ACTION_TO_STATUS[action];
  if (!canTransition(order.order_status, targetStatus)) {
    return { success: false, message: `当前状态 ${order.order_status} 不允许此操作 (→ ${targetStatus})` };
  }

  if (TERMINAL_STATUSES.includes(order.order_status)) {
    return { success: false, message: `订单已为终态 ${order.order_status}，不允许操作` };
  }

  try {
    let result: { data?: any } = {};
    switch (action) {
      case 'accept': result = await handleAccept(conn, orderId, order); break;
      case 'reject': result = await handleReject(conn, orderId, params); break;
      case 'cancel': result = await handleCancel(conn, orderId, order, params); break;
      case 'start': result = await handleStart(conn, orderId, order); break;
      case 'complete':
        if (order.order_status === 'revising') {
          return { success: false, message: '修改后请使用交付确认（POST /deliveries），避免重复计数已交付数量' };
        }
        result = await handleComplete(conn, orderId, order);
        break;
      case 'revise': await handleRevise(conn, orderId); break;
      case 'settle': result = await handleSettle(conn, orderId, order); break;
    }
    return { success: true, message: `${action} 操作成功`, data: result.data };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ---- 辅助函数 ----

function calcAfterAcceptanceTime(deliveryTime: string): string {
  const match = deliveryTime.match(/^(\d+)([hd])$/i);
  if (!match) return deliveryTime;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase() === 'h' ? 'hours' : 'days';
  // 用 JS 计算
  const now = new Date();
  if (unit === 'hours') {
    now.setHours(now.getHours() + value);
  } else {
    now.setDate(now.getDate() + value);
  }
  return toSqliteDatetime(now.toISOString());
}

function toSqliteDatetime(dt: string): string {
  if (dt.includes('T')) {
    return dt.replace('T', ' ').replace(/\.\d+Z?$/, '').replace('Z', '');
  }
  return dt;
}
