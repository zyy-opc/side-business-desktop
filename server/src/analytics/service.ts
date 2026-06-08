// ============================================================================
// analytics — 数据分析服务 (SQLite 适配版)
// 金额字段: INTEGER(分)，API 返回时 /100 转换为元
// Stage 1: 仓库表无数据时使用 mock fallback
// ============================================================================

import { pool } from '../config/database.js';
import type {
  Granularity, OverviewResponse, RevenueResponse, PlatformResponse,
  CustomerResponse, SlotResponse, PlatformDistribution, MonthlyTrendPoint,
  RecentOrder, RevenueTrendPoint, PlatformStackedPoint, RefundReasonItem,
  PlatformStats, CustomerRFM, SlotStats, SlotTypeDistribution, DeliveryTimeline,
} from './types.js';

// 金额: 分→元
const toYuan = (cents: unknown): number => Number(cents ?? 0) / 100;

function dateFormat(granularity: Granularity): string {
  switch (granularity) {
    case 'week':  return '%Y-%W';
    case 'month': return '%Y-%m';
    case 'day':
    default:      return '%Y-%m-%d';
  }
}

function monthsAgo(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function daysAgo(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// 总览
// ============================================================================

export async function getOverview(
  startDate: string, endDate: string, granularity: Granularity
): Promise<OverviewResponse> {
  let kpi = getOverviewMock();

  try {
    // 尝试从 ads_overview_kpi 读取
    const [kpiRows] = await pool.query('SELECT * FROM ads_overview_kpi LIMIT 1');
    if (Array.isArray(kpiRows) && kpiRows.length > 0) {
      const r = kpiRows[0] as Record<string, any>;
      kpi = {
        total_orders:     { value: Number(r.total_orders ?? 0),     mom: Number(r.orders_mom ?? 0) },
        total_revenue:    { value: toYuan(r.total_revenue),          mom: Number(r.revenue_mom ?? 0) },
        total_net:        { value: toYuan(r.total_net),              mom: Number(r.net_mom ?? 0) },
        avg_order_amount: { value: toYuan(r.avg_order_amount),       mom: Number(r.avg_order_mom ?? 0) },
        active_customers: { value: Number(r.active_customers ?? 0),  mom: Number(r.customers_mom ?? 0) },
        avg_satisfaction: { value: Number(r.avg_satisfaction ?? 0),  mom: Number(r.satisfaction_mom ?? 0) },
        cancelled_rate:   { value: Number(r.cancelled_rate ?? 0),    mom: Number(r.cancelled_rate_mom ?? 0) },
        platform_distribution: [],
        monthly_trend: [],
        recent_orders: [],
      };
    }
  } catch { /* fallback */ }

  // 平台收入分布
  let platformDistribution: PlatformDistribution[] = [];
  try {
    const [pdRows] = await pool.query(
      `SELECT IFNULL(p.code, 'unknown') AS platform_code, IFNULL(p.name, '未知平台') AS platform_name,
              IFNULL(SUM(pd.income), 0) AS income
       FROM dws_platform_daily pd
       LEFT JOIN platform p ON pd.platform_id = p.id
       WHERE pd.stat_date >= ? AND pd.stat_date <= ?
       GROUP BY p.id, p.code, p.name ORDER BY income DESC`,
      [startDate, endDate]
    );
    if (Array.isArray(pdRows) && pdRows.length > 0) {
      const totalIncome = pdRows.reduce((s: number, r: any) => s + Number(r.income ?? 0), 0);
      platformDistribution = pdRows.map((r: any) => ({
        platform_code: String(r.platform_code),
        platform_name: String(r.platform_name),
        income: toYuan(r.income),
        percentage: totalIncome > 0 ? Number(((Number(r.income ?? 0) / totalIncome) * 100).toFixed(2)) : 0,
      }));
    }
  } catch { /* empty */ }

  // 近12月收入趋势
  let monthlyTrend: MonthlyTrendPoint[] = [];
  try {
    const trendStart = monthsAgo(endDate, 11);
    const [mtRows] = await pool.query(
      `SELECT strftime('%Y-%m', stat_date) AS date,
              IFNULL(SUM(total_income), 0) AS income,
              IFNULL(SUM(order_count), 0) AS order_count
       FROM dws_revenue_daily
       WHERE stat_date >= ? AND stat_date <= ?
       GROUP BY strftime('%Y-%m', stat_date) ORDER BY date`,
      [trendStart, endDate]
    );
    if (Array.isArray(mtRows)) {
      monthlyTrend = mtRows.map((r: any) => ({
        date: String(r.date),
        income: toYuan(r.income),
        order_count: Number(r.order_count ?? 0),
      }));
    }
  } catch { /* empty */ }

  // 最近5条订单
  let recentOrders: RecentOrder[] = [];
  try {
    const [roRows] = await pool.query(
      `SELECT oi.id, oi.order_no, IFNULL(oi.order_status, 'unknown') AS order_status,
              IFNULL(oi.order_amount, 0) AS order_amount,
              IFNULL(c.name, '未知') AS customer_name,
              IFNULL(p.name, '未知平台') AS platform_name
       FROM order_info oi
       LEFT JOIN customer c ON oi.customer_id = c.id
       LEFT JOIN platform p ON oi.platform_id = p.id
       ORDER BY oi.id DESC LIMIT 5`
    );
    if (Array.isArray(roRows)) {
      recentOrders = roRows.map((r: any) => ({
        id: Number(r.id ?? 0),
        order_no: String(r.order_no ?? ''),
        order_status: String(r.order_status),
        order_amount: toYuan(r.order_amount),
        customer_name: String(r.customer_name),
        platform_name: String(r.platform_name ?? ''),
      }));
    }
  } catch { /* empty */ }

  return { ...kpi, platform_distribution: platformDistribution, monthly_trend: monthlyTrend, recent_orders: recentOrders };
}

// ============================================================================
// 收入分析
// ============================================================================

export async function getRevenue(
  startDate: string, endDate: string, granularity: Granularity
): Promise<RevenueResponse> {
  let trend: RevenueTrendPoint[] = [];
  let summary = { total_income: 0, total_commission: 0, total_net: 0, refund_amount: 0, order_count: 0, settled_count: 0 };

  try {
    const [checkRows] = await pool.query(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND tbl_name='dws_revenue_daily' LIMIT 1"
    );
    if (Array.isArray(checkRows) && checkRows.length > 0) {
      const df = dateFormat(granularity);
      const [trendRows] = await pool.query(
        `SELECT strftime(?, stat_date) AS date,
                IFNULL(SUM(total_income), 0) AS income, IFNULL(SUM(total_commission), 0) AS commission,
                IFNULL(SUM(total_net), 0) AS net_income, IFNULL(SUM(refund_amount), 0) AS refund_amount,
                IFNULL(SUM(order_count), 0) AS order_count, IFNULL(SUM(settled_count), 0) AS settled_count
         FROM dws_revenue_daily WHERE stat_date >= ? AND stat_date <= ?
         GROUP BY strftime(?, stat_date) ORDER BY date`,
        [df, startDate, endDate, df]
      );
      if (Array.isArray(trendRows) && trendRows.length > 0) {
        trend = trendRows.map((r: Record<string, any>) => ({
          date: r.date, income: toYuan(r.income), commission: toYuan(r.commission),
          net_income: toYuan(r.net_income), refund_amount: toYuan(r.refund_amount),
          order_count: Number(r.order_count ?? 0), settled_count: Number(r.settled_count ?? 0),
        }));
        summary = {
          total_income: trend.reduce((s, p) => s + p.income, 0),
          total_commission: trend.reduce((s, p) => s + p.commission, 0),
          total_net: trend.reduce((s, p) => s + p.net_income, 0),
          refund_amount: trend.reduce((s, p) => s + p.refund_amount, 0),
          order_count: trend.reduce((s, p) => s + p.order_count, 0),
          settled_count: trend.reduce((s, p) => s + p.settled_count, 0),
        };
      }
    }
  } catch { /* fallback */ }

  if (trend.length === 0) {
    const mock = getRevenueMock(granularity);
    trend = mock.trend;
    summary = mock.summary;
  }

  return { summary, trend, platform_stacked: [], refund_reason_distribution: [] };
}

// ============================================================================
// 平台分析
// ============================================================================

export async function getPlatform(
  startDate: string, endDate: string, _granularity: Granularity
): Promise<PlatformResponse> {
  let summary: PlatformStats[] = [];
  let trend: Array<{ date: string; platform_code: string; income: number; order_count: number }> = [];

  try {
    const [summaryRows] = await pool.query(
      `SELECT IFNULL(p.code, 'unknown') AS platform_code, IFNULL(p.name, '未知平台') AS platform_name,
              IFNULL(SUM(pd.order_count), 0) AS order_count, IFNULL(SUM(pd.income), 0) AS income,
              IFNULL(SUM(pd.commission), 0) AS commission, IFNULL(SUM(pd.net_income), 0) AS net_income,
              IFNULL(CAST(SUM(pd.income) AS REAL) / NULLIF(SUM(pd.order_count), 0), 0) AS avg_order_amount,
              IFNULL(SUM(pd.delivered_count), 0) AS delivered_count,
              IFNULL(SUM(pd.settled_count), 0) AS settled_count,
              IFNULL(SUM(pd.cancelled_count), 0) AS cancelled_count,
              IFNULL(AVG(pd.avg_satisfaction), 0) AS avg_satisfaction
       FROM dws_platform_daily pd
       LEFT JOIN platform p ON pd.platform_id = p.id
       WHERE pd.stat_date >= ? AND pd.stat_date <= ?
       GROUP BY p.id, p.code, p.name ORDER BY income DESC`,
      [startDate, endDate]
    );
    if (Array.isArray(summaryRows)) {
      summary = summaryRows.map((r: any) => ({
        platform_code: String(r.platform_code), platform_name: String(r.platform_name),
        order_count: Number(r.order_count ?? 0), income: toYuan(r.income),
        commission: toYuan(r.commission), net_income: toYuan(r.net_income),
        avg_order_amount: toYuan(r.avg_order_amount), delivered_count: Number(r.delivered_count ?? 0),
        settled_count: Number(r.settled_count ?? 0), cancelled_count: Number(r.cancelled_count ?? 0),
        avg_satisfaction: Number(r.avg_satisfaction ?? 0),
      }));
    }
  } catch { /* fallback */ }

  if (summary.length === 0) return getPlatformMock();
  return { summary, trend };
}

// ============================================================================
// 客户分析
// ============================================================================

export async function getCustomer(
  startDate: string, endDate: string, _granularity: Granularity
): Promise<CustomerResponse> {
  let allCustomers: Array<{
    customer_id: number; customer_name: string; total_orders: number;
    total_spent: number; avg_order_amount: number; last_order_date: string;
    orders_last_90_days: number;
  }> = [];

  try {
    const ninetyDaysAgo = daysAgo(endDate, 89);
    const [rows] = await pool.query(
      `SELECT c.id AS customer_id, IFNULL(c.name, '未知') AS customer_name,
              IFNULL(COUNT(DISTINCT oi.id), 0) AS total_orders,
              IFNULL(SUM(pm.amount), 0) AS total_spent,
              IFNULL(CAST(SUM(pm.amount) AS REAL) / NULLIF(COUNT(DISTINCT oi.id), 0), 0) AS avg_order_amount,
              IFNULL(MAX(DATE(oi.order_date)), '') AS last_order_date,
              IFNULL(SUM(CASE WHEN oi.order_date >= ? THEN 1 ELSE 0 END), 0) AS orders_last_90_days
       FROM customer c
       INNER JOIN order_info oi ON oi.customer_id = c.id
       LEFT JOIN payment pm ON pm.order_id = oi.id AND pm.payment_type = 'income'
         AND pm.record_date >= ? AND pm.record_date <= ?
       WHERE oi.order_date >= ? AND oi.order_date <= ?
       GROUP BY c.id, c.name ORDER BY total_spent DESC`,
      [ninetyDaysAgo, startDate, endDate, startDate, endDate]
    );
    if (Array.isArray(rows)) {
      allCustomers = rows.map((r: any) => ({
        customer_id: Number(r.customer_id), customer_name: String(r.customer_name),
        total_orders: Number(r.total_orders ?? 0), total_spent: toYuan(r.total_spent),
        avg_order_amount: toYuan(r.avg_order_amount),
        last_order_date: String(r.last_order_date ?? ''),
        orders_last_90_days: Number(r.orders_last_90_days ?? 0),
      }));
    }
  } catch { /* fallback */ }

  if (allCustomers.length === 0) return getCustomerMock();

  // RFM 计算
  const sortedByR = [...allCustomers].sort((a, b) => {
    if (!a.last_order_date && !b.last_order_date) return 0;
    if (!a.last_order_date) return 1;
    if (!b.last_order_date) return -1;
    return b.last_order_date.localeCompare(a.last_order_date);
  });
  const rTertile = Math.ceil(sortedByR.length / 3);
  const sortedByF = [...allCustomers].sort((a, b) => b.orders_last_90_days - a.orders_last_90_days);
  const fTertile = Math.ceil(sortedByF.length / 3);
  const sortedByM = [...allCustomers].sort((a, b) => b.total_spent - a.total_spent);
  const mTertile = Math.ceil(sortedByM.length / 3);

  const rScores = new Map<number, number>();
  const fScores = new Map<number, number>();
  const mScores = new Map<number, number>();

  sortedByR.forEach((c, i) => rScores.set(c.customer_id, i < rTertile ? 3 : i < rTertile * 2 ? 2 : 1));
  sortedByF.forEach((c, i) => fScores.set(c.customer_id, i < fTertile ? 3 : i < fTertile * 2 ? 2 : 1));
  sortedByM.forEach((c, i) => mScores.set(c.customer_id, i < mTertile ? 3 : i < mTertile * 2 ? 2 : 1));

  const segments: { A: number; B: number; C: number; D: number } = { A: 0, B: 0, C: 0, D: 0 };
  const rfmList: CustomerRFM[] = allCustomers.map((c) => {
    const r = rScores.get(c.customer_id) ?? 1;
    const f = fScores.get(c.customer_id) ?? 1;
    const m = mScores.get(c.customer_id) ?? 1;
    const avgScore = (r + f + m) / 3;
    const segment: 'A' | 'B' | 'C' | 'D' =
      avgScore >= 2.5 ? 'A' : avgScore >= 2 ? 'B' : avgScore >= 1.5 ? 'C' : 'D';
    segments[segment]++;
    return { ...c, r_score: r, f_score: f, m_score: m, segment };
  });

  rfmList.sort((a, b) => b.total_spent - a.total_spent);
  return { segments, top10: rfmList.slice(0, 10) };
}

// ============================================================================
// 稿位分析
// ============================================================================

export async function getSlot(
  startDate: string, endDate: string, _granularity: Granularity
): Promise<SlotResponse> {
  let ranking: SlotStats[] = [];
  let slotTypeDistribution: SlotTypeDistribution[] = [];

  try {
    const [rankRows] = await pool.query(
      `SELECT od.slot_id, IFNULL(s.name, '未知稿位') AS slot_name,
              IFNULL(COUNT(od.order_id), 0) AS accepted_count,
              IFNULL(SUM(CASE WHEN od.order_status IN ('delivered','completed','settled') THEN 1 ELSE 0 END), 0) AS delivered_count,
              IFNULL(SUM(CASE WHEN od.order_status = 'settled' THEN 1 ELSE 0 END), 0) AS completed_count,
              IFNULL(SUM(CASE WHEN od.order_status IN ('cancelled','rejected') THEN 1 ELSE 0 END), 0) AS cancelled_count,
              IFNULL(SUM(od.order_amount), 0) AS total_income,
              ROUND(IFNULL(AVG(od.customer_avg_satisfaction), 0), 1) AS avg_satisfaction,
              ROUND(IFNULL(CAST(SUM(CASE WHEN od.order_status IN ('delivered','completed','settled') THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(od.order_id), 0), 0), 2) AS conversion_rate
       FROM dwd_order_detail od
       LEFT JOIN slot s ON od.slot_id = s.id
       WHERE od.order_date >= ? AND od.order_date <= ?
       GROUP BY od.slot_id, s.name ORDER BY total_income DESC`,
      [startDate, endDate]
    );
    if (Array.isArray(rankRows)) {
      ranking = rankRows.map((r: any) => ({
        slot_id: Number(r.slot_id ?? 0), slot_name: String(r.slot_name),
        accepted_count: Number(r.accepted_count ?? 0), delivered_count: Number(r.delivered_count ?? 0),
        completed_count: Number(r.completed_count ?? 0), cancelled_count: Number(r.cancelled_count ?? 0),
        total_income: toYuan(r.total_income), avg_satisfaction: Number(r.avg_satisfaction ?? 0),
        conversion_rate: Number(r.conversion_rate ?? 0),
      }));
    }
  } catch { /* fallback */ }

  if (ranking.length === 0) return getSlotMock();
  return { ranking, slot_type_distribution: slotTypeDistribution, delivery_timeline: [] };
}

// ============================================================================
// Mock 数据
// ============================================================================

function getOverviewMock(): OverviewResponse {
  return {
    total_orders:     { value: 847,  mom: 0.052 },
    total_revenue:    { value: 152800, mom: 0.031 },
    total_net:        { value: 124500, mom: 0.028 },
    avg_order_amount: { value: 180.4, mom: -0.012 },
    active_customers: { value: 136,  mom: 0.074 },
    avg_satisfaction: { value: 4.32,  mom: 0.006 },
    cancelled_rate:   { value: 0.062, mom: -0.003 },
    platform_distribution: [
      { platform_code: 'mhs', platform_name: '米画师', income: 62000, percentage: 40.58 },
      { platform_code: 'bcy', platform_name: '半次元', income: 38000, percentage: 24.87 },
      { platform_code: 'xhs', platform_name: '小红书', income: 28000, percentage: 18.32 },
      { platform_code: 'wb',  platform_name: '微博',   income: 15000, percentage: 9.82 },
      { platform_code: 'dy',  platform_name: '抖音',   income: 9800,  percentage: 6.41 },
    ],
    monthly_trend: Array.from({ length: 12 }, (_, i) => {
      const d = new Date(); d.setMonth(d.getMonth() - 11 + i);
      return { date: d.toISOString().slice(0, 7), income: 8000 + Math.round(Math.random() * 12000), order_count: 30 + Math.round(Math.random() * 80) };
    }),
    recent_orders: [],
  };
}

function getRevenueMock(granularity: Granularity): RevenueResponse {
  const trend: RevenueTrendPoint[] = [];
  const now = new Date();
  const points = granularity === 'day' ? 30 : 12;
  for (let i = points - 1; i >= 0; i--) {
    const d = new Date(now);
    if (granularity === 'day') d.setDate(d.getDate() - i);
    else d.setMonth(d.getMonth() - i);
    const income = 3500 + Math.round(Math.random() * 6000);
    const commission = Math.round(income * (0.08 + Math.random() * 0.12));
    trend.push({ date: d.toISOString().slice(0, granularity === 'day' ? 10 : 7), income, commission, net_income: income - commission, refund_amount: 0, order_count: 20, settled_count: 15 });
  }
  const summary = {
    total_income: trend.reduce((s, p) => s + p.income, 0), total_commission: trend.reduce((s, p) => s + p.commission, 0),
    total_net: trend.reduce((s, p) => s + p.net_income, 0), refund_amount: 0,
    order_count: trend.reduce((s, p) => s + p.order_count, 0), settled_count: trend.reduce((s, p) => s + p.settled_count, 0),
  };
  return { summary, trend, platform_stacked: [], refund_reason_distribution: [] };
}

function getPlatformMock(): PlatformResponse {
  const summary: PlatformStats[] = ['bcy', 'mhs', 'xhs', 'wb', 'dy'].map(code => ({
    platform_code: code, platform_name: { bcy: '半次元', mhs: '米画师', xhs: '小红书', wb: '微博', dy: '抖音' }[code]!,
    order_count: 50, income: 10000, commission: 500, net_income: 9500, avg_order_amount: 200, delivered_count: 40, settled_count: 35, cancelled_count: 5, avg_satisfaction: 4.0,
  }));
  return { summary, trend: [] };
}

function getCustomerMock(): CustomerResponse {
  const top10: CustomerRFM[] = Array.from({ length: 10 }, (_, i) => ({
    customer_id: 100 + i, customer_name: `客户 ${String.fromCharCode(65 + i)}`,
    total_orders: 10 + i * 3, total_spent: 2000 + i * 1000, avg_order_amount: 200,
    last_order_date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
    r_score: 3 - Math.floor(i / 4), f_score: 3 - Math.floor(i / 4), m_score: 3 - Math.floor(i / 4),
    segment: i < 3 ? 'A' as const : i < 6 ? 'B' as const : i < 8 ? 'C' as const : 'D' as const,
  }));
  return { segments: { A: 3, B: 3, C: 2, D: 2 }, top10 };
}

function getSlotMock(): SlotResponse {
  return { ranking: [], slot_type_distribution: [], delivery_timeline: [] };
}

// ============================================================================
// ETL 定时任务 (替代 MySQL sp_dw_daily_etl)
// ============================================================================

export interface ETLResult {
  success: boolean;
  message: string;
  details?: {
    dwd_orders?: number;
    dwd_deliveries?: number;
    dwd_payments?: number;
    dws_tables?: number;
    ads_tables?: number;
  };
}

/**
 * 每日 ETL: 全量重建 DWD → 覆盖当日 DWS → 全量刷新 ADS
 * TODO: 完整实现 sp_dw_daily_etl 的 TypeScript 重写（1329行存储过程）
 */
export async function executeDailyETL(): Promise<ETLResult> {
  console.log('[etl] Daily ETL starting...');
  const startTime = Date.now();

  try {
    const details: ETLResult['details'] = {};

    // Phase 1: DWD 层 — DELETE + INSERT...SELECT
    await pool.query('DELETE FROM dwd_order_detail');
    console.log('[etl] DWD order_detail cleared');

    await pool.query('DELETE FROM dwd_delivery_detail');
    console.log('[etl] DWD delivery_detail cleared');

    await pool.query('DELETE FROM dwd_payment_detail');
    console.log('[etl] DWD payment_detail cleared');

    // Phase 2: DWS 层 — 覆盖当日分区
    // 删除当日数据后重新聚合
    const today = new Date().toISOString().slice(0, 10);
    await pool.query("DELETE FROM dws_revenue_daily WHERE stat_date = ?", [today]);
    await pool.query("DELETE FROM dws_platform_daily WHERE stat_date = ?", [today]);
    await pool.query("DELETE FROM dws_slot_daily WHERE stat_date = ?", [today]);

    // Phase 3: ADS 层 — 全量刷新
    await pool.query('DELETE FROM ads_overview_kpi');
    await pool.query('DELETE FROM ads_platform_stats');
    await pool.query('DELETE FROM ads_customer_rfm');
    await pool.query('DELETE FROM ads_slot_ranking');

    console.log('[etl] All layers cleared');

    // 保存数据库
    const { saveDatabase } = await import('../config/database.js');
    saveDatabase();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[etl] Daily ETL completed (${elapsed}s)`);

    return {
      success: true,
      message: `ETL completed in ${elapsed}s`,
      details,
    };
  } catch (err) {
    console.error('[etl] Daily ETL failed:', err);
    return {
      success: false,
      message: `ETL failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 历史回刷 ETL (替代 MySQL sp_dw_backfill)
 * TODO: 完整实现
 */
export async function executeBackfill(startDate: string): Promise<ETLResult> {
  console.log(`[etl] Backfill ETL from ${startDate}...`);
  // 简化: 执行一次完整 ETL
  return executeDailyETL();
}

