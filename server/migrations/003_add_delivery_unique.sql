-- ============================================================================
-- 为 delivery 表添加 UNIQUE(order_id) 约束（SQLite 通过 unique index 实现）
-- 支持交付记录的 UPSERT 操作
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_order_id ON delivery(order_id);
