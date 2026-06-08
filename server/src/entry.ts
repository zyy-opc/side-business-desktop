// ============================================================================
// side-business-desktop 启动入口
// 流程: 首次初始化 → 版本检查 → 数据库初始化 → 启动 Express
// ============================================================================

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { initDatabase, closeDatabase, saveDatabase } from './config/database.js';
import { ensureDataDirs, getAssetPath, getDataPath, getLogPath } from './config/paths.js';
import { runMigrations, backupBeforeMigration } from './services/migrationService.js';
import { checkLicense } from './services/licenseService.js';
import { warmupWorker, terminateWorker } from './services/ocrService.js';

// 路由导入
import platformRoutes from './routes/platform.js';
import customerRoutes from './routes/customer.js';
import slotRoutes from './routes/slot.js';
import slotTypeRoutes from './routes/slotType.js';
import orderRoutes from './routes/order.js';
import calendarRoutes from './routes/calendar.js';
import progressLogRoutes from './routes/progressLog.js';
import progressOrderRoutes from './routes/progressOrder.js';
import deliveryRoutes from './routes/delivery.js';
import paymentRoutes from './routes/payment.js';
import refundReasonRoutes from './routes/refundReason.js';
import comfortMessageRoutes from './routes/comfortMessage.js';
import licenseRoutes from './routes/license.js';
import updateRoutes from './routes/update.js';
import analyticsStub from './analytics/router.js';

const app = express();
const DEFAULT_PORT = 3000;

// ============================================================================
// 启动流程
// ============================================================================

/** 写入启动日志到 logs/startup.log */
function startupLog(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    const logDir = getLogPath();
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(path.join(logDir, 'startup.log'), line);
  } catch {
    process.stderr.write(line);
  }
}

async function startup(): Promise<void> {
  startupLog('========== 接稿业务管理系统 v1.0.0 启动 ==========');
  startupLog(`平台: ${process.platform}, Node: ${process.version}, pkg: ${!!(process as any).pkg}`);
  startupLog(`cwd: ${process.cwd()}, execPath: ${process.execPath}`);

  // 1. 确保用户数据目录存在
  try {
    ensureDataDirs();
    startupLog('ensureDataDirs: OK');
  } catch (err: any) {
    startupLog(`ensureDataDirs: FAILED - ${err.message}\n${err.stack || ''}`);
    throw err;
  }

  // 2. 初始化数据库
  try {
    const db = await initDatabase();
    startupLog('initDatabase: OK');
  } catch (err: any) {
    startupLog(`initDatabase: FAILED - ${err.message}\n${err.stack || ''}`);
    throw err;
  }

  // 3. 首次运行？执行迁移
  const dbPath = path.join(getDataPath(), 'main.db');
  const isNewDb = !fs.existsSync(dbPath) || (() => {
    try {
      const stat = fs.statSync(dbPath);
      return stat.size < 1024; // 小于1KB视为新数据库
    } catch { return true; }
  })();

  // 备份旧数据库
  if (!isNewDb) {
    try {
      backupBeforeMigration(0);
      startupLog('backupBeforeMigration: OK');
    } catch (err: any) {
      startupLog(`backupBeforeMigration: FAILED - ${err.message}\n${err.stack || ''}`);
      // 备份失败不阻断启动
    }
  }

  // 执行迁移
  try {
    const migration = await runMigrations();
    startupLog(`runMigrations: OK (${migration.message})`);

    if (!migration.success) {
      startupLog('runMigrations: migration returned success=false');
      throw new Error('Migration failed');
    }
  } catch (err: any) {
    startupLog(`runMigrations: FAILED - ${err.message}\n${err.stack || ''}`);
    throw err;
  }

  // 3.5 授权检查
  try {
    const initLicenseStatus = await checkLicense();
    if (initLicenseStatus.activated && !initLicenseStatus.expired) {
      startupLog(`checkLicense: activated, ${initLicenseStatus.daysLeft} days remaining`);
    } else if (initLicenseStatus.activated && initLicenseStatus.expired) {
      startupLog('checkLicense: EXPIRED');
    } else {
      startupLog('checkLicense: not activated');
    }
  } catch (err: any) {
    startupLog(`checkLicense: FAILED - ${err.message}\n${err.stack || ''}`);
    // 授权检查失败不阻断启动，仅记录日志
  }

  // 4. 配置 Express
  try {
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));

    // 静态文件服务 — 前端 build 产物
    const clientDist = getAssetPath('client-dist');
    startupLog(`clientDist path: ${clientDist}, exists: ${fs.existsSync(clientDist)}`);
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get('*', (_req, res) => {
        const indexPath = path.join(clientDist, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).json({ code: 404, message: 'Frontend not found' });
        }
      });
    } else {
      startupLog('WARNING: client-dist not found, frontend will not be served');
    }

    // Health check
    app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
    });

    // Shutdown API（供升级/卸载使用）
    app.get('/api/shutdown', (_req, res) => {
      res.json({ status: 'shutting_down' });
      setTimeout(() => gracefulShutdown(), 500);
    });

    // API routes — no guard: license & update are always accessible
    app.use('/api/v1/license', licenseRoutes);
    app.use('/api/v1/update', updateRoutes);

    // License guard: block all other /api/v1/* routes when not activated
    app.use('/api/v1', async (req, res, next) => {
      // Allow license endpoints even when not activated
      if (req.path === '/license/activate' || req.path === '/license/status') return next();
      const status = await checkLicense();
      if (status.activated && !status.expired) return next();
      res.status(403).json({
        code: 40310,
        message: '系统未激活，请先激活后再使用',
        data: null,
      });
    });

    app.use('/api/v1/platforms', platformRoutes);
    app.use('/api/v1/customers', customerRoutes);
    app.use('/api/v1/slots', slotRoutes);
    app.use('/api/v1/slot-types', slotTypeRoutes);
    app.use('/api/v1/orders/calendar', calendarRoutes);
    app.use('/api/v1/orders', orderRoutes);
    app.use('/api/v1/progress-logs', progressLogRoutes);
    app.use('/api/v1/progress-orders', progressOrderRoutes);
    app.use('/api/v1/deliveries', deliveryRoutes);
    app.use('/api/v1/payments', paymentRoutes);
    app.use('/api/v1/refund-reasons', refundReasonRoutes);
    app.use('/api/v1/comfort-messages', comfortMessageRoutes);
    app.use('/api/v1/analytics', analyticsStub);

    startupLog('Express routes: OK');
  } catch (err: any) {
    startupLog(`Express setup: FAILED - ${err.message}\n${err.stack || ''}`);
    throw err;
  }

  // 5. 端口检测与启动
  let port: number;
  try {
    port = await findAvailablePort(DEFAULT_PORT);
    startupLog(`findAvailablePort: ${port}`);
  } catch (err: any) {
    startupLog(`findAvailablePort: FAILED - ${err.message}\n${err.stack || ''}`);
    throw err;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const server = app.listen(port, () => {
        startupLog(`Express listen: OK (port ${port})`);
        resolve();
      });
      server.on('error', (err: any) => {
        startupLog(`Express listen: FAILED - ${err.message}`);
        reject(err);
      });
    });
  } catch (err: any) {
    startupLog(`Express listen: FAILED - ${err.message}\n${err.stack || ''}`);
    throw err;
  }

  // 6. 打开浏览器（根据授权状态决定跳转页面）
  try {
    const licenseStatus = await checkLicense();
    const activatePage = !licenseStatus.activated || licenseStatus.expired;
    const urlPath = activatePage ? '/activate' : '/';
    openBrowser(port, urlPath);
    startupLog(`openBrowser: ${urlPath} (activated=${licenseStatus.activated}, expired=${licenseStatus.expired})`);
  } catch (err: any) {
    startupLog(`openBrowser: FAILED - ${err.message}`);
    // 浏览器打开失败不阻断启动
  }

  // 7. 后台预热 OCR Worker (不阻塞启动)
  try {
    warmupWorker();
    startupLog('warmupWorker: started (background)');
  } catch (err: any) {
    startupLog(`warmupWorker: FAILED - ${err.message}`);
  }
}

// ============================================================================
// 端口检测
// ============================================================================

async function findAvailablePort(startPort: number): Promise<number> {
  const net = await import('net');
  let port = startPort;

  while (port < startPort + 100) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
      server.on('error', () => resolve(false));
    });
    if (available) return port;
    port++;
  }

  console.warn(`[server] No available port found in range ${startPort}-${startPort + 99}`);
  return startPort;
}

// ============================================================================
// 浏览器打开
// ============================================================================

function openBrowser(port: number, urlPath: string = '/'): void {
  const platform = process.platform;
  const url = `http://localhost:${port}${urlPath}`;

  try {
    if (platform === 'win32') {
      exec(`start "" "${url}"`);
    } else if (platform === 'darwin') {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
    console.log(`[server] Browser opened: ${url}`);
  } catch (err) {
    console.log(`[server] Open ${url} in your browser`);
  }
}

// ============================================================================
// 优雅退出
// ============================================================================

function gracefulShutdown(): void {
  console.log('[server] Shutting down...');
  terminateWorker();
  closeDatabase();
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// 全局异常处理 — 写入日志文件 + stderr
process.on('uncaughtException', (err) => {
  startupLog(`UNCAUGHT EXCEPTION: ${err.message}\n${err.stack || ''}`);
  console.error('[server] UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack || ''}` : String(reason);
  startupLog(`UNHANDLED REJECTION: ${msg}`);
  console.error('[server] UNHANDLED REJECTION:', reason);
});

// 启动
startup().catch((err) => {
  startupLog(`FATAL: startup() rejected - ${err?.message || String(err)}\n${err?.stack || ''}`);
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});

export default app;
