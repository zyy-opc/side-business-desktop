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
import { ensureDataDirs, getAssetPath, getDataPath } from './config/paths.js';
import { runMigrations, backupBeforeMigration } from './services/migrationService.js';
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
import analyticsRoutes from './analytics/router.js';

const app = express();
const DEFAULT_PORT = 3000;

// ============================================================================
// 启动流程
// ============================================================================

async function startup(): Promise<void> {
  console.log('[server] side-business-desktop v1.0.0 starting...');

  // 1. 确保用户数据目录存在
  ensureDataDirs();
  console.log('[server] Data directories ready');

  // 2. 初始化数据库
  const db = await initDatabase();
  console.log('[server] Database initialized');

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
    backupBeforeMigration(0);
  }

  // 执行迁移
  const migration = await runMigrations();
  console.log(`[server] Migration: ${migration.message}`);

  if (!migration.success) {
    console.error('[server] Migration failed!');
    process.exit(1);
  }

  // 4. 注册 node-cron 定时任务 (每日 02:00 ETL)
  try {
    const cron = await import('node-cron');
    cron.default.schedule('0 2 * * *', async () => {
      console.log('[cron] Daily ETL starting...');
      try {
        const { executeDailyETL } = await import('./analytics/service.js');
        await executeDailyETL();
        console.log('[cron] Daily ETL completed');
      } catch (err) {
        console.error('[cron] Daily ETL failed:', err);
      }
    });
    console.log('[server] Cron job registered (daily 02:00 ETL)');
  } catch (err) {
    console.warn('[server] node-cron not available, skipping scheduled ETL');
  }

  // 5. 配置 Express
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // 静态文件服务 — 前端 build 产物
  const clientDist = getAssetPath('client-dist');
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

  // API routes
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
  app.use('/api/v1/analytics', analyticsRoutes);

  // 6. 端口检测与启动
  const port = await findAvailablePort(DEFAULT_PORT);
  app.listen(port, () => {
    console.log(`[server] Running on http://localhost:${port}`);
    console.log('[server] 12 modules loaded: platforms, customers, slots, slot-types, orders, progress-logs, progress-orders, deliveries, payments, refund-reasons, calendar, analytics');

    // 7. 打开浏览器
    openBrowser(port);

    // 8. 后台预热 OCR Worker (不阻塞启动)
    warmupWorker();
  });
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

function openBrowser(port: number): void {
  const platform = process.platform;
  const url = `http://localhost:${port}`;

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

// 全局异常处理
process.on('uncaughtException', (err) => {
  console.error('[server] UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] UNHANDLED REJECTION:', reason);
});

// 启动
startup().catch((err) => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});

export default app;
