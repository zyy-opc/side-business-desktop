import { Router, type Request, type Response } from 'express';
import * as svc from '../services/refundReasonService.js';
import { success, created, notFound, duplicate, fail, serverError } from '../utils/response.js';
import { checkReferences, sumReferences } from '../utils/referenceChecker.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const page_size = parseInt(req.query.page_size as string) || 20;
    const applicable_type = req.query.applicable_type as string | undefined;
    const status = req.query.status as string | undefined;
    const result = await svc.listRefundReasons({ page, page_size }, { applicable_type, status });
    success(res, result);
  } catch (err) { serverError(res, err); }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.name || !data.applicable_type) return fail(res, 'name 和 applicable_type 为必填项');
    if (!['reject', 'cancel', 'refund', 'all'].includes(data.applicable_type)) return fail(res, 'applicable_type 只能为 reject/cancel/refund/all');
    const entity = await svc.createRefundReason(data);
    created(res, entity);
  } catch (err: any) { serverError(res, err); }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const entity = await svc.getRefundReason(id);
    if (!entity) return notFound(res);
    success(res, entity);
  } catch (err) { serverError(res, err); }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const entity = await svc.updateRefundReason(id, req.body);
    if (!entity) return notFound(res);
    success(res, entity);
  } catch (err: any) { serverError(res, err); }
});

router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    if (!status) return fail(res, 'status 为必填项');
    if (!['active', 'inactive'].includes(status)) return fail(res, 'status 只能为 active 或 inactive');
    const entity = await svc.setRefundReasonStatus(id, status);
    if (!entity) return notFound(res);
    success(res, entity);
  } catch (err) { serverError(res, err); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await svc.getRefundReason(id);
    if (!existing) return notFound(res);
    const refs = await checkReferences(id, [
      { table: 'order_info', column: 'refund_reason_id' },
      { table: 'payment', column: 'refund_reason_id' },
    ]);
    if (sumReferences(refs) > 0) {
      await svc.setRefundReasonStatus(id, 'inactive');
      return fail(res, `该退款原因被 ${refs.order_info || 0} 条订单、${refs.payment || 0} 条收款记录引用，无法删除，已自动停用`);
    }
    await svc.deleteRefundReason(id);
    success(res, null, '已删除');
  } catch (err) { serverError(res, err); }
});

export default router;
