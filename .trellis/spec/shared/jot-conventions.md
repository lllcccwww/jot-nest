# Jot 项目约定

> 本项目（桌面便签画布）在通用 Electron 规范之上额外沉淀的经验。改动相关模块前先读这里。

## 架构边界

| 区域 | 职责 | 禁止 |
| --- | --- | --- |
| `src/main/` | 窗口与托盘、全局热键、SQLite 数据仓、图片落盘、COS 备份、自动更新 | 不写业务 UI、不读 DOM |
| `src/preload/` | `contextBridge` 白名单，仅暴露 `window.jot` 与 `window.jotInternal.resize` | 不暴露 `ipcRenderer` 原始对象 |
| `src/renderer/` | 画布交互、卡片渲染、捕捉浮窗 | 不直接用 `node:fs`/`path`，全部经 IPC |
| `src/shared/` | 数据模型、IPC 通道常量、`JotApi` 契约 | 不引入运行时依赖 |

新增 IPC 的顺序固定：`shared/types.ts` 加类型 → `shared/ipc.ts` 加通道 → `main/ipc.ts` 注册 → `shared/api.ts` 声明 → `preload/index.ts` 实现 → 渲染进程调用。少一步都会在打包后静默失败（dev 下不一定报错）。

## 持久化

- 用 Electron 内置 `node:sqlite`（`DatabaseSync`），**不要引入 better-sqlite3 / sharp 等原生模块**：本机与 CI 都不需要 `electron-rebuild`，打包零风险。Electron ≥ 35 的 Node 已内置 FTS5。
- `jot.db` 位于 `app.getPath('userData')`；测试用 `JOT_USER_DATA` 环境变量切换数据目录（`main/index.ts` 顶部已支持）。
- 软删除（`deleted_at`）+ `rev` / `updated_at` 字段保留，为将来多端同步留墓碑。
- 快照一致性统一走 `VACUUM INTO`，不要直接复制正在使用的 db 文件（WAL 下会拿到半写状态）。

## 检索

中文检索走主进程内存索引（`BoardStore.search`）：`includes` + 标签/时间/收藏过滤，再按命中位置与更新时间排序。**不要为了"标准做法"改用 FTS5**——`unicode61` 会把连续汉字视为单一 token，`trigram` 又要求 ≥3 字符，两字词（如「会议」）会查不到。

## 画布交互

- 世界坐标 → 屏幕：`screen = (world - camera) * zoom`；相机只由 `App` 持有，渲染层只上报意图。
- 指针拖拽统一用 `pointerdown` + window 级 `pointermove/pointerup/pointercancel`，并在 `pointerdown` 里 `preventDefault()`：
  - 不 `preventDefault` 时，按在可选中文本上会被 Chromium 解释成文本选择/原生拖拽，`pointerup` 丢失，拖拽增量会一路累积到下一次点击（表现为卡片瞬移到远处）。
  - 同时要在 `pointermove` 里检查 `event.buttons === 0`，视为拖拽已结束并立即落库，作为失去 pointerup 的兜底。
- 高频拖拽只改本地视觉偏移（内联 transform），`pointerup` 时才提交 IPC；不要每帧写库。
- 分组只持久化 `title/color/collapsed`，矩形由成员卡片的实测高度实时计算（`heightsRef` + ResizeObserver），因此"拖动分组"落地为"平移所有成员"。
- 卡片三档宽度（240/320/480），不做任意拉伸：保持视觉节奏与排版可控。

## 视觉规范

- 全部颜色、圆角、动效时长走 `styles.css` 顶部的 CSS 变量；新增颜色必须先加语义变量，再由 `[data-theme='dark']` 覆盖。
- 主题切换写在 `<html data-theme>`，`system` 模式监听 `prefers-color-scheme`。
- 无边框窗口：标题栏 `-webkit-app-region: drag`，可交互子元素必须显式 `no-drag`；关闭按钮 = 收进托盘（`main/windows.ts` 拦截 `close`）。
- 快捷键只作加速器：每个快捷键功能都必须有可见入口（搜索框常驻顶栏，不藏在 `Ctrl+K` 后面）。
- 动效 120–200ms，`cubic-bezier(0.2, 0, 0, 1)`；禁止弹跳。

## 图标与打包资源

- 图标是设计稿资产，不是代码产物：**不要写生成/重绘图标的脚本**。曾有的 `tools/make-icon.mjs` 会重算出旧蓝色图标并覆盖资源，已删除；换图标只替换下面三份文件，保持原比例与透明底，不做拉伸或重编码。
- 三份文件的职责固定：`resources/app-icon.png` 是唯一运行时图标源（透明底大图）；`build/icon.ico` 供 `electron-builder.yml` 的 `win.icon`（exe、安装包、快捷方式都取这里，需含 16/32/48/256 等尺寸帧）；`build/icon.png` 供非 Windows 目标。
- 运行时只经 `src/main/app-icon.ts` 取图：`appIconPath()` 依次尝试 `out/main/../../resources`（开发）、`process.resourcesPath`（打包后由 `extraResources` 放置）、`app.getAppPath()/resources`；新建 `BrowserWindow` 必须传 `icon: appIconPath()`，托盘用 `appIconImage(16)`。不要在各处再写路径探测。
- 单独为托盘准备小图没有收益：Electron 对 ICO 只取单帧，直接从大图 `resize` 与 ICO 内的 16px 帧视觉一致。
- 验证：`npm run pack:dir` 后确认 `release/win-unpacked/resources/app-icon.png` 存在，且 `release/win-unpacked/Jot.exe` 内含 ICO 各尺寸帧（逐帧字节比对即可）。

## 备份与密钥

- COS 只当哑存储：`db/` 放滚动快照（保留 10 份），`images/` 放按 sha256 命名的原图，`backup_objects` 表记录已上传对象避免重传。
- SecretId/SecretKey 一律经 `safeStorage.encryptString` 后存盘，渲染进程只能读到 `hasCredential: boolean`。
- 备份失败只影响状态显示，不得阻塞任何本地读写路径。
- 自动更新的安装包文件名**不能带空格**（`nsis.artifactName: Jot-Setup-${version}.exe`）：`electron-updater` 用 `latest.yml` 里的 `path` 拼 URL，空格会导致下载 404。
- 更新源对象用对象级 `ACL: public-read` 上传即可，不需要把整个桶改成公共读；备份前缀保持私有。

## 验证

`npm run verify` 会真实启动 Electron（独立数据目录）走一遍：建卡 → 拖拽落库 → 搜索/淡出 → 全览 → 多选成组 → 分组拖动 → 折叠 → 就地编辑 → 浮窗提交 → 图片卡片与预览 → 快捷键探测 → 设置面板 → 深色主题 → 重启持久化，并把截图写到 `.tmp/shots/`。改动画布、卡片、IPC 后建议跑一次。
