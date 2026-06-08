import { Router, type Request, type Response } from 'express';
import * as svc from '../services/platformService.js';
import { success, created, notFound, duplicate, fail, serverError } from '../utils/response.js';
import { checkReferences, sumReferences } from '../utils/referenceChecker.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const page_size = parseInt(req.query.page_size as string) || 20;
    const status = req.query.status as string | undefined;
    const result = await svc.listPlatforms({ page, page_size }, { status });
    success(res, result);
  } catch (err) { serverError(res, err); }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.name || !data.code) return fail(res, 'name 和 code 为必填项');
    if (data.code.length > 10) return fail(res, 'code 长度不能超过 10 个字符');
    const entity = await svc.createPlatform(data);
    created(res, entity);
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY' || err.message?.includes('UNIQUE')) return duplicate(res, '平台编码已存在');
    serverError(res, err);
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const entity = await svc.getPlatform(id);
    if (!entity) return notFound(res);
    success(res, entity);
  } catch (err) { serverError(res, err); }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (req.body.code !== undefined && req.body.code.length > 10) return fail(res, 'code 长度不能超过 10 个字符');
    const entity = await svc.updatePlatform(id, req.body);
    if (!entity) return notFound(res);
    success(res, entity);
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY' || err.message?.includes('UNIQUE')) return duplicate(res, '平台编码已存在');
    serverError(res, err);
  }
});

router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    if (!status) return fail(res, 'status 为必填项');
    if (!['active', 'inactive'].includes(status)) return fail(res, 'status 只能为 active 或 inactive');
    const entity = await svc.setPlatformStatus(id, status);
    if (!entity) return notFound(res);
    success(res, entity);
  } catch (err) { serverError(res, err); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await svc.getPlatform(id);
    if (!existing) return notFound(res);
    const refs = await checkReferences(id, [
      { table: 'order_info', column: 'platform_id' },
      { table: 'customer', column: 'platform_id' },
    ]);
    if (sumReferences(refs) > 0) {
      await svc.setPlatformStatus(id, 'inactive');
      return fail(res, `该平台被 ${refs.order_info || 0} 条订单、${refs.customer || 0} 位客户引用，无法删除，已自动停用`);
    }
    await svc.deletePlatform(id);
    success(res, null, '已删除');
  } catch (err) { serverError(res, err); }
});

export default router;
