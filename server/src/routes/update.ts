// ============================================================================
// 版本更新检测路由 — 不经 license guard，始终可用
// ============================================================================

import { Router, type Request, type Response } from 'express';
import { checkUpdate } from '../services/updateService.js';
import { success, serverError } from '../utils/response.js';

const router = Router();

/** GET /api/v1/update/check — 检查是否有新版本 */
router.get('/check', async (_req: Request, res: Response) => {
  try {
    const result = await checkUpdate();
    success(res, result);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
