# 接稿业务管理系统（桌面版）

基于 SQLite + pkg + NSIS，单文件 EXE 发布。

## 环境

- Node.js 18+，TypeScript 5.x
- 数据库: SQLite (sql.js)，单文件 `%APPDATA%/side-business-system/data/main.db`
- 端口: 3000 (自动递增检测)
- 所有运行时数据在 %APPDATA%/side-business-system/，不写 C 盘

## 项目结构

```
server/              -- 后端源码
  src/
    config/          -- 数据库、路径配置
    routes/          -- Express 路由
    services/        -- 业务逻辑
    engine/          -- 状态机引擎
    analytics/       -- 数据分析模块
    types/           -- 类型定义
    utils/           -- 工具函数
  migrations/        -- SQLite DDL 迁移脚本
tessdata/            -- OCR 语言包 (Stage 2)
fonts/               -- 字体文件
build/               -- 构建产物
```

## 启动

```bash
cd server && npm install && npm run dev    # 开发
cd server && npm run build && npm start    # 生产
```

## 金额规范

- 数据库存储: INTEGER(分)
- 前端/API: 元 (float)
- 转换: `centsToYuan()` / `yuanToCents()` 在 types/index.ts

## 与 side-business-system 的关系

- 独立项目，不依赖 side-business-system
- API 接口保持兼容
- 数据库从 MySQL 迁移到 SQLite
