import { Router, type Request, type Response } from 'express';
import * as svc from '../services/slotService.js';
import { success, created, notFound, fail, serverError, forbidden } from '../utils/response.js';
import { checkReferences, sumReferences } from '../utils/referenceChecker.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const page_size = parseInt(req.query.page_size as string) || 20;
    const status = req.query.status as string | undefined;
    const category = req.query.category as string | undefined;
    const result = await svc.listSlots({ page, page_size }, { status, category });
    success(res, result);
  } catch (err) { serverError(res, err); }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.name || !data.slot_type_id || !data.current_price || !data.max_quantity || !data.delivery_method || !data.delivery_time) {
      return fail(res, 'name, slot_type_id, current_price, max_quantity, delivery_method, delivery_time 为必填项');
    }
    const entity = await svc.createSlot(data);
    created(res, entity);
  } catch (err: any) { serverError(res, err); }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const entity = await svc.getSlot(id);
    if (!entity) return notFound(res);
    success(res, entity);
  } catch (err) { serverError(res, err); }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const entity = await svc.updateSlot(id, req.body);
    if (!entity) return notFound(res);
    success(res, entity);
  } catch (err: any) {
    if (err.message.includes('不允许编辑')) return forbidden(res, err.message);
    serverError(res, err);
  }
});

router.patch('/:id/publish', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const entity = await svc.publishSlot(id);
    success(res, entity, '已上架');
  } catch (err: any) {
    if (err.message.includes('不允许')) return forbidden(res, err.message);
    serverError(res, err);
  }
});

router.patch('/:id/off-shelf', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const reason = req.body?.close_reason || 'manual';
    const entity = await svc.offShelfSlot(id, reason);
    success(res, entity, '已下架');
  } catch (err: any) {
    if (err.message.includes('不允许')) return forbidden(res, err.message);
    serverError(res, err);
  }
});

router.patch('/:id/relist', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const entity = await svc.relistSlot(id);
    success(res, entity, '已重新上架');
  } catch (err: any) {
    if (err.message.includes('不允许')) return forbidden(res, err.message);
    serverError(res, err);
  }
});

router.get('/:id/orders', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const page = parseInt(req.query.page as string) || 1;
    const page_size = parseInt(req.query.page_size as string) || 20;
    const slot = await svc.getSlot(id);
    if (!slot) return notFound(res);
    const result = await svc.getSlotOrders(id, { page, page_size });
    success(res, result);
  } catch (err) { serverError(res, err); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await svc.getSlot(id);
    if (!existing) return notFound(res);
    const refs = await checkReferences(id, [{ table: 'order_info', column: 'slot_id' }]);
    if (sumReferences(refs) > 0) {
      return fail(res, `该橱窗被 ${refs.order_info || 0} 条订单引用，无法删除，请使用下架功能`);
    }
    await svc.deleteSlot(id);
    success(res, null, '已删除');
  } catch (err) { serverError(res, err); }
});

export default router;
