-- ============================================================================
-- ODS 层 9 张业务表 DDL
-- 来源: MySQL ods_draw 库 → SQLite (基于 types/index.ts 逆向重建)
-- 金额字段: INTEGER(分) 存储
-- ============================================================================

-- platform 平台表
CREATE TABLE IF NOT EXISTS platform (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    code            TEXT    NOT NULL UNIQUE,
    platform_type   TEXT    NOT NULL DEFAULT 'commission' CHECK(platform_type IN ('commission','social','submission')),
    url             TEXT,
    commission_rate INTEGER,  -- 万分比存储，原 DECIMAL(5,4)
    status          TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    remark          TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- customer 客户表
CREATE TABLE IF NOT EXISTS customer (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_uid          TEXT    NOT NULL,
    name                  TEXT    NOT NULL,
    platform_id           INTEGER NOT NULL,
    avg_rating            REAL,
    total_rating          REAL,
    avg_satisfaction      REAL,
    total_satisfaction    REAL,
    cancelled_order_count INTEGER NOT NULL DEFAULT 0,
    first_order_date      TEXT,
    last_order_date       TEXT,
    total_orders          INTEGER NOT NULL DEFAULT 0,
    total_spent           INTEGER NOT NULL DEFAULT 0,  -- 分
    remark                TEXT,
    created_at            TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at            TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (platform_id) REFERENCES platform(id)
);

-- slot_type 稿位类型表
CREATE TABLE IF NOT EXISTS slot_type (
    id         TEXT NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- slot 稿位表
CREATE TABLE IF NOT EXISTS slot (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT    NOT NULL,
    type_name            TEXT,
    slot_type_id         TEXT,
    category             TEXT    NOT NULL DEFAULT 'normal' CHECK(category IN ('normal','welfare')),
    category_desc        TEXT,
    current_price        INTEGER NOT NULL DEFAULT 0,  -- 分
    min_price            INTEGER,
    max_price            INTEGER,
    max_quantity         INTEGER NOT NULL DEFAULT 0,
    accepted_quantity    INTEGER NOT NULL DEFAULT 0,
    cancelled_quantity   INTEGER NOT NULL DEFAULT 0,
    delivered_quantity   INTEGER NOT NULL DEFAULT 0,
    completed_quantity   INTEGER NOT NULL DEFAULT 0,
    avg_satisfaction     REAL,
    delivery_method      TEXT    NOT NULL DEFAULT 'before_deadline' CHECK(delivery_method IN ('before_deadline','after_acceptance')),
    delivery_time        TEXT    NOT NULL,
    is_auto_close        INTEGER NOT NULL DEFAULT 0,
    status               TEXT    NOT NULL DEFAULT 'pending_publish' CHECK(status IN ('pending_publish','on_sale','off_shelf')),
    close_date           TEXT,
    close_reason         TEXT    CHECK(close_reason IS NULL OR close_reason IN ('full','manual','expired')),
    sort_order           INTEGER NOT NULL DEFAULT 0,
    description          TEXT,
    remark               TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (slot_type_id) REFERENCES slot_type(id)
);

-- order_info 订单表
CREATE TABLE IF NOT EXISTS order_info (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no                TEXT    NOT NULL,
    doc_no                  TEXT,
    customer_id             INTEGER NOT NULL,
    platform_id             INTEGER NOT NULL,
    platform_order_id       TEXT,
    slot_id                 INTEGER,
    order_amount            INTEGER NOT NULL DEFAULT 0,  -- 分
    commission_rate         INTEGER,                      -- 万分比
    commission_amount       INTEGER,                      -- 分
    net_income              INTEGER,                      -- 分
    order_date              TEXT    NOT NULL,
    accepted_time           TEXT,
    start_drawing_time      TEXT,
    estimated_delivery_time TEXT,
    actual_delivery_time    TEXT,
    actual_settlement_time  TEXT,
    requirement_desc        TEXT,
    order_status            TEXT    NOT NULL DEFAULT 'pending' CHECK(order_status IN ('pending','queued','in_progress','delivered','revising','settled','rejected','cancelled','overdue')),
    refund_reason_id        INTEGER,
    remark                  TEXT,
    session_duration        INTEGER,
    created_at              TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at              TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (customer_id) REFERENCES customer(id),
    FOREIGN KEY (platform_id) REFERENCES platform(id),
    FOREIGN KEY (slot_id)     REFERENCES slot(id)
);

-- progress_log 进度日志表
CREATE TABLE IF NOT EXISTS progress_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id          INTEGER NOT NULL,
    update_time       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    current_progress  TEXT    NOT NULL CHECK(current_progress IN ('queued','in_progress','delivered','revising')),
    progress_desc     TEXT,
    attachment_desc   TEXT,
    session_duration  INTEGER,
    total_duration    INTEGER NOT NULL DEFAULT 0,
    timer_status      TEXT    NOT NULL DEFAULT 'idle' CHECK(timer_status IN ('idle','running','paused')),
    timer_start_time  TEXT,
    status_time       TEXT,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (order_id) REFERENCES order_info(id)
);

-- delivery 交付表
CREATE TABLE IF NOT EXISTS delivery (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id             INTEGER NOT NULL,
    delivery_time        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    delivery_desc        TEXT,
    revision_count       INTEGER NOT NULL DEFAULT 0,
    is_accepted          INTEGER NOT NULL DEFAULT 0,
    customer_rating      REAL,
    customer_satisfaction REAL,
    remark               TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (order_id) REFERENCES order_info(id)
);

-- payment 收支表
CREATE TABLE IF NOT EXISTS payment (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id                INTEGER,
    payment_type            TEXT    NOT NULL CHECK(payment_type IN ('income','refund')),
    payment_status          TEXT    NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','received','failed')),
    record_date             TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    arrival_date            TEXT,
    amount                  INTEGER NOT NULL,  -- 分
    payment_method          TEXT    CHECK(payment_method IS NULL OR payment_method IN ('alipay','wechat','bank','platform','paypal','other')),
    is_platform_settlement  INTEGER NOT NULL DEFAULT 0,
    refund_reason_id        INTEGER,
    remark                  TEXT,
    created_at              TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at              TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (order_id) REFERENCES order_info(id)
);

-- refund_reason 退款原因表
CREATE TABLE IF NOT EXISTS refund_reason (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    applicable_type TEXT    NOT NULL DEFAULT 'all' CHECK(applicable_type IN ('reject','cancel','refund','all')),
    description     TEXT,
    status          TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
