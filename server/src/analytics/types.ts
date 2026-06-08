// ============================================================================
// analytics — 数据分析模块类型定义
// 金额字段: INTEGER(分)，API 返回时需 /100 转换为元
// ============================================================================

export type Granularity = 'day' | 'week' | 'month';
export const GRANULARITY_VALUES: Granularity[] = ['day', 'week', 'month'];

export interface AnalyticsQuery {
  start_date?: string;
  end_date?: string;
  granularity?: Granularity;
}

export interface AnalyticsKPICard {
  value: number;
  mom: number | null;
}

export interface PlatformDistribution {
  platform_code: string;
  platform_name: string;
  income: number;
  percentage: number;
}

export interface MonthlyTrendPoint {
  date: string;
  income: number;
  order_count: number;
}

export interface RecentOrder {
  id: number;
  order_no: string;
  order_status: string;
  order_amount: number;
  customer_name: string;
  platform_name: string;
}

export interface OverviewResponse {
  total_orders: AnalyticsKPICard;
  total_revenue: AnalyticsKPICard;
  total_net: AnalyticsKPICard;
  avg_order_amount: AnalyticsKPICard;
  active_customers: AnalyticsKPICard;
  avg_satisfaction: AnalyticsKPICard;
  cancelled_rate: AnalyticsKPICard;
  platform_distribution: PlatformDistribution[];
  monthly_trend: MonthlyTrendPoint[];
  recent_orders: RecentOrder[];
}

export interface RevenueTrendPoint {
  date: string;
  income: number;
  commission: number;
  net_income: number;
  refund_amount: number;
  order_count: number;
  settled_count: number;
}

export interface PlatformStackedPoint {
  platform_code: string;
  platform_name: string;
  date: string;
  income: number;
}

export interface RefundReasonItem {
  name: string;
  amount: number;
  percentage: number;
}

export interface RevenueResponse {
  summary: {
    total_income: number;
    total_commission: number;
    total_net: number;
    refund_amount: number;
    order_count: number;
    settled_count: number;
  };
  trend: RevenueTrendPoint[];
  platform_stacked: PlatformStackedPoint[];
  refund_reason_distribution: RefundReasonItem[];
}

export interface PlatformStats {
  platform_code: string;
  platform_name: string;
  order_count: number;
  income: number;
  commission: number;
  net_income: number;
  avg_order_amount: number;
  delivered_count: number;
  settled_count: number;
  cancelled_count: number;
  avg_satisfaction: number;
}

export interface PlatformResponse {
  summary: PlatformStats[];
  trend: Array<{
    date: string;
    platform_code: string;
    income: number;
    order_count: number;
  }>;
}

export interface CustomerRFM {
  customer_id: number;
  customer_name: string;
  total_orders: number;
  total_spent: number;
  avg_order_amount: number;
  last_order_date: string;
  r_score: number;
  f_score: number;
  m_score: number;
  segment: 'A' | 'B' | 'C' | 'D';
}

export interface CustomerResponse {
  segments: { A: number; B: number; C: number; D: number };
  top10: CustomerRFM[];
}

export interface SlotStats {
  slot_id: number;
  slot_name: string;
  accepted_count: number;
  delivered_count: number;
  completed_count: number;
  cancelled_count: number;
  total_income: number;
  avg_satisfaction: number;
  conversion_rate: number;
}

export interface SlotTypeDistribution {
  slot_type_id: string;
  slot_type_name: string;
  order_count: number;
  income: number;
  percentage: number;
}

export interface DeliveryTimeline {
  slot_id: number;
  slot_name: string;
  avg_delivery_days: number;
  median_delivery_days: number;
  min_delivery_days: number;
  max_delivery_days: number;
  order_count: number;
}

export interface SlotResponse {
  ranking: SlotStats[];
  slot_type_distribution: SlotTypeDistribution[];
  delivery_timeline: DeliveryTimeline[];
}
