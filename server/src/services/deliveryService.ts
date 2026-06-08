// ============================================================================
// deliveryService — SQLite 适配版
// ============================================================================

import { pool } from '../config/database.js';
import { generateDocNo } from '../utils/numberGenerator.js';
import type { Delivery, DeliveryCreate, DeliveryRevise, DeliveryUpdate, OrderInfo, PageParams, PaginatedResult, PageQuery } from '../types/index.js';

export async function listDeliveries(
  query: PageQuery & { is_accepted?: string }
): Promise<PaginatedResult<Delivery>> {
  const page = parseInt(query.page || '1', 10) || 1;
  const pageSize = parseInt(query.page_size || '20', 10) || 20;
  const offset = (page - 1) * pageSize;
  let where = '';
  const params: any[] = [];
  if (query.is_accepted !== undefined && query.is_accepted !== '') {
    where = 'WHERE d.is_accepted = ?';
    params.push(parseInt(query.is_accepted, 10));
  }
  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM delivery d ${where}`, params);
  const total = Number(countRows[0].total);
  params.push(pageSize, offset);
  const [rows] = await pool.query(
    `SELECT d.*, o.order_no FROM delivery d JOIN order_info o ON d.order_id = o.id ${where} ORDER BY d.delivery_time DESC LIMIT ? OFFSET ?`, params);
  return { list: rows as Delivery[], total, page, pageSize };
}

export async function confirmDelivery(data: DeliveryCreate): Promise<{ delivery: Delivery }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT * FROM order_info WHERE id = ?', [data.order_id]);
    if (orders.length === 0) throw new Error('订单不存在');

    const order = orders[0] as OrderInfo;
    if (!['delivered', 'revising'].includes(order.order_status)) {
      throw new Error(`订单状态 ${order.order_status} 不允许确认交付`);
    }

    if (data.is_accepted !== 1) {
      throw new Error('确认交付要求 is_accepted=1');
    }

    const [revCount] = await conn.query(
      "SELECT COUNT(*) AS cnt FROM progress_log WHERE order_id = ? AND current_progress = 'revising'",
      [data.order_id]
    );
    const revisionCount = Number(revCount[0].cnt);

    await conn.query(
      `UPDATE order_info SET order_status = 'delivered', actual_delivery_time = datetime('now','localtime') WHERE id = ?`,
      [data.order_id]
    );

    const [lastPL] = await conn.query(
      'SELECT total_duration FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1',
      [data.order_id]
    );
    const inheritedDuration = lastPL.length > 0 ? (lastPL[0].total_duration || 0) : 0;

    await conn.query(
      `INSERT INTO progress_log (order_id, current_progress, timer_status, total_duration, progress_desc, update_time)
       VALUES (?, 'delivered', 'idle', ?, ?, datetime('now','localtime'))`,
      [data.order_id, inheritedDuration, `状态变更为 delivered`]
    );

    // 交付记录 UPSERT
    let deliveryId: number;
    const [existingDelivery] = await conn.query('SELECT id, doc_no FROM delivery WHERE order_id = ?', [data.order_id]);
    if (existingDelivery.length > 0) {
      await conn.query(
        `UPDATE delivery SET delivery_time = datetime('now','localtime'), delivery_desc = ?, revision_count = ?, is_accepted = 1, customer_rating = ?, customer_satisfaction = ?, remark = ? WHERE id = ?`,
        [data.delivery_desc ?? null, revisionCount, data.customer_rating ?? null, data.customer_satisfaction ?? null, data.remark ?? null, existingDelivery[0].id]
      );
      deliveryId = existingDelivery[0].id;
    } else {
      const docNo = await generateDocNo('DLVY', 'delivery', conn, new Date().toISOString().slice(0, 10));
      const [result] = await conn.query(
        `INSERT INTO delivery (doc_no, order_id, delivery_time, delivery_desc, revision_count, is_accepted, customer_rating, customer_satisfaction, remark)
         VALUES (?, ?, datetime('now','localtime'), ?, ?, 1, ?, ?, ?)`,
        [docNo, data.order_id, data.delivery_desc ?? null, revisionCount, data.customer_rating ?? null, data.customer_satisfaction ?? null, data.remark ?? null]
      );
      deliveryId = (result as any).insertId;
    }

    if (data.customer_rating != null) {
      await updateCustomerRating(conn, order.customer_id);
    }
    if (data.customer_satisfaction != null) {
      await updateCustomerSatisfaction(conn, order.customer_id);
      if (order.slot_id) {
        await updateSlotSatisfaction(conn, order.slot_id);
      }
    }

    await conn.commit();

    const [delivery] = await pool.query('SELECT * FROM delivery WHERE id = ?', [deliveryId]);
    return { delivery: delivery[0] as Delivery };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function requestRevision(data: DeliveryRevise): Promise<{ delivery: Delivery }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT * FROM order_info WHERE id = ?', [data.order_id]);
    if (orders.length === 0) throw new Error('订单不存在');

    const order = orders[0] as OrderInfo;
    if (!['delivered', 'revising'].includes(order.order_status)) {
      throw new Error(`订单状态 ${order.order_status} 不允许退回修改`);
    }

    if (data.is_accepted !== 0) {
      throw new Error('退回修改要求 is_accepted=0');
    }

    const [revCount] = await conn.query(
      "SELECT COUNT(*) AS cnt FROM progress_log WHERE order_id = ? AND current_progress = 'revising'",
      [data.order_id]
    );
    const revisionCount = Number(revCount[0].cnt);

    await conn.query(
      "UPDATE order_info SET order_status = 'revising' WHERE id = ?",
      [data.order_id]
    );

    // 交付记录 UPSERT
    let deliveryId: number;
    const [existingDelivery] = await conn.query('SELECT id, doc_no FROM delivery WHERE order_id = ?', [data.order_id]);
    if (existingDelivery.length > 0) {
      await conn.query(
        `UPDATE delivery SET delivery_time = datetime('now','localtime'), delivery_desc = ?, revision_count = ?, is_accepted = 0, customer_rating = ?, customer_satisfaction = ?, remark = ? WHERE id = ?`,
        [data.delivery_desc ?? null, revisionCount, data.customer_rating ?? null, data.customer_satisfaction ?? null, data.remark ?? null, existingDelivery[0].id]
      );
      deliveryId = existingDelivery[0].id;
    } else {
      const docNo = await generateDocNo('DLVY', 'delivery', conn, new Date().toISOString().slice(0, 10));
      const [result] = await conn.query(
        `INSERT INTO delivery (doc_no, order_id, delivery_time, delivery_desc, revision_count, is_accepted, customer_rating, customer_satisfaction, remark)
         VALUES (?, ?, datetime('now','localtime'), ?, ?, 0, ?, ?, ?)`,
        [docNo, data.order_id, data.delivery_desc ?? null, revisionCount, data.customer_rating ?? null, data.customer_satisfaction ?? null, data.remark ?? null]
      );
      deliveryId = (result as any).insertId;
    }

    const [lastPL] = await conn.query(
      'SELECT total_duration FROM progress_log WHERE order_id = ? ORDER BY id DESC LIMIT 1',
      [data.order_id]
    );
    const inheritedDuration = lastPL.length > 0 ? (lastPL[0].total_duration || 0) : 0;

    await conn.query(
      "INSERT INTO progress_log (order_id, current_progress, timer_status, total_duration, update_time) VALUES (?, 'revising', 'idle', ?, datetime('now','localtime'))",
      [data.order_id, inheritedDuration]
    );

    if (data.customer_rating != null) {
      await updateCustomerRating(conn, order.customer_id);
    }
    if (data.customer_satisfaction != null) {
      await updateCustomerSatisfaction(conn, order.customer_id);
      if (order.slot_id) {
        await updateSlotSatisfaction(conn, order.slot_id);
      }
    }

    await conn.commit();

    const [delivery] = await pool.query('SELECT * FROM delivery WHERE id = ?', [deliveryId]);
    return { delivery: delivery[0] as Delivery };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function listOrderDeliveries(
  orderId: number,
  { page, page_size }: PageParams
): Promise<PaginatedResult<Delivery>> {
  const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM delivery WHERE order_id = ?', [orderId]);
  const total = Number(countRows[0].total);

  const offset = (page - 1) * page_size;
  const [rows] = await pool.query(
    'SELECT * FROM delivery WHERE order_id = ? ORDER BY delivery_time DESC LIMIT ? OFFSET ?',
    [orderId, page_size, offset]
  );
  return { list: rows as Delivery[], total, page, pageSize: page_size };
}

async function updateCustomerRating(conn: any, customerId: number): Promise<void> {
  await conn.query(
    `UPDATE customer c
     SET avg_rating = (SELECT ROUND(AVG(d.customer_rating), 2) FROM delivery d
                        JOIN order_info o ON d.order_id = o.id
                        WHERE o.customer_id = ? AND d.customer_rating IS NOT NULL),
         total_rating = (SELECT COALESCE(SUM(d.customer_rating), 0) FROM delivery d
                         JOIN order_info o ON d.order_id = o.id
                         WHERE o.customer_id = ? AND d.customer_rating IS NOT NULL)
     WHERE c.id = ?`,
    [customerId, customerId, customerId]
  );
}

async function updateCustomerSatisfaction(conn: any, customerId: number): Promise<void> {
  await conn.query(
    `UPDATE customer c
     SET avg_satisfaction = (SELECT ROUND(AVG(d.customer_satisfaction), 2) FROM delivery d
                              JOIN order_info o ON d.order_id = o.id
                              WHERE o.customer_id = ? AND d.customer_satisfaction IS NOT NULL),
         total_satisfaction = (SELECT COALESCE(SUM(d.customer_satisfaction), 0) FROM delivery d
                               JOIN order_info o ON d.order_id = o.id
                               WHERE o.customer_id = ? AND d.customer_satisfaction IS NOT NULL)
     WHERE c.id = ?`,
    [customerId, customerId, customerId]
  );
}

async function updateSlotSatisfaction(conn: any, slotId: number): Promise<void> {
  await conn.query(
    `UPDATE slot s
     SET avg_satisfaction = (SELECT ROUND(AVG(d.customer_satisfaction), 2) FROM delivery d
                              JOIN order_info o ON d.order_id = o.id
                              WHERE o.slot_id = ? AND d.customer_satisfaction IS NOT NULL)
     WHERE s.id = ?`,
    [slotId, slotId]
  );
}

export async function getDelivery(id: number): Promise<Delivery | null> {
  const [rows] = await pool.query("SELECT * FROM delivery WHERE id = ?", [id]);
  if (rows.length === 0) return null;
  return rows[0] as Delivery;
}

export async function updateDelivery(id: number, data: DeliveryUpdate): Promise<Delivery | null> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query("SELECT * FROM delivery WHERE id = ?", [id]);
    if (rows.length === 0) { await conn.rollback(); return null; }
    const delivery = rows[0] as Delivery;

    const fields: string[] = [];
    const values: any[] = [];
    const allowedFields = ["delivery_desc", "is_accepted", "customer_rating", "customer_satisfaction", "remark"];

    for (const key of allowedFields) {
      if ((data as any)[key] !== undefined) {
        fields.push(key + " = ?");
        values.push((data as any)[key]);
      }
    }

    if (fields.length > 0) {
      values.push(id);
      await conn.query("UPDATE delivery SET " + fields.join(", ") + " WHERE id = ?", values);
    }

    if (data.customer_rating !== undefined || data.customer_satisfaction !== undefined) {
      const [orders] = await conn.query("SELECT * FROM order_info WHERE id = ?", [delivery.order_id]);
      if (orders.length > 0) {
        const order = orders[0] as OrderInfo;
        if (data.customer_rating !== undefined) {
          await updateCustomerRating(conn, order.customer_id);
        }
        if (data.customer_satisfaction !== undefined) {
          await updateCustomerSatisfaction(conn, order.customer_id);
          if (order.slot_id) {
            await updateSlotSatisfaction(conn, order.slot_id);
          }
        }
      }
    }

    await conn.commit();

    const [updated] = await pool.query("SELECT * FROM delivery WHERE id = ?", [id]);
    return updated[0] as Delivery;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function deleteDelivery(id: number): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT * FROM delivery WHERE id = ?', [id]);
    if (rows.length === 0) { await conn.rollback(); conn.release(); return false; }
    const delivery = rows[0] as Delivery;

    await conn.query('DELETE FROM delivery WHERE id = ?', [id]);

    const [remaining] = await conn.query(
      'SELECT COUNT(*) AS cnt FROM delivery WHERE order_id = ?', [delivery.order_id]
    );
    if (remaining[0].cnt === 0) {
      await conn.query(
        "UPDATE order_info SET order_status = 'in_progress', actual_delivery_time = NULL WHERE id = ?",
        [delivery.order_id]
      );
    }

    const [orders] = await conn.query('SELECT * FROM order_info WHERE id = ?', [delivery.order_id]);
    if (orders.length > 0) {
      const order = orders[0] as any;
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
    }

    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
