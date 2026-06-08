import { Router, type Request, type Response } from 'express';
import { checkLicense, activateCode } from '../services/licenseService.js';
import { success, fail, serverError } from '../utils/response.js';

const router = Router();

/** GET /api/v1/license/status — 返回激活状态和剩余天数 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await checkLicense();
    success(res, status);
  } catch (err) {
    serverError(res, err);
  }
});

/** POST /api/v1/license/activate — 接收 { code, serverUrl }，本地验证后回调服务器标记已使用 */
router.post('/activate', async (req: Request, res: Response) => {
  try {
    const { code, serverUrl } = req.body;
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return fail(res, '请输入激活码');
    }

    const result = await activateCode(code.trim(), serverUrl || '');

    if (!result.valid) {
      return fail(res, result.message);
    }

    success(res, { days: result.days }, result.message);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
