import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { pool } from '../config/database.js';
import * as svc from '../services/orderService.js';
import { executeTransition } from '../engine/stateMachine.js';
import { success, created, notFound, fail, serverError } from '../utils/response.js';
import { listOrderProgressLogs } from '../services/progressLogService.js';
import { listOrderDeliveries } from '../services/deliveryService.js';
import { listOrderPayments, recordPayment } from '../services/paymentService.js';
import { extractFromImage } from '../services/aiService.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---- fuzzy match helpers ----

interface SlotRow { id: number; name: string; }
interface FuzzyCandidate { id: number; name: string; score: number; }

function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function characterOverlap(a: string, b: string): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let common = 0;
  for (const ch of setA) { if (setB.has(ch)) common++; }
  return common;
}

function fuzzyMatchSlot(ocrName: string, slots: SlotRow[]): {
  match: { slot_id: number; slot_name: string; confidence: number } | null;
  candidates: FuzzyCandidate[];
} {
  const normalized = ocrName.trim().toLowerCase();
  const scored = slots.map(slot => {
    const slotName = slot.name.toLowerCase();
    const dist = levenshteinDistance(normalized, slotName);
    const maxLen = Math.max(normalized.length, slotName.length);
    const levenshteinScore = maxLen === 0 ? 1 : 1 - (dist / maxLen);
    const overlap = characterOverlap(normalized, slotName);
    const overlapScore = maxLen === 0 ? 0 : overlap / maxLen;
    const score = Math.round(((levenshteinScore + overlapScore) / 2) * 10000) / 10000;
    return { id: slot.id, name: slot.name, score };
  });
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 0 && scored[0].score >= 0.4) {
    const best = scored[0];
    return { match: { slot_id: best.id, slot_name: best.name, confidence: best.score }, candidates: [] };
  }
  return { match: null, candidates: scored.slice(0, 5) };
}

// GET /api/v1/orders
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const page_size = parseInt(req.query.page_size as string) || 20;
    const filters = {
      order_status: req.query.order_status as string | undefined,
      platform_id: req.query.platform_id ? parseInt(req.query.platform_id as string) : undefined,
      customer_id: req.query.customer_id ? parseInt(req.query.customer_id as string) : undefined,
      slot_id: req.query.slot_id ? parseInt(req.query.slot_id as string) : undefined,
      order_date_from: req.query.order_date_from as string | undefined,
      order_date_to: req.query.order_date_to as string | undefined,
      estimated_delivery_date: req.query.estimated_delivery_date as string | undefined,
      exclude_statuses: req.query.exclude_statuses as string | undefined,
    };
    const result = await svc.listOrders({ page, page_size }, filters);
    success(res, result);
  } catch (err) { serverError(res, err); }
});

// POST /api/v1/orders
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.customer_id || !data.platform_id || !data.order_amount) {
      return fail(res, 'customer_id, platform_id, order_amount 为必填项');
    }
    if (!data.order_date) data.order_date = new Date().toISOString().slice(0, 10);
    const entity = await svc.createOrder(data);
    created(res, entity);
  } catch (err: any) {
    serverError(res, err);
  }
});

// PATCH /api/v1/orders/check-overdue
router.patch('/check-overdue', async (req: Request, res: Response) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id FROM order_info
       WHERE order_status = 'in_progress' AND estimated_delivery_time IS NOT NULL AND estimated_delivery_time < datetime('now','localtime')`
    );
    let affected = 0;
    for (const row of rows) {
      await conn.query("UPDATE order_info SET order_status = 'overdue' WHERE id = ?", [row.id]);
      affected++;
    }
    await conn.commit();
    success(res, { affected }, `已将 ${affected} 条订单标记为超期`);
  } catch (err) {
    await conn.rollback();
    serverError(res, err);
  } finally { conn.release(); }
});

// GET /api/v1/orders/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const data = await svc.getOrderWithProgress(id);
    if (!data) return notFound(res);
    success(res, data);
  } catch (err) { serverError(res, err); }
});

// PUT /api/v1/orders/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const entity = await svc.updateOrder(id, req.body);
    if (!entity) return notFound(res);
    success(res, entity);
  } catch (err: any) { serverError(res, err); }
});

// ---- State transitions ----

const patchAction = (action: string) => async (req: Request, res: Response) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await executeTransition(conn, action as any, parseInt(req.params.id), req.body);
    if (!result.success) { await conn.rollback(); return fail(res, result.message, 40010, 400); }
    await conn.commit();
    const messages: Record<string, string> = { accept: '接单成功', reject: '已拒单', cancel: '已取消', start: '计时开始', pause: '计时已暂停', resume: '计时继续', complete: '绘制完成', settle: '已结算', 'reset-timer': '计时器已清空' };
    success(res, result.data, messages[action] || '操作成功');
  } catch (err) {
    await conn.rollback();
    serverError(res, err);
  } finally { conn.release(); }
};

router.patch('/:id/accept', patchAction('accept'));
router.patch('/:id/reject', async (req: Request, res: Response) => {
  if (!req.body.refund_reason_id) return fail(res, 'refund_reason_id 为必填项');
  await patchAction('reject')(req, res);
});
router.patch('/:id/cancel', async (req: Request, res: Response) => {
  if (!req.body.refund_reason_id) return fail(res, 'refund_reason_id 为必填项');
  await patchAction('cancel')(req, res);
});
router.patch('/:id/start', patchAction('start'));
router.patch('/:id/pause', patchAction('pause'));
router.patch('/:id/resume', patchAction('resume'));
router.patch('/:id/complete', patchAction('complete'));
router.patch('/:id/revise', patchAction('revise'));
router.patch('/:id/settle', patchAction('settle'));
router.patch('/:id/reset-timer', patchAction('reset-timer'));

// GET /api/v1/orders/:id/progress-logs
router.get('/:id/progress-logs', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const page = parseInt(req.query.page as string) || 1;
    const page_size = parseInt(req.query.page_size as string) || 20;
    const result = await listOrderProgressLogs(id, { page, page_size });
    success(res, result);
  } catch (err) { serverError(res, err); }
});

// GET /api/v1/orders/:id/deliveries
router.get('/:id/deliveries', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const page = parseInt(req.query.page as string) || 1;
    const page_size = parseInt(req.query.page_size as string) || 20;
    const result = await listOrderDeliveries(id, { page, page_size });
    success(res, result);
  } catch (err) { serverError(res, err); }
});

// GET /api/v1/orders/:id/payments
router.get('/:id/payments', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const page = parseInt(req.query.page as string) || 1;
    const page_size = parseInt(req.query.page_size as string) || 20;
    const result = await listOrderPayments(id, { page, page_size });
    success(res, result);
  } catch (err) { serverError(res, err); }
});

// POST /api/v1/orders/:id/payments
router.post('/:id/payments', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const data = req.body;
    if (!data.payment_type) return fail(res, 'payment_type 为必填项');
    if (data.payment_type === 'refund' && !data.amount) return fail(res, '退款记录 amount 为必填项');
    const result = await recordPayment(id, data);
    created(res, result, data.payment_type === 'income' ? '收款已记录' : '退款已记录');
  } catch (err: any) {
    if (err.message.includes('非法的 payment_type')) return fail(res, err.message);
    if (err.message.includes('不存在')) return fail(res, err.message, 40400, 404);
    serverError(res, err);
  }
});

// DELETE /api/v1/orders/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = await svc.deleteOrder(id);
    if (!deleted) return notFound(res, '订单不存在');
    success(res, null, '订单已删除');
  } catch (err: any) { serverError(res, err); }
});

// PATCH /api/v1/orders/:id/update-duration
router.patch('/:id/update-duration', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { total_duration_seconds } = req.body;
    if (total_duration_seconds === undefined || total_duration_seconds === null) return fail(res, 'total_duration_seconds 为必填项');
    if (typeof total_duration_seconds !== 'number' || total_duration_seconds < 0) return fail(res, 'total_duration_seconds 必须为非负数');
    const result = await svc.updateDuration(id, total_duration_seconds);
    success(res, result, '累计耗时已更新');
  } catch (err: any) {
    if (err.message.includes('仅 delivered') || err.message.includes('该订单无进度记录')) return fail(res, err.message);
    serverError(res, err);
  }
});

// POST /api/v1/orders/extract-from-image
router.post('/extract-from-image', upload.single('image'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return fail(res, '请上传图片文件（字段名 image）');
    const imageBase64 = req.file.buffer.toString('base64');

    const extracted = await extractFromImage(imageBase64, '', {}, 'order');

    let customer: { id: number; name: string; confidence: number } | null = null;
    const customerName = extracted.customer_name as string | null;
    if (customerName && customerName.trim()) {
      const [customerRows] = await pool.query(
        'SELECT id, name FROM customer WHERE name LIKE ? LIMIT 1',
        [`%${customerName.trim()}%`],
      );
      if (customerRows.length > 0) {
        const match = customerRows[0];
        const nameLen = customerName.trim().length;
        const matchLen = (match.name as string).length;
        const confidence = Math.min(nameLen / Math.max(matchLen, 1), 1);
        customer = { id: match.id as number, name: match.name as string, confidence };
      }
    }

    let slotMatch: { slot_id: number; slot_name: string; confidence: number } | null = null;
    let slotCandidates: { id: number; name: string; score: number }[] = [];
    const slotName = extracted.slot_name as string | null;
    if (slotName && slotName.trim()) {
      const [slotRows] = await pool.query(
        "SELECT id, name FROM slot WHERE status = 'on_sale'"
      );
      const { match, candidates } = fuzzyMatchSlot(slotName, slotRows as SlotRow[]);
      if (match) {
        slotMatch = match;
        (extracted as any).slot_name = match.slot_name;
        (extracted as any).slot_id = match.slot_id;
      } else { slotCandidates = candidates; }
    }

    success(res, {
      platform: (extracted as any).platform ?? null,
      platform_id: null,
      platform_order_id: (extracted.platform_order_id as string) ?? null,
      slot_id: slotMatch?.slot_id ?? null,
      slot_name: slotMatch?.slot_name ?? (extracted.slot_name as string) ?? null,
      slot_confidence: slotMatch?.confidence ?? 0,
      slot_candidates: slotMatch ? undefined : slotCandidates,
      order_amount: (extracted.order_amount as number) ?? null,
      customer_id: customer?.id ?? null,
      customer_name: customer?.name ?? (extracted.customer_name as string) ?? null,
      customer_confidence: customer?.confidence ?? 0,
    });
  } catch (err: any) {
    serverError(res, err);
  }
});

export default router;
