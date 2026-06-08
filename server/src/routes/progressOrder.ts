import { Router, type Request, type Response } from 'express';
import * as svc from '../services/progressLogService.js';
import { success, fail, serverError } from '../utils/response.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const page_size = parseInt(req.query.page_size as string) || 20;
    const order_status = req.query.order_status as string | undefined;
    const include_settled = req.query.include_settled === 'true';
    const settlement_date = req.query.settlement_date as string | undefined;

    const allowedStatuses = include_settled
      ? ['queued', 'in_progress', 'overdue', 'revising', 'settled', 'delivered']
      : ['queued', 'in_progress', 'overdue', 'revising'];

    if (order_status && !allowedStatuses.includes(order_status)) {
      return fail(res, `order_status 只能为 ${allowedStatuses.join('/')}`);
    }
    if (settlement_date && !/^\d{4}-\d{2}-\d{2}$/.test(settlement_date)) {
      return fail(res, 'settlement_date 格式须为 yyyy-MM-dd');
    }

    const result = await svc.listProgressOrders({ page, page_size }, { order_status, include_settled, settlement_date });
    success(res, result);
  } catch (err) { serverError(res, err); }
});

export default router;
