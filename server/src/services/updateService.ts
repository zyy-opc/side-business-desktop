// ============================================================================
// 版本更新检测服务
// 从 GitHub 拉取 version.json，对比本地版本号
// ============================================================================

import https from 'https';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const VERSION_URL = 'https://raw.githubusercontent.com/zyy-opc/side-business-desktop/master/version.json';

/** 本地版本号，从 package.json 读取 */
function getLocalVersion(): string {
  try {
    const pkgPath = resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '1.0.0';
  }
}

interface RemoteVersion {
  version: string;
  release_url: string;
  release_notes: string;
}

interface UpdateCheckResult {
  hasUpdate: boolean;
  localVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
}

/** 对比版本号，返回 true 表示 latest > current */
function isNewer(current: string, latest: string): boolean {
  const cur = current.split('.').map(Number);
  const lat = latest.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((lat[i] || 0) > (cur[i] || 0)) return true;
    if ((lat[i] || 0) < (cur[i] || 0)) return false;
  }
  return false;
}

/** HTTP GET 请求 */
function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject).on('timeout', function(this: { destroy: () => void }) {
      this.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

export async function checkUpdate(): Promise<UpdateCheckResult> {
  const localVersion = getLocalVersion();

  try {
    const body = await httpGet(VERSION_URL);
    const remote: RemoteVersion = JSON.parse(body);

    return {
      hasUpdate: isNewer(localVersion, remote.version),
      localVersion,
      latestVersion: remote.version,
      releaseUrl: remote.release_url,
      releaseNotes: remote.release_notes,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.warn(`[update] Failed to check update: ${message}`);
    return {
      hasUpdate: false,
      localVersion,
      latestVersion: localVersion,
      releaseUrl: '',
      releaseNotes: '',
    };
  }
}
