// ============================================================================
// calendarService — SQLite 适配版
// ============================================================================

import { pool } from '../config/database.js';

export interface CalendarDay {
  date: string;
  slot_count: number;
  delivery_count: number;
  slot_orders: number[];
  delivery_orders: number[];
}

export interface CalendarResult {
  days: CalendarDay[];
}

export async function getCalendar(year: number, month: number): Promise<CalendarResult> {
  const daysInMonth = new Date(year, month, 0).getDate();

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const nextMonthStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;

  const [slotRows] = await pool.query(
    `SELECT id, DATE(estimated_delivery_time) AS deadline_date
     FROM order_info
     WHERE estimated_delivery_time IS NOT NULL
       AND order_status NOT IN ('settled', 'rejected', 'cancelled')
       AND estimated_delivery_time >= ?
       AND estimated_delivery_time < ?`,
    [`${monthStr}-01`, `${nextMonthStr}-01`]
  );

  const [deliveryRows] = await pool.query(
    `SELECT d.id, d.order_id, DATE(d.delivery_time) AS delivery_date
     FROM delivery d
     WHERE d.delivery_time >= ?
       AND d.delivery_time < ?`,
    [`${monthStr}-01`, `${nextMonthStr}-01`]
  );

  const days: CalendarDay[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;

    const slotOrderIds = slotRows
      .filter((r: any) => r.deadline_date === dateStr)
      .map((r: any) => r.id as number);

    const deliveryOrderIds = deliveryRows
      .filter((r: any) => r.delivery_date === dateStr)
      .map((r: any) => r.order_id as number);

    days.push({
      date: dateStr,
      slot_count: slotOrderIds.length,
      delivery_count: deliveryOrderIds.length,
      slot_orders: slotOrderIds,
      delivery_orders: deliveryOrderIds,
    });
  }

  return { days };
}
