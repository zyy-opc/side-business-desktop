import { Router, type Request, type Response } from 'express';
import * as svc from '../services/customerService.js';
import { success, created, notFound, duplicate, fail, serverError } from '../utils/response.js';
import { checkReferences, sumReferences } from '../utils/referenceChecker.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const page_size = parseInt(req.query.page_size as string) || 20;
    const platform_id = req.query.platform_id ? parseInt(req.query.platform_id as string) : undefined;
    const keyword = req.query.keyword as string | undefined;
    const result = await svc.listCustomers({ page, page_size }, { platform_id, keyword });
    success(res, result);
  } catch (err) { serverError(res, err); }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.customer_uid || !data.name || !data.platform_id) return fail(res, 'customer_uid, name, platform_id 为必填项');
    const entity = await svc.createCustomer(data);
    created(res, entity);
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') return duplicate(res, '客户UID已存在');
    serverError(res, err);
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const entity = await svc.getCustomer(id);
    if (!entity) return notFound(res);
    success(res, entity);
  } catch (err) { serverError(res, err); }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const entity = await svc.updateCustomer(id, req.body);
    if (!entity) return notFound(res);
    success(res, entity);
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') return duplicate(res, '客户UID已存在');
    serverError(res, err);
  }
});

router.get('/:id/orders', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const page = parseInt(req.query.page as string) || 1;
    const page_size = parseInt(req.query.page_size as string) || 20;
    const customer = await svc.getCustomer(id);
    if (!customer) return notFound(res);
    const result = await svc.getCustomerOrders(id, { page, page_size });
    success(res, result);
  } catch (err) { serverError(res, err); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await svc.getCustomer(id);
    if (!existing) return notFound(res);
    const refs = await checkReferences(id, [{ table: 'order_info', column: 'customer_id' }]);
    if (sumReferences(refs) > 0) return fail(res, `该客户有 ${refs.order_info || 0} 条关联订单，无法删除`);
    await svc.deleteCustomer(id);
    success(res, null, '已删除');
  } catch (err) { serverError(res, err); }
});

export default router;
