import { Router, type Request, type Response } from 'express';
import * as svc from '../services/progressLogService.js';
import { success, created, fail, serverError } from '../utils/response.js';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.order_id || !data.current_progress) {
      return fail(res, 'order_id 和 current_progress 为必填项');
    }
    const entity = await svc.createProgressLog(data);
    created(res, entity);
  } catch (err: any) {
    if (err.message.includes('不允许')) return fail(res, err.message);
    if (err.message.includes('不存在')) return fail(res, err.message, 40400, 404);
    serverError(res, err);
  }
});

export default router;
