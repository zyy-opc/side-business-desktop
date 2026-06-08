import { Router, type Request, type Response } from 'express';
import * as svc from '../services/deliveryService.js';
import { success, created, notFound, fail, serverError } from '../utils/response.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try { const result = await svc.listDeliveries(req.query); success(res, result); }
  catch (err: any) { serverError(res, err); }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.order_id || data.is_accepted === undefined) return fail(res, 'order_id 和 is_accepted 为必填项');
    if (data.is_accepted !== 1) return fail(res, '此端点 is_accepted 必须为 1（确认交付）');
    const result = await svc.confirmDelivery(data);
    created(res, result, '交付确认成功');
  } catch (err: any) {
    if (err.message.includes('不允许')) return fail(res, err.message, 40310, 403);
    if (err.message.includes('不存在')) return fail(res, err.message, 40400, 404);
    serverError(res, err);
  }
});

router.post('/revise', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.order_id || data.is_accepted === undefined) return fail(res, 'order_id 和 is_accepted 为必填项');
    if (data.is_accepted !== 0) return fail(res, '此端点 is_accepted 必须为 0（退回修改）');
    const result = await svc.requestRevision(data);
    created(res, result, '已退回修改');
  } catch (err: any) {
    if (err.message.includes('不允许')) return fail(res, err.message, 40310, 403);
    if (err.message.includes('不存在')) return fail(res, err.message, 40400, 404);
    serverError(res, err);
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const delivery = await svc.getDelivery(id);
    if (!delivery) return notFound(res);
    success(res, delivery);
  } catch (err: any) { serverError(res, err); }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const delivery = await svc.updateDelivery(id, req.body);
    if (!delivery) return notFound(res);
    success(res, delivery, '交付记录已更新');
  } catch (err: any) { serverError(res, err); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = await svc.deleteDelivery(id);
    if (!deleted) return notFound(res, '交付记录不存在');
    success(res, null, '交付记录已删除');
  } catch (err: any) { serverError(res, err); }
});

export default router;
