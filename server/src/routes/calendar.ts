import { Router, type Request, type Response } from 'express';
import * as svc from '../services/calendarService.js';
import { success, fail, serverError } from '../utils/response.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return fail(res, '请提供有效的 year 和 month 参数（1-12）');
    }
    const result = await svc.getCalendar(year, month);
    success(res, result);
  } catch (err) { serverError(res, err); }
});

export default router;
