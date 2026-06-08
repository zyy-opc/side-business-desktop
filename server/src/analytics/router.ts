// analytics 占位路由 — 数据分析模块暂未开放
import { Router } from 'express';

const router = Router();

router.get('/home-stats', (_req, res) => {
  res.json({
    code: 0,
    message: 'ok',
    data: {
      total_orders_this_month: 0,
      in_progress_orders: 0,
      total_revenue_this_month: 0,
      active_slots: 0,
      new_customers_this_month: 0,
      pending_items: 0,
    },
  });
});

export default router;
