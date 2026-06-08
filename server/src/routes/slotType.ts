import { Router, type Request, type Response } from 'express';
import * as svc from '../services/slotTypeService.js';
import { success, created, notFound, fail, serverError } from '../utils/response.js';
import { checkReferences, sumReferences } from '../utils/referenceChecker.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const page_size = parseInt(req.query.page_size as string) || 20;
    const name = req.query.name as string | undefined;
    const result = await svc.listSlotTypes({ page, page_size }, { name });
    success(res, result);
  } catch (err) { serverError(res, err); }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.id || !data.name) return fail(res, 'id 和 name 为必填项');
    const entity = await svc.createSlotType(data);
    created(res, entity);
  } catch (err: any) { serverError(res, err); }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const entity = await svc.getSlotType(id);
    if (!entity) return notFound(res);
    success(res, entity);
  } catch (err) { serverError(res, err); }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const entity = await svc.updateSlotType(id, req.body);
    if (!entity) return notFound(res);
    success(res, entity);
  } catch (err: any) { serverError(res, err); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const existing = await svc.getSlotType(id);
    if (!existing) return notFound(res);
    const refs = await checkReferences(id, [{ table: 'slot', column: 'slot_type_id' }]);
    if (sumReferences(refs) > 0) return fail(res, `该橱窗类型被 ${refs.slot || 0} 个橱窗引用，无法删除`);
    await svc.deleteSlotType(id);
    success(res, null, '已删除');
  } catch (err) { serverError(res, err); }
});

export default router;
