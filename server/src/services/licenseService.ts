// ============================================================================
// licenseService — 激活码授权验证
// 通过 GitHub 哈希表本地验证激活码，激活后写入 license 表，30 天有效期
// 哈希列表每日从 GitHub Raw 刷新，SQLite 本地缓存
// ============================================================================

import crypto from 'crypto';
import { execSync } from 'child_process';
import { pool } from '../config/database.js';

const LICENSE_VALIDITY_DAYS = 30;
const HASH_LIST_URL = 'https://raw.githubusercontent.com/zyy-opc/side-business-desktop/main/activation_hashes.enc';
const CACHE_MAX_AGE_HOURS = 24;

// AES-256-GCM 密钥（32 字节，与 Web 端共用）
const ENC_KEY = Buffer.from([
  0x7a, 0x3f, 0x91, 0x4c, 0x2e, 0x88, 0x55, 0x0d,
  0x13, 0x6b, 0x9f, 0x24, 0xa8, 0x37, 0xc1, 0x5e,
  0x4d, 0x82, 0x1a, 0x76, 0xb3, 0x0f, 0x59, 0xe8,
  0x2c, 0x67, 0xd4, 0x95, 0x18, 0xaf, 0x3b, 0xf0,
]);

function decrypt(base64: string): string {
  const buf = Buffer.from(base64, 'base64');
  const iv = buf.subarray(0, 16);
  const authTag = buf.subarray(16, 32);
  const ciphertext = buf.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// 机器标识
// ---------------------------------------------------------------------------

let cachedMachineId: string | null = null;

/**
 * 获取本机唯一标识
 * Windows: 注册表 MachineGuid → wmic csproduct get uuid → 随机 UUID
 */
export function getMachineId(): string {
  if (cachedMachineId) return cachedMachineId;

  try {
    if (process.platform === 'win32') {
      // 方案1：读取注册表 MachineGuid
      try {
        const result = execSync(
          'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
          { encoding: 'utf-8', timeout: 5000 }
        );
        const match = result.match(/MachineGuid\s+REG_SZ\s+([a-fA-F0-9\-]+)/);
        if (match?.[1]) {
          cachedMachineId = match[1];
          return cachedMachineId;
        }
      } catch { /* fall through */ }

      // 方案2：wmic csproduct get uuid
      try {
        const result = execSync('wmic csproduct get uuid', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        const lines = result.trim().split('\n');
        const uuid = lines[1]?.trim();
        if (uuid && uuid.length > 0) {
          cachedMachineId = uuid;
          return cachedMachineId;
        }
      } catch { /* fall through */ }
    }
  } catch { /* outer catch */ }

  // 方案3：生成随机 ID（兜底）
  cachedMachineId = crypto.randomUUID();
  return cachedMachineId;
}

// ---------------------------------------------------------------------------
// 哈希列表获取（GitHub Raw + SQLite 缓存）
// ---------------------------------------------------------------------------

/**
 * 从 GitHub 获取激活码哈希列表，每日刷新
 * 优先使用 SQLite 本地缓存（24h 有效期），缓存过期或网络失败时回退
 */
export async function fetchHashList(): Promise<string[]> {
  const [cacheRows] = await pool.query(
    'SELECT * FROM license_hash_cache ORDER BY id DESC LIMIT 1'
  );

  // 缓存命中且未过期，直接返回
  if (cacheRows && cacheRows.length > 0) {
    const cache = cacheRows[0] as { id: number; version: number; updated_at: string; data: string; fetched_at: string };
    const fetchedAt = new Date(cache.fetched_at);
    const hoursAgo = (Date.now() - fetchedAt.getTime()) / (1000 * 60 * 60);

    if (hoursAgo < CACHE_MAX_AGE_HOURS) {
      try {
        const parsed = JSON.parse(cache.data);
        return parsed.hashes || [];
      } catch {
        console.warn('[license] Cache parse error, will re-fetch');
      }
    }
  }

  // 从 GitHub 拉取最新哈希表（AES-256-GCM 加密）
  try {
    const response = await fetch(HASH_LIST_URL);

    if (!response.ok) {
      // 网络失败 → 回退到过期缓存
      if (cacheRows && cacheRows.length > 0) {
        console.warn(`[license] GitHub fetch failed (HTTP ${response.status}), using stale cache`);
        try {
          return JSON.parse((cacheRows[0] as any).data).hashes || [];
        } catch { /* fall through */ }
      }
      throw new Error(`无法获取激活码哈希表（HTTP ${response.status}）`);
    }

    const encryptedBase64 = await response.text();
    const plaintext = decrypt(encryptedBase64.trim());
    const json = JSON.parse(plaintext);

    // 写入 SQLite 缓存
    await pool.query(
      'INSERT INTO license_hash_cache (version, updated_at, data) VALUES (?, ?, ?)',
      [json.version || 1, json.updated_at || '', JSON.stringify(json)]
    );

    return json.hashes || [];
  } catch (err: any) {
    // 网络异常 → 回退到过期缓存
    if (cacheRows && cacheRows.length > 0) {
      console.warn('[license] Network error, using stale cache:', err.message);
      try {
        return JSON.parse((cacheRows[0] as any).data).hashes || [];
      } catch { /* fall through */ }
    }
    throw err;
  }
}

/**
 * 本地验证激活码：SHA256 后对比 GitHub 哈希表
 */
export async function validateCodeLocal(code: string): Promise<boolean> {
  const hashes = await fetchHashList();
  const codeHash = sha256(code.trim().toUpperCase());
  return hashes.includes(codeHash);
}

// ---------------------------------------------------------------------------
// 本地授权状态
// ---------------------------------------------------------------------------

export interface LicenseStatus {
  activated: boolean;
  expired: boolean;
  expiresAt: string | null;
  daysLeft: number;
}

/**
 * 检查当前授权状态（仅读本地 SQLite 缓存）
 * - 未激活：activated=false
 * - 已过期：activated=true, expired=true, daysLeft=0
 * - 正常：activated=true, expired=false, daysLeft > 0
 */
export async function checkLicense(): Promise<LicenseStatus> {
  try {
    const [rows] = await pool.query(
      "SELECT code_hash, activated_at, expires_at FROM license ORDER BY id DESC LIMIT 1"
    );

    if (!rows || rows.length === 0) {
      return { activated: false, expired: false, expiresAt: null, daysLeft: 0 };
    }

    const record = rows[0] as { code_hash: string; activated_at: string; expires_at: string };
    const now = new Date().toISOString();
    const expired = now > record.expires_at;
    const daysLeft = expired ? 0 : Math.max(0, daysBetween(now, record.expires_at));

    return {
      activated: true,
      expired,
      expiresAt: record.expires_at,
      daysLeft,
    };
  } catch (err) {
    console.error('[license] checkLicense error:', err);
    return { activated: false, expired: false, expiresAt: null, daysLeft: 0 };
  }
}

// ---------------------------------------------------------------------------
// 激活
// ---------------------------------------------------------------------------

export interface ActivateCodeResult {
  valid: boolean;
  message: string;
  days?: number;
}

/**
 * 激活授权码：本地 SHA256 对比 GitHub 哈希表，通过后写入 license 表
 */
export async function activateCode(code: string, serverUrl?: string): Promise<ActivateCodeResult> {
  const trimmed = code.trim().toUpperCase();

  // 本地哈希验证
  const valid = await validateCodeLocal(trimmed);
  if (!valid) {
    return { valid: false, message: '激活码无效' };
  }

  // 检查是否已被本机激活过
  const codeHash = sha256(trimmed);
  const [existingRows] = await pool.query(
    'SELECT id FROM license WHERE code_hash = ?',
    [codeHash]
  );
  if (existingRows && existingRows.length > 0) {
    return { valid: false, message: '该激活码已被使用' };
  }

  // 写入本地 license 表
  const now = new Date();
  const activatedAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + LICENSE_VALIDITY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  try {
    await pool.query(
      `INSERT INTO license (code_hash, activated_at, expires_at)
       VALUES (?, ?, ?)`,
      [codeHash, activatedAt, expiresAt]
    );

    // 回调服务器标记激活码已使用（非阻塞）
    if (serverUrl) {
      const machineId = getMachineId();
      const http = require('http');
      const body = JSON.stringify({ code: trimmed, machine_id: machineId });
      const url = new URL(`${serverUrl}/api/v1/license/verify`);
      const options = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 5000,
      };
      const req = http.request(options);
      req.on('error', () => { /* 回调失败不阻断激活 */ });
      req.write(body);
      req.end();
    }

    return {
      valid: true,
      message: '激活成功',
      days: LICENSE_VALIDITY_DAYS,
    };
  } catch (err) {
    console.error('[license] activateCode error:', err);
    return { valid: false, message: '激活失败，请稍后重试' };
  }
}
