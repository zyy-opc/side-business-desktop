// ============================================================================
// 编号生成器 — SQLite 适配版
// ============================================================================

import { queryAll } from '../config/database.js';

/**
 * 生成订单编号: ORD-{平台编码}-YYYYMMDD-{序号}
 * 序号为 4 位，当日该平台下从 0001 递增
 */
export async function generateOrderNo(platformCode: string, _conn: any, orderDate: string): Promise<string> {
  const datePart = orderDate.replace(/-/g, '').slice(0, 8);
  const prefix = `ORD-${platformCode}-${datePart}-`;

  // 查找当日最大序号
  const rows = queryAll(
    `SELECT order_no FROM order_info
     WHERE order_no LIKE ?
     ORDER BY order_no DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (rows.length > 0) {
    const lastNo = rows[0].order_no as string;
    const lastSeq = parseInt(lastNo.split('-').pop() || '0', 10);
    seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * 生成单据编号: {prefix}-YYYYMMDD-NNNN
 */
export async function generateDocNo(prefix: string, _table: string, _conn: any, date: string): Promise<string> {
  const datePart = date.replace(/-/g, '').slice(0, 8);
  const likePattern = `${prefix}-${datePart}-%`;

  const rows = queryAll(
    `SELECT doc_no FROM order_info
     WHERE doc_no LIKE ?
     ORDER BY doc_no DESC LIMIT 1`,
    [likePattern]
  );

  let seq = 1;
  if (rows.length > 0) {
    const lastNo = rows[0].doc_no as string;
    const lastSeq = parseInt(lastNo.split('-').pop() || '0', 10);
    seq = lastSeq + 1;
  }

  return `${prefix}-${datePart}-${String(seq).padStart(4, '0')}`;
}
