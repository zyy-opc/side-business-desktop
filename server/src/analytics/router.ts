// ============================================================================
// analytics — 数据分析 API Router (SQLite 适配版)
// ============================================================================

import { Router, type Request, type Response } from 'express';
import * as svc from './service.js';
import { success, fail, serverError } from '../utils/response.js';
import type { AnalyticsQuery, Granularity } from './types.js';
import { GRANULARITY_VALUES } from './types.js';

const router = Router();

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parseQuery(req: Request): { valid: true; startDate: string; endDate: string; granularity: Granularity } | { valid: false; error: string } {
  const { start_date, end_date, granularity } = req.query as Record<string, string | undefined>;

  const startDate = start_date || '2024-01-01';
  const endDate = end_date || new Date().toISOString().slice(0, 10);
  const gran = (granularity || 'day') as Granularity;

  if (!DATE_REGEX.test(startDate)) return { valid: false, error: `start_date 格式错误，需要 yyyy-MM-dd，收到: ${startDate}` };
  if (!DATE_REGEX.test(endDate))   return { valid: false, error: `end_date 格式错误，需要 yyyy-MM-dd，收到: ${endDate}` };
  if (startDate > endDate)         return { valid: false, error: 'start_date 不能晚于 end_date' };
  if (!GRANULARITY_VALUES.includes(gran)) return { valid: false, error: `granularity 仅支持 day/week/month，收到: ${granularity}` };

  return { valid: true, startDate, endDate, granularity: gran };
}

router.get('/overview', async (req: Request, res: Response) => {
  try {
    const params = parseQuery(req);
    if (!params.valid) return fail(res, params.error);
    const data = await svc.getOverview(params.startDate, params.endDate, params.granularity);
    success(res, data);
  } catch (err: any) { serverError(res, err); }
});

router.get('/revenue', async (req: Request, res: Response) => {
  try {
    const params = parseQuery(req);
    if (!params.valid) return fail(res, params.error);
    const data = await svc.getRevenue(params.startDate, params.endDate, params.granularity);
    success(res, data);
  } catch (err: any) { serverError(res, err); }
});

router.get('/platform', async (req: Request, res: Response) => {
  try {
    const params = parseQuery(req);
    if (!params.valid) return fail(res, params.error);
    const data = await svc.getPlatform(params.startDate, params.endDate, params.granularity);
    success(res, data);
  } catch (err: any) { serverError(res, err); }
});

router.get('/customer', async (req: Request, res: Response) => {
  try {
    const params = parseQuery(req);
    if (!params.valid) return fail(res, params.error);
    const data = await svc.getCustomer(params.startDate, params.endDate, params.granularity);
    success(res, data);
  } catch (err: any) { serverError(res, err); }
});

router.get('/slot', async (req: Request, res: Response) => {
  try {
    const params = parseQuery(req);
    if (!params.valid) return fail(res, params.error);
    const data = await svc.getSlot(params.startDate, params.endDate, params.granularity);
    success(res, data);
  } catch (err: any) { serverError(res, err); }
});

export default router;
