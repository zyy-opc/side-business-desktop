-- ============================================================================
-- DWD / DWS / ADS 层 DDL
-- 来源: database/analytics_ddl.sql → SQLite 适配
-- 金额字段: INTEGER(分) 存储
-- ============================================================================

-- ============================================================
-- DWD 层 (明细宽表)
-- ============================================================

-- DWD-01: 订单宽表
DROP TABLE IF EXISTS dwd_order_detail;
CREATE TABLE dwd_order_detail (
    order_id                    INTEGER NOT NULL PRIMARY KEY,
    order_no                    TEXT    NOT NULL,
    order_status                TEXT    NOT NULL,
    order_date                  TEXT,
    accepted_time               TEXT,
    start_drawing_time          TEXT,
    estimated_delivery_time     TEXT,
    actual_delivery_time        TEXT,
    actual_settlement_time      TEXT,
    order_amount                INTEGER,  -- 分
    commission_rate             INTEGER,  -- 万分比
    commission_amount           INTEGER,  -- 分
    net_income                  INTEGER,  -- 分
    session_duration            INTEGER,
    requirement_desc            TEXT,
    remark                      TEXT,
    -- customer
    customer_id                 INTEGER,
    customer_name               TEXT,
    customer_uid                TEXT,
    customer_avg_rating         REAL,
    customer_avg_satisfaction   REAL,
    customer_total_orders       INTEGER,
    customer_total_spent        INTEGER,  -- 分
    customer_first_order_date   TEXT,
    customer_last_order_date    TEXT,
    -- platform
    platform_id                 INTEGER,
    platform_name               TEXT,
    platform_code               TEXT,
    platform_type               TEXT,
    -- slot
    slot_id                     INTEGER,
    slot_name                   TEXT,
    slot_type_id                TEXT,
    slot_type_name              TEXT,
    slot_category               TEXT,
    -- refund_reason
    refund_reason_id            INTEGER,
    refund_reason_name          TEXT,
    -- meta
    etl_time                    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_od_platform   ON dwd_order_detail(platform_id);
CREATE INDEX IF NOT EXISTS idx_od_customer   ON dwd_order_detail(customer_id);
CREATE INDEX IF NOT EXISTS idx_od_order_date ON dwd_order_detail(order_date);
CREATE INDEX IF NOT EXISTS idx_od_status     ON dwd_order_detail(order_status);
CREATE INDEX IF NOT EXISTS idx_od_slot       ON dwd_order_detail(slot_id);

-- DWD-02: 交付明细表
DROP TABLE IF EXISTS dwd_delivery_detail;
CREATE TABLE dwd_delivery_detail (
    delivery_id               INTEGER NOT NULL PRIMARY KEY,
    order_id                  INTEGER NOT NULL,
    delivery_time             TEXT,
    delivery_desc             TEXT,
    revision_count            INTEGER NOT NULL DEFAULT 0,
    is_accepted               INTEGER NOT NULL DEFAULT 0,
    customer_rating           REAL,
    customer_satisfaction     REAL,
    -- order
    order_no                  TEXT,
    order_date                TEXT,
    order_status              TEXT,
    platform_id               INTEGER,
    customer_id               INTEGER,
    order_amount              INTEGER,  -- 分
    -- meta
    etl_time                  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_dd_order         ON dwd_delivery_detail(order_id);
CREATE INDEX IF NOT EXISTS idx_dd_delivery_time ON dwd_delivery_detail(delivery_time);
CREATE INDEX IF NOT EXISTS idx_dd_platform      ON dwd_delivery_detail(platform_id);

-- DWD-03: 财务明细表
DROP TABLE IF EXISTS dwd_payment_detail;
CREATE TABLE dwd_payment_detail (
    payment_id                INTEGER NOT NULL PRIMARY KEY,
    order_id                  INTEGER,
    payment_type              TEXT    NOT NULL,
    payment_status            TEXT    NOT NULL,
    record_date               TEXT,
    arrival_date              TEXT,
    amount                    INTEGER NOT NULL,  -- 分
    payment_method            TEXT,
    is_platform_settlement    INTEGER NOT NULL DEFAULT 0,
    refund_reason_id          INTEGER,
    refund_reason_name        TEXT,
    remark                    TEXT,
    -- order
    order_no                  TEXT,
    order_date                TEXT,
    order_status              TEXT,
    platform_id               INTEGER,
    platform_name             TEXT,
    customer_id               INTEGER,
    customer_name             TEXT,
    -- meta
    etl_time                  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pd_order       ON dwd_payment_detail(order_id);
CREATE INDEX IF NOT EXISTS idx_pd_record_date ON dwd_payment_detail(record_date);
CREATE INDEX IF NOT EXISTS idx_pd_type        ON dwd_payment_detail(payment_type);
CREATE INDEX IF NOT EXISTS idx_pd_platform    ON dwd_payment_detail(platform_id);

-- ============================================================
-- DWS 层 (汇总表)
-- ============================================================

-- DWS-01: 每日收入汇总
DROP TABLE IF EXISTS dws_revenue_daily;
CREATE TABLE dws_revenue_daily (
    stat_date               TEXT    NOT NULL PRIMARY KEY,
    total_income            INTEGER NOT NULL DEFAULT 0,  -- 分
    total_commission        INTEGER NOT NULL DEFAULT 0,  -- 分
    total_net               INTEGER NOT NULL DEFAULT 0,  -- 分
    refund_amount           INTEGER NOT NULL DEFAULT 0,  -- 分
    order_count             INTEGER NOT NULL DEFAULT 0,
    settled_count           INTEGER NOT NULL DEFAULT 0,
    cancelled_count         INTEGER NOT NULL DEFAULT 0,
    new_order_count         INTEGER NOT NULL DEFAULT 0,
    etl_time                TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- DWS-02: 平台每日汇总
DROP TABLE IF EXISTS dws_platform_daily;
CREATE TABLE dws_platform_daily (
    platform_id             INTEGER NOT NULL,
    stat_date               TEXT    NOT NULL,
    order_count             INTEGER NOT NULL DEFAULT 0,
    income                  INTEGER NOT NULL DEFAULT 0,  -- 分
    commission              INTEGER NOT NULL DEFAULT 0,  -- 分
    net_income              INTEGER NOT NULL DEFAULT 0,  -- 分
    avg_order_amount        INTEGER NOT NULL DEFAULT 0,  -- 分
    delivered_count         INTEGER NOT NULL DEFAULT 0,
    settled_count           INTEGER NOT NULL DEFAULT 0,
    cancelled_count         INTEGER NOT NULL DEFAULT 0,
    avg_satisfaction        REAL    NOT NULL DEFAULT 0.0,
    new_customer_count      INTEGER NOT NULL DEFAULT 0,
    etl_time                TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (platform_id, stat_date)
);
CREATE INDEX IF NOT EXISTS idx_pld_date ON dws_platform_daily(stat_date);

-- DWS-03: 客户汇总
DROP TABLE IF EXISTS dws_customer_summary;
CREATE TABLE dws_customer_summary (
    customer_id             INTEGER NOT NULL PRIMARY KEY,
    customer_name           TEXT,
    total_orders            INTEGER NOT NULL DEFAULT 0,
    total_spent             INTEGER NOT NULL DEFAULT 0,  -- 分
    avg_order_amount        INTEGER NOT NULL DEFAULT 0,  -- 分
    orders_last90d          INTEGER NOT NULL DEFAULT 0,
    last_order_date         TEXT,
    cancelled_rate          REAL    NOT NULL DEFAULT 0.0,
    avg_rating              REAL    NOT NULL DEFAULT 0.0,
    avg_satisfaction        REAL    NOT NULL DEFAULT 0.0,
    rfm_r                   INTEGER NOT NULL DEFAULT 0,
    rfm_f                   INTEGER NOT NULL DEFAULT 0,
    rfm_m                   INTEGER NOT NULL DEFAULT 0,  -- 分
    etl_time                TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- DWS-04: 稿位每日汇总
DROP TABLE IF EXISTS dws_slot_daily;
CREATE TABLE dws_slot_daily (
    slot_id                 INTEGER NOT NULL,
    slot_name               TEXT,
    stat_date               TEXT    NOT NULL,
    accepted_count          INTEGER NOT NULL DEFAULT 0,
    delivered_count         INTEGER NOT NULL DEFAULT 0,
    completed_count         INTEGER NOT NULL DEFAULT 0,
    cancelled_count         INTEGER NOT NULL DEFAULT 0,
    total_income            INTEGER NOT NULL DEFAULT 0,  -- 分
    avg_satisfaction        REAL    NOT NULL DEFAULT 0.0,
    etl_time                TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (slot_id, stat_date)
);
CREATE INDEX IF NOT EXISTS idx_sd_date ON dws_slot_daily(stat_date);

-- DWS-05: 稿位类型月度汇总
DROP TABLE IF EXISTS dws_slot_type_monthly;
CREATE TABLE dws_slot_type_monthly (
    slot_type_id            TEXT    NOT NULL,
    slot_type_name          TEXT,
    stat_month              TEXT    NOT NULL,
    order_count             INTEGER NOT NULL DEFAULT 0,
    income                  INTEGER NOT NULL DEFAULT 0,  -- 分
    avg_price               INTEGER NOT NULL DEFAULT 0,  -- 分
    customer_count          INTEGER NOT NULL DEFAULT 0,
    rank_in_month           INTEGER NOT NULL DEFAULT 0,
    etl_time                TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (slot_type_id, stat_month)
);

-- ============================================================
-- ADS 层 (应用指标表)
-- ============================================================

-- ADS-01: 总览 KPI
DROP TABLE IF EXISTS ads_overview_kpi;
CREATE TABLE ads_overview_kpi (
    total_orders           INTEGER NOT NULL DEFAULT 0,
    orders_mom             REAL,
    total_revenue          INTEGER NOT NULL DEFAULT 0,  -- 分
    revenue_mom            REAL,
    total_net              INTEGER NOT NULL DEFAULT 0,  -- 分
    net_mom                REAL,
    avg_order_amount       INTEGER NOT NULL DEFAULT 0,  -- 分
    avg_order_mom          REAL,
    active_customers       INTEGER NOT NULL DEFAULT 0,
    customers_mom          REAL,
    avg_satisfaction       REAL    NOT NULL DEFAULT 0.0,
    satisfaction_mom       REAL,
    cancelled_rate         REAL    NOT NULL DEFAULT 0.0,
    cancelled_rate_mom     REAL,
    etl_time               TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ADS-02: 平台分析汇总
DROP TABLE IF EXISTS ads_platform_stats;
CREATE TABLE ads_platform_stats (
    platform_code       TEXT    NOT NULL PRIMARY KEY,
    platform_name       TEXT,
    order_count         INTEGER NOT NULL DEFAULT 0,
    income              INTEGER NOT NULL DEFAULT 0,  -- 分
    commission          INTEGER NOT NULL DEFAULT 0,  -- 分
    net_income          INTEGER NOT NULL DEFAULT 0,  -- 分
    avg_order_amount    INTEGER NOT NULL DEFAULT 0,  -- 分
    delivered_count     INTEGER NOT NULL DEFAULT 0,
    settled_count       INTEGER NOT NULL DEFAULT 0,
    cancelled_count     INTEGER NOT NULL DEFAULT 0,
    avg_satisfaction    REAL    NOT NULL DEFAULT 0.0,
    order_count_rank    INTEGER,
    revenue_rank        INTEGER,
    net_income_share_pct REAL,
    monthly_trend       TEXT,
    etl_time            TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ADS-03: 客户 RFM
DROP TABLE IF EXISTS ads_customer_rfm;
CREATE TABLE ads_customer_rfm (
    customer_id       INTEGER NOT NULL PRIMARY KEY,
    customer_name     TEXT,
    total_orders      INTEGER NOT NULL DEFAULT 0,
    total_spent       INTEGER NOT NULL DEFAULT 0,  -- 分
    avg_order_amount  INTEGER NOT NULL DEFAULT 0,  -- 分
    last_order_date   TEXT,
    r_score           INTEGER NOT NULL DEFAULT 0,
    f_score           INTEGER NOT NULL DEFAULT 0,
    m_score           INTEGER NOT NULL DEFAULT 0,
    segment           TEXT    NOT NULL DEFAULT 'D',
    etl_time          TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ADS-04: 稿位排行榜
DROP TABLE IF EXISTS ads_slot_ranking;
CREATE TABLE ads_slot_ranking (
    slot_id           INTEGER NOT NULL PRIMARY KEY,
    slot_name         TEXT,
    accepted_count    INTEGER NOT NULL DEFAULT 0,
    delivered_count   INTEGER NOT NULL DEFAULT 0,
    completed_count   INTEGER NOT NULL DEFAULT 0,
    cancelled_count   INTEGER NOT NULL DEFAULT 0,
    total_income      INTEGER NOT NULL DEFAULT 0,  -- 分
    avg_satisfaction  REAL    NOT NULL DEFAULT 0.0,
    conversion_rate   REAL    NOT NULL DEFAULT 0.0,
    utilization_rate  REAL,
    trend             TEXT,
    etl_time          TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ============================================================
-- 视图映射
-- ============================================================
DROP VIEW IF EXISTS ads_platform_ranking;
CREATE VIEW ads_platform_ranking AS SELECT * FROM ads_platform_stats;

DROP VIEW IF EXISTS ads_slot_heatmap;
CREATE VIEW ads_slot_heatmap AS SELECT * FROM ads_slot_ranking;

-- ============================================================
-- 元数据表
-- ============================================================
CREATE TABLE IF NOT EXISTS _schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('schema_version', '1');
INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('software_version', '1.0.0');
INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('created_at', datetime('now', 'localtime'));
