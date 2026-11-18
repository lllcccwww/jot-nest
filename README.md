# Jot

桌面便签画布：随手复制来的文本和图片，两秒记下、落在无限画布上，靠位置、颜色、标签找回。数据以本地 SQLite 为真相源，腾讯云 COS 做异地备份，构建产物自带自动更新。

## 快速开始

```bash
npm install          # 首次安装（Electron 二进制走 npmmirror 更快：
                     # ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install）
npm run dev          # 开发模式
npm run typecheck    # 主进程 + 渲染进程类型检查
npm run verify       # 端到端验证（真实启动应用，走核心链路并截图到 .tmp/shots）
npm run dist         # 打包 NSIS 安装包 + 便携版（输出到 release/）
```

## 使用

| 操作 | 方式 |
| --- | --- |
| 随手记 | 全局热键 `Ctrl+Alt+N`（设置页可改，带冲突检测）唤出浮窗，粘贴后 `Ctrl+Enter` 保存 |
| 新建卡片 | 顶栏「新建」，或双击画布空白处 |
| 移动/多选 | 拖卡片；空白处拖框选；`Shift` 点选追加 |
| 平移/缩放 | 滚轮平移，`Ctrl+滚轮` 缩放，`空格`+拖动或中键拖动平移 |
| 找回 | 顶栏搜索框（常驻），命中高亮、其余淡出，回车飞过去；「全览」缩放到全部卡片 |
| 分组 | 多选后点底部「成组」，拖动组标题整体移动，右键可重命名/折叠/解散 |
| 卡片样式 | 选中后底部色板换底色；右键改宽度（窄/标准/宽） |
| 图片 | 浮窗粘贴截图即预览；画布上点图片看原图 |
| 托盘 | 关闭窗口收进托盘，单击托盘图标恢复，右键菜单可捕捉/备份/退出 |

数据目录：`%APPDATA%\jot-nest\`（`jot.db` + `images/` + `thumbs/`）。

## 备份（可选）

设置页填写 COS 存储桶、地域、路径前缀与 SecretId/SecretKey：

- 密钥经 `safeStorage`（Windows DPAPI）加密后写入 `settings.json`
- 内容变更 30 秒后防抖上传；启动 60 秒后自动备份一次
- 上传内容：`<prefix>/db/jot-<时间戳>.sqlite`（滚动保留 10 份）+ `<prefix>/images/<sha256>`（按内容哈希，只传一次）
- 断网或凭据失效只影响备份，本地功能不受影响；「查看云端快照」可挑一份恢复

自动更新需要 COS 上一个**公开读**的前缀放 `latest.yml` 与安装包，并把该地址填到设置页「更新源」。未签名安装包首次运行会触发 SmartScreen 提示。

## 当前部署（已配置好）

| 项 | 值 |
| --- | --- |
| 存储桶 | `jot-nest-1310000435`（ap-guangzhou） |
| 备份前缀 | `jot/`（`db/` 滚动保留 10 份快照，`images/` 按 sha256 存原图） |
| 更新源 | `https://jot-nest-1310000435.cos.ap-guangzhou.myqcloud.com/updates/` |
| 密钥存放 | `%APPDATA%\jot-nest\settings.json`，`safeStorage`（DPAPI）加密，**不进仓库** |

`updates/` 下的 `latest.yml`、`Jot-Setup-<version>.exe`、`.blockmap` 以对象级 `public-read` 上传，`latest.yml` 与安装包已匿名验证可读（支持 Range）。发新版时重新构建并覆盖这三个对象即可。

辅助脚本：

- `npm run verify` —— 画布与 IPC 全链路（Playwright，独立数据目录）
- `node tools/verify-cos.mjs` —— 真实桶备份链路验证（用 `jot-verify/` 前缀，结束后自动清理）
- `node tools/verify-restore.mjs` —— 灾难恢复演练（备份 → 清空本地 → 恢复 → 重启验证）
- `node tools/setup-cos.mjs` —— 上传更新源并把配置写进本机应用

三个脚本都需要凭据环境变量：`JOT_COS_SECRET_ID` / `JOT_COS_SECRET_KEY` / `JOT_COS_BUCKET`（在 WSL 里调用 Windows node 时，环境变量需通过 `WSLENV` 透传）。

## 技术要点

- Electron 45（Node 24） + React 19 + Vite 7 + TypeScript，`electron-vite` 编排
- **零原生模块**：持久化用 Electron 内置 `node:sqlite`（含 FTS5），图片降采样/缩略图在渲染进程用 canvas 完成，无 `better-sqlite3`/`sharp` 重编译问题
- 中文检索用主进程内存索引（`includes` + 标签/时间过滤），避开 FTS5 对连续汉字分词的坑
- 画布是 DOM + CSS transform，交互细节见 `.trellis/spec/shared/jot-conventions.md`

## 目录

```
src/main/      主进程：窗口、托盘、全局热键、SQLite 数据仓、COS 备份、自动更新
src/preload/   contextBridge 白名单（window.jot）
src/renderer/  主窗口画布 + 捕捉浮窗（两套入口页面）
src/shared/    跨进程类型与 IPC 契约
tools/         图标生成、端到端验证脚本
```
