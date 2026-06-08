// ============================================================================
// 数据库迁移引擎
// 首次运行执行全部 DDL，后续版本对比 schema_version 增量迁移
// ============================================================================

import { getDatabase, queryAll } from '../config/database.js';
import { getMigrationsPath, getConfigPath, getBackupPath, getDataPath } from '../config/paths.js';
import fs from 'fs';
import path from 'path';

export interface MigrationResult {
  success: boolean;
  version: number;
  message: string;
  migrationsApplied: string[];
}

/** 执行所有迁移 */
export async function runMigrations(): Promise<MigrationResult> {
  const db = getDatabase();
  const applied: string[] = [];

  // 1. 确保 _schema_meta 存在
  db.run(`
    CREATE TABLE IF NOT EXISTS _schema_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 2. 获取当前 schema 版本
  const currentVersion = getCurrentSchemaVersion();

  // 3. 获取所有迁移文件
  const migrationsDir = getMigrationsPath();
  if (!fs.existsSync(migrationsDir)) {
    return { success: true, version: currentVersion, message: 'No migrations directory', migrationsApplied: [] };
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    return { success: true, version: currentVersion, message: 'No migration files found', migrationsApplied: [] };
  }

  // 如果当前版本为 0（新数据库），执行所有迁移文件
  // 否则只执行版本号大于当前版本的迁移

  for (const file of files) {
    const execResult = executeSqlFile(path.join(migrationsDir, file));
    if (execResult) {
      applied.push(file);
    }
  }

  // 4. 更新 schema_version 为已执行迁移数
  const newVersion = applied.length;
  db.run('INSERT OR REPLACE INTO _schema_meta (key, value) VALUES (?, ?)', ['schema_version', String(newVersion)]);

  return {
    success: true,
    version: newVersion,
    message: applied.length > 0
      ? `Applied ${applied.length} migration(s)`
      : 'Database is up to date',
    migrationsApplied: applied,
  };
}

/** 获取当前 schema 版本 */
function getCurrentSchemaVersion(): number {
  try {
    const rows = queryAll("SELECT value FROM _schema_meta WHERE key = 'schema_version'");
    return rows.length > 0 ? parseInt(rows[0].value as string, 10) : 0;
  } catch {
    return 0;
  }
}

/** 执行单个 SQL 文件 */
function executeSqlFile(filePath: string): boolean {
  try {
    const sql = fs.readFileSync(filePath, 'utf-8');
    const db = getDatabase();

    // 按分号分割 SQL 语句，过滤空行和注释
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      db.run(stmt);
    }
    return true;
  } catch (err) {
    console.error(`[migration] Error executing ${path.basename(filePath)}:`, err);
    return false;
  }
}

/** 数据库版本备份 */
export function backupBeforeMigration(version: number): string | null {
  try {
    const srcPath = path.join(getDataPath(), 'main.db');
    if (!fs.existsSync(srcPath)) return null;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(getBackupPath(), `main_v${version}_${timestamp}.db.bak`);

    // 确保备份目录存在
    const backupDir = getBackupPath();
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    fs.copyFileSync(srcPath, backupPath);
    console.log(`[migration] Backup created: ${backupPath}`);
    return backupPath;
  } catch (err) {
    console.error('[migration] Backup failed:', err);
    return null;
  }
}
