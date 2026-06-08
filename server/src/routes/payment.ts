import { Router, type Request, type Response } from 'express';
import * as svc from '../services/paymentService.js';
import { success, created, notFound, fail, serverError } from '../utils/response.js';

const router = Router();

router.post('/income', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.order_id) return fail(res, 'order_id 为必填项');
    if (data.payment_type !== undefined && data.payment_type !== 'income') return fail(res, 'payment_type 仅允许 income');
    const result = await svc.recordIncome(data);
    created(res, result, '收款已记录');
  } catch (err: any) {
    if (err.message.includes('不存在')) return fail(res, err.message, 40400, 404);
    serverError(res, err);
  }
});

router.post('/refund', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.order_id || !data.amount || !data.refund_reason_id) return fail(res, 'order_id, amount 和 refund_reason_id 为必填项');
    if (data.payment_type !== undefined && data.payment_type !== 'refund') return fail(res, 'payment_type 仅允许 refund');
    const result = await svc.recordRefund(data);
    created(res, result, '退款已记录');
  } catch (err: any) {
    if (err.message.includes('不存在')) return fail(res, err.message, 40400, 404);
    serverError(res, err);
  }
});

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const stats = await svc.getPaymentStats((startDate as string) || '2000-01-01', (endDate as string) || '2099-12-31');
    success(res, stats);
  } catch (err: any) { serverError(res, err); }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const payment = await svc.getPayment(id);
    if (!payment) return notFound(res);
    success(res, payment);
  } catch (err: any) { serverError(res, err); }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const payment = await svc.updatePayment(id, req.body);
    if (!payment) return notFound(res);
    success(res, payment, '收款记录已更新');
  } catch (err: any) { serverError(res, err); }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const page_size = parseInt(req.query.page_size as string) || 20;
    const result = await svc.listPayments({ page, page_size }, {
      payment_type: req.query.payment_type as string | undefined,
      order_id: req.query.order_id ? parseInt(req.query.order_id as string) : undefined,
      record_date_from: req.query.record_date_from as string | undefined,
      record_date_to: req.query.record_date_to as string | undefined,
      arrival_date_from: req.query.arrival_date_from as string | undefined,
      arrival_date_to: req.query.arrival_date_to as string | undefined,
    });
    success(res, result);
  } catch (err: any) { serverError(res, err); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = await svc.deletePayment(id);
    if (!deleted) return notFound(res, '收款/退款记录不存在');
    success(res, null, '收款/退款记录已删除');
  } catch (err: any) { serverError(res, err); }
});

export default router;
