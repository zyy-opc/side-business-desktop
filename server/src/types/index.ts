// ============================================================================
// 接稿业务管理系统 — 类型定义 (SQLite 适配版)
// 金额字段: INTEGER(分) 存储，应用层通过 centsToYuan/yuanToCents 转换
// ============================================================================

// ---- 金额转换工具 ----

export const centsToYuan = (cents: number | null | undefined): number => {
  if (cents === null || cents === undefined) return 0;
  return Math.round(cents) / 100;
};

export const yuanToCents = (yuan: number | null | undefined): number => {
  if (yuan === null || yuan === undefined) return 0;
  return Math.round(yuan * 100);
};

/** 万分比转百分比 (commission_rate: 万分比 -> %) */
export const rateToPercent = (rate: number | null | undefined): number => {
  if (rate === null || rate === undefined) return 0;
  return rate / 10000 * 100;
};

/** 百分比转万分比 */
export const percentToRate = (percent: number | null | undefined): number => {
  if (percent === null || percent === undefined) return 0;
  return Math.round(percent / 100 * 10000);
};

// ---- 枚举类型 ----

export type PlatformType = 'commission' | 'social' | 'submission';
export type PlatformStatus = 'active' | 'inactive';

export type SlotCategory = 'normal' | 'welfare';
export type SlotDeliveryMethod = 'before_deadline' | 'after_acceptance';
export type SlotStatus = 'pending_publish' | 'on_sale' | 'off_shelf';
export type SlotCloseReason = 'full' | 'manual' | 'expired';

export type OrderStatus = 'pending' | 'queued' | 'in_progress' | 'delivered' | 'revising' | 'settled' | 'rejected' | 'cancelled' | 'overdue';

export type CurrentProgress = 'queued' | 'in_progress' | 'delivered' | 'revising';
export type TimerStatus = 'idle' | 'running' | 'paused';

export type PaymentType = 'income' | 'refund';
export type PaymentStatus = 'pending' | 'received' | 'failed';
export type PaymentMethod = 'alipay' | 'wechat' | 'bank' | 'platform' | 'paypal' | 'other';

export type ApplicableType = 'reject' | 'cancel' | 'refund' | 'all';
export type RefundReasonStatus = 'active' | 'inactive';

// ---- 实体类型 (amount 字段存储为 INTEGER 分，此处标注原始含义) ----

export interface Platform {
  id: number;
  name: string;
  code: string;
  platform_type: PlatformType;
  url: string | null;
  commission_rate: number | null;  // 万分比
  status: PlatformStatus;
  sort_order: number;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: number;
  customer_uid: string;
  name: string;
  platform_id: number;
  avg_rating: number | null;
  total_rating: number | null;
  avg_satisfaction: number | null;
  total_satisfaction: number | null;
  cancelled_order_count: number;
  first_order_date: string | null;
  last_order_date: string | null;
  total_orders: number;
  total_spent: number | null;  // 分
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface SlotType {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Slot {
  id: number;
  name: string;
  type_name: string;
  slot_type_id: string | null;
  category: SlotCategory;
  category_desc: string | null;
  current_price: number;  // 分
  min_price: number | null;  // 分
  max_price: number | null;  // 分
  max_quantity: number;
  accepted_quantity: number;
  cancelled_quantity: number;
  delivered_quantity: number;
  completed_quantity: number;
  avg_satisfaction: number | null;
  delivery_method: SlotDeliveryMethod;
  delivery_time: string;
  is_auto_close: number;
  status: SlotStatus;
  close_date: string | null;
  close_reason: SlotCloseReason | null;
  sort_order: number;
  description: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderInfo {
  id: number;
  order_no: string;
  doc_no: string | null;
  customer_id: number;
  platform_id: number;
  platform_order_id: string | null;
  slot_id: number | null;
  order_amount: number;  // 分
  commission_rate: number | null;  // 万分比
  commission_amount: number | null;  // 分
  net_income: number | null;  // 分
  order_date: string;
  accepted_time: string | null;
  start_drawing_time: string | null;
  estimated_delivery_time: string | null;
  actual_delivery_time: string | null;
  actual_settlement_time: string | null;
  requirement_desc: string | null;
  order_status: OrderStatus;
  refund_reason_id: number | null;
  remark: string | null;
  session_duration: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProgressLog {
  id: number;
  order_id: number;
  update_time: string;
  current_progress: CurrentProgress;
  progress_desc: string | null;
  attachment_desc: string | null;
  session_duration: number | null;
  total_duration: number;
  timer_status: TimerStatus;
  timer_start_time: string | null;
  status_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface Delivery {
  id: number;
  order_id: number;
  delivery_time: string;
  delivery_desc: string | null;
  revision_count: number;
  is_accepted: number;
  customer_rating: number | null;
  customer_satisfaction: number | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: number;
  order_id: number;
  payment_type: PaymentType;
  payment_status: PaymentStatus;
  record_date: string;
  arrival_date: string | null;
  amount: number;  // 分
  payment_method: PaymentMethod | null;
  is_platform_settlement: number;
  refund_reason_id: number | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface RefundReason {
  id: number;
  name: string;
  applicable_type: ApplicableType;
  description: string | null;
  status: RefundReasonStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ---- 创建/更新请求体 ----

export interface PlatformCreate {
  name: string;
  code: string;
  platform_type?: PlatformType;
  url?: string;
  commission_rate?: number;
  sort_order?: number;
  remark?: string;
}

export interface PlatformUpdate {
  name?: string;
  code?: string;
  platform_type?: PlatformType;
  url?: string;
  commission_rate?: number;
  sort_order?: number;
  remark?: string;
}

export interface CustomerCreate {
  customer_uid: string;
  name: string;
  platform_id: number;
  remark?: string;
}

export interface CustomerUpdate {
  customer_uid?: string;
  name?: string;
  platform_id?: number;
  remark?: string;
}

export interface SlotCreate {
  name: string;
  slot_type_id: string;
  category?: SlotCategory;
  category_desc?: string;
  current_price: number;  // 元（前端传入），需 yuanToCents 转换
  min_price?: number;
  max_price?: number;
  max_quantity: number;
  delivery_method: SlotDeliveryMethod;
  delivery_time: string;
  is_auto_close?: number;
  sort_order?: number;
  description?: string;
  remark?: string;
}

export interface SlotUpdate {
  name?: string;
  slot_type_id?: string;
  category?: SlotCategory;
  category_desc?: string;
  current_price?: number;
  min_price?: number;
  max_price?: number;
  max_quantity?: number;
  delivery_method?: SlotDeliveryMethod;
  delivery_time?: string;
  is_auto_close?: number;
  sort_order?: number;
  description?: string;
  remark?: string;
}

export interface OrderCreate {
  customer_id: number;
  platform_id: number;
  platform_order_id?: string;
  slot_id?: number;
  order_amount: number;  // 元（前端传入）
  commission_rate?: number;
  order_date: string;
  estimated_delivery_time?: string;
  requirement_desc?: string;
  remark?: string;
}

export interface OrderUpdate {
  platform_order_id?: string;
  slot_id?: number | null;
  order_amount?: number;
  commission_rate?: number;
  order_date?: string;
  estimated_delivery_time?: string | null;
  requirement_desc?: string;
  remark?: string;
}

export interface ProgressLogCreate {
  order_id: number;
  current_progress: CurrentProgress;
  progress_desc?: string;
  attachment_desc?: string;
  session_duration?: number;
}

export interface DeliveryCreate {
  order_id: number;
  is_accepted: 1;
  delivery_desc?: string;
  customer_rating?: number;
  customer_satisfaction?: number;
  remark?: string;
}

export interface DeliveryRevise {
  order_id: number;
  is_accepted: 0;
  delivery_desc?: string;
  customer_rating?: number;
  customer_satisfaction?: number;
  remark?: string;
}

export interface DeliveryUpdate {
  order_id?: number;
  is_accepted?: number;
  delivery_desc?: string;
  customer_rating?: number;
  customer_satisfaction?: number;
  remark?: string;
}

export interface PaymentCreate {
  payment_type: PaymentType;
  amount: number;  // 元（前端传入）
  payment_status?: PaymentStatus;
  record_date?: string;
  arrival_date?: string;
  payment_method?: PaymentMethod;
  is_platform_settlement?: number;
  refund_reason_id?: number;
  remark?: string;
}

export interface PaymentIncomeCreate {
  order_id: number;
  amount?: number;
  payment_status?: PaymentStatus;
  record_date?: string;
  arrival_date?: string;
  payment_method?: PaymentMethod;
  is_platform_settlement?: number;
  remark?: string;
}

export interface PaymentRefundCreate {
  order_id: number;
  amount: number;
  refund_reason_id: number;
  record_date?: string;
  arrival_date?: string;
  payment_method?: PaymentMethod;
  remark?: string;
}

export interface PaymentUpdate {
  payment_type?: PaymentType;
  amount?: number;
  payment_status?: PaymentStatus;
  record_date?: string;
  arrival_date?: string;
  payment_method?: PaymentMethod;
  is_platform_settlement?: number;
  refund_reason_id?: number;
  remark?: string;
}

export interface RefundReasonCreate {
  name: string;
  applicable_type: ApplicableType;
  description?: string;
  sort_order?: number;
}

export interface RefundReasonUpdate {
  name?: string;
  applicable_type?: ApplicableType;
  description?: string;
  sort_order?: number;
}

export interface SlotTypeCreate {
  id: string;
  name: string;
}

export interface SlotTypeUpdate {
  name?: string;
}

export interface ProgressOrderRecord {
  id: number;
  order_no: string;
  customer_id: number;
  platform_id: number;
  order_status: OrderStatus;
  accepted_time: string | null;
  current_progress: CurrentProgress | null;
  timer_status: TimerStatus | null;
  total_duration: number;
  last_progress_time: string | null;
}

export interface ProgressOrderQuery {
  page?: string;
  page_size?: string;
  order_status?: string;
  include_settled?: string;
}

// ---- 分页 ----

export interface PageParams {
  page: number;
  page_size: number;
}

export interface PageQuery {
  page?: string;
  page_size?: string;
}

export interface PaginatedResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---- 统一响应 ----

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T | null;
}

// ---- 状态机 ----

export interface StateTransitionResult {
  success: boolean;
  message: string;
  data?: any;
}

export const TERMINAL_STATUSES: OrderStatus[] = ['settled', 'rejected', 'cancelled'];
export const NON_TERMINAL_STATUSES: OrderStatus[] = ['pending', 'queued', 'in_progress', 'delivered', 'revising', 'overdue'];
export const PROGRESS_ALLOWED_ORDER_STATUSES: OrderStatus[] = ['queued', 'in_progress', 'overdue', 'revising', 'delivered'];
export const DELIVERY_ALLOWED_ORDER_STATUSES: OrderStatus[] = ['delivered', 'revising'];

// ---- 授权 ----

export interface LicenseRecord {
  id: number;
  code_hash: string;
  activated_at: string;
  expires_at: string;
  created_at: string;
}

export interface LicenseStatus {
  activated: boolean;
  expired: boolean;
  expiresAt: string | null;
  daysLeft: number;
}

export interface ActivateCodeResult {
  valid: boolean;
  message: string;
  days?: number;
}
