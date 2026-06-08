// ============================================================================
// 路径工具 — 区分开发环境与 pkg 打包环境
// ============================================================================

import path from 'path';
import fs from 'fs';

/** 获取 APPDATA 下的用户数据根目录 */
export function getAppDataPath(): string {
  const appData = process.env.APPDATA || path.join(process.env.HOME || '', 'AppData', 'Roaming');
  return path.join(appData, 'side-business-system');
}

/** 获取数据文件目录 (SQLite database) */
export function getDataPath(): string {
  return path.join(getAppDataPath(), 'data');
}

/** 获取配置目录 */
export function getConfigPath(): string {
  return path.join(getAppDataPath(), 'config');
}

/** 获取备份目录 */
export function getBackupPath(): string {
  return path.join(getAppDataPath(), 'backups');
}

/** 获取日志目录 */
export function getLogPath(): string {
  return path.join(getAppDataPath(), 'logs');
}

/** 获取 Tesseract 缓存目录 */
export function getTesseractCachePath(): string {
  return path.join(getAppDataPath(), 'tesseract-cache');
}

/** 确保所有用户数据目录存在 */
export function ensureDataDirs(): void {
  const dirs = [getDataPath(), getConfigPath(), getBackupPath(), getLogPath(), getTesseractCachePath()];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * 获取打包资源路径
 * pkg 打包环境下 __dirname 指向快照内，开发环境指向实际文件系统
 */
export function getAssetPath(relativePath: string): string {
  // @ts-ignore — process.pkg 在 pkg 运行时存在
  if (process.pkg) {
    return path.join(__dirname, relativePath);
  }
  return path.join(process.cwd(), relativePath);
}

/** 获取迁移 SQL 目录 */
export function getMigrationsPath(): string {
  return getAssetPath('migrations');
}

/** 获取 tessdata 目录 */
export function getTessdataPath(): string {
  return getAssetPath('tessdata');
}
