// ============================================================================
// OCR 服务 — Tesseract.js 集成，替代 Python easyocr
// 延迟加载：首次 OCR 请求时才 createWorker()
// Worker 单例：全局复用，不每次请求创建
// ============================================================================

import path from 'path';
import fs from 'fs';
import { getTessdataPath, getTesseractCachePath } from '../config/paths.js';

let worker: any = null;
let initPromise: Promise<any> | null = null;

/** 获取 Tesseract.js Worker（延迟初始化，单例） */
async function getWorker(): Promise<any> {
  if (worker) return worker;

  // 防止并发初始化
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { createWorker } = await import('tesseract.js');

    const tessdataPath = getTessdataPath();
    const cachePath = getTesseractCachePath();

    // 确保缓存目录存在
    if (!fs.existsSync(cachePath)) {
      fs.mkdirSync(cachePath, { recursive: true });
    }

    console.log('[ocr] Initializing Tesseract.js worker (chi_sim)...');
    const startTime = Date.now();

    worker = await createWorker('chi_sim', 1, {
      langPath: tessdataPath,
      cachePath: cachePath,
    });

    await worker.setParameters({
      tessedit_pageseg_mode: '6', // 统一文本块
      tessedit_char_whitelist: '', // 不限制字符集
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[ocr] Worker ready (${elapsed}s)`);

    return worker;
  })();

  return initPromise;
}

/**
 * 从图片 Buffer 提取文字
 * @param imageBuffer 图片二进制数据
 * @returns 识别出的文本
 */
export async function extractText(imageBuffer: Buffer): Promise<string> {
  try {
    const w = await getWorker();
    const { data } = await w.recognize(imageBuffer);
    return (data.text || '').trim();
  } catch (err) {
    console.error('[ocr] extractText failed:', err);
    throw new Error(`OCR 识别失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 销毁 Worker（应用退出时调用）
 */
export async function terminateWorker(): Promise<void> {
  if (worker) {
    try {
      await worker.terminate();
      console.log('[ocr] Worker terminated');
    } catch (err) {
      console.warn('[ocr] Worker termination error:', err);
    }
    worker = null;
    initPromise = null;
  }
}

/**
 * 预热 Worker（可选，后台异步调用不阻塞启动）
 */
export function warmupWorker(): void {
  getWorker().then(() => {
    console.log('[ocr] Warmup complete');
  }).catch((err) => {
    console.warn('[ocr] Warmup failed:', err);
  });
}
