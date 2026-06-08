-- 005: 种子数据 — 预置平台、退款原因、安抚话术

-- 平台
INSERT OR IGNORE INTO platform (id, name, code, created_at, updated_at) VALUES
(4, '临界', 'LJ', datetime('now','localtime'), datetime('now','localtime')),
(5, '画栈', 'HZ', datetime('now','localtime'), datetime('now','localtime')),
(10, '米画师', 'MHS', datetime('now','localtime'), datetime('now','localtime')),
(11, '画加', 'HJ', datetime('now','localtime'), datetime('now','localtime')),
(12, 'B站工房', 'BZGF', datetime('now','localtime'), datetime('now','localtime'));

-- 退款原因
INSERT OR IGNORE INTO refund_reason (id, name, applicable_type, description, status, sort_order, created_at, updated_at) VALUES
(1, '价格谈不拢', 'reject', '客户出价与期望价格差距过大', 'active', 1, datetime('now','localtime'), datetime('now','localtime')),
(2, '档期已满', 'reject', '当前时段无空余接稿能力', 'active', 2, datetime('now','localtime'), datetime('now','localtime')),
(3, '画风不匹配', 'reject', '客户要求的风格不在自身能力范围', 'active', 3, datetime('now','localtime'), datetime('now','localtime')),
(4, '客户取消', 'cancel', '客户主动要求取消订单', 'active', 4, datetime('now','localtime'), datetime('now','localtime')),
(5, '质量问题', 'refund', '交付作品存在明显质量瑕疵', 'active', 5, datetime('now','localtime'), datetime('now','localtime')),
(6, '延期补偿', 'refund', '因超期交付主动给予客户补偿', 'active', 6, datetime('now','localtime'), datetime('now','localtime')),
(7, '部分退款', 'refund', '客户已完成部分付款后退还差额', 'active', 7, datetime('now','localtime'), datetime('now','localtime')),
(8, '其他', 'all', '不属于以上分类的其他原因', 'active', 8, datetime('now','localtime'), datetime('now','localtime'));

-- 安抚话术
INSERT OR IGNORE INTO comfort_message (id, content, is_active, created_at, updated_at) VALUES
(1, '感谢您的耐心等待，我会尽快完成交付~', 1, datetime('now','localtime'), datetime('now','localtime')),
(2, '抱歉让您久等了，目前进度一切顺利，预计明晚前出图！', 1, datetime('now','localtime'), datetime('now','localtime')),
(3, '收到您的反馈了，我会按照您的要求进行调整~', 1, datetime('now','localtime'), datetime('now','localtime')),
(4, '感谢支持！如果对作品满意的话，欢迎下次再来~', 1, datetime('now','localtime'), datetime('now','localtime')),
(5, '目前排单较多，预计需要3-5天左右，您看可以接受吗？', 1, datetime('now','localtime'), datetime('now','localtime'));
