# Tessdata 目录 — OCR 语言包

预打包中文简体语言包 chi_sim.traineddata (~12MB)。

## 下载方式

1. 自动: Tesseract.js 首次加载时自动从 CDN 下载到 `%APPDATA%\side-business-system\tesseract-cache\`
2. 手动: 从 https://github.com/tesseract-ocr/tessdata/raw/main/chi_sim.traineddata 下载后放入此目录

## 其他语言包（可选，按需下载）

- eng.traineddata — 英文
- jpn.traineddata — 日文
- kor.traineddata — 韩文

放置到本目录后，Tesseract.js 启动时自动使用，不会尝试远程下载。
