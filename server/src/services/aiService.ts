// ============================================================================
// aiService — 图片提取（Stage 1 占位，Stage 2 替换为 Tesseract.js）
// ============================================================================

/**
 * 从 base64 图片中提取结构化信息。
 * Stage 1: 占位实现，返回错误提示。
 * Stage 2: 集成 Tesseract.js OCR。
 */
export async function extractFromImage(
  _imageBase64: string,
  _prompt: string,
  _schema: Record<string, unknown>,
  _extractType: 'customer' | 'order',
): Promise<Record<string, unknown>> {
  // Stage 1 占位: OCR 功能将在 Stage 2 集成 Tesseract.js 后可用
  throw new Error('OCR 功能即将上线，当前版本暂不支持图片提取。请手动填写信息。');
}
