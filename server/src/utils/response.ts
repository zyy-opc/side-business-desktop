// ============================================================================
// 统一响应工具 — Express res 模式
// ============================================================================

import { Response } from 'express';
import type { ApiResponse, PaginatedResult, PageParams, PageQuery } from '../types/index.js';

export function success<T>(res: Response, data: T, message = 'ok', code = 0, status = 200): void {
  const body: ApiResponse<T> = { code, message, data };
  res.status(status).json(body);
}

export function successPaginated<T>(res: Response, paginated: PaginatedResult<T>): void {
  const body: ApiResponse<PaginatedResult<T>> = { code: 0, message: 'ok', data: paginated };
  res.status(200).json(body);
}

export function created<T>(res: Response, data: T, message = '创建成功'): void {
  success(res, data, message, 0, 201);
}

export function fail(res: Response, message: string, code = 40000, status = 400): void {
  const body: ApiResponse<null> = { code, message, data: null };
  res.status(status).json(body);
}

export function notFound(res: Response, message = '资源不存在'): void {
  fail(res, message, 40400, 404);
}

export function forbidden(res: Response, message = '当前状态不允许此操作'): void {
  fail(res, message, 40310, 403);
}

export function duplicate(res: Response, message = '数据重复'): void {
  fail(res, message, 40010, 409);
}

export function serverError(res: Response, err: unknown): void {
  const message = err instanceof Error ? err.message : '服务器内部错误';
  console.error('[server-error]', err);
  fail(res, message, 50000, 500);
}

export function parsePagination(query: PageQuery): PageParams {
  const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
  const page_size = Math.min(100, Math.max(1, parseInt(query.page_size || '20', 10) || 20));
  return { page, page_size };
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) {
    return '00:00:00';
  }
  const totalSecs = Math.round(seconds);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
