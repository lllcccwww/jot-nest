# 技术设计 — Jot

## 技术栈与约束

- Electron 45（Node 24.22 / Chromium 156）+ React 19 + Vite 7 + TypeScript（electron-vite 4 编排）。
- **零原生模块**：持久化用 Electron 内置 `node:sqlite`（`DatabaseSync`，已实测可用）；图片降采样与缩略图在渲染进程用 canvas 完成，不引入 sharp；COS 用纯 JS 的 `cos-nodejs-sdk-v5`。
- 构建产物：`out/main`、`out/preload`、`out/renderer`。

## 进程与窗口

| 窗口 | 说明 |
|---|---|
| main | 主窗口，`frame: false`，`minWidth: 900 / minHeight: 600`，关闭时 `preventDefault` + `hide()` 收进托盘 |
| capture | 捕捉浮窗，`frame: false`、`alwaysOnTop`、`skipTaskbar`、`resizable: false`、`transparent: false`、失焦 `hide()`，位置按光标所在显示器的水平居中 / 垂直 32% |

- 单实例：`app.requestSingleInstanceLock()`，第二实例触发已有窗口 `show()`。
- 托盘：单击恢复主窗口；右键菜单：捕捉、打开主窗口、备份状态、立即备份、退出。
- 开机自启：`app.setLoginItemSettings`，设置项 `autoLaunch`。

## 数据层

`app.getPath('userData')` 下：`jot.db`、`images/<sha256>.<ext>`、`thumbs/<sha256>.webp`。

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL,          -- 'text' | 'image'
  text TEXT NOT NULL DEFAULT '', image_id TEXT,     -- sha256
  image_w INTEGER, image_h INTEGER,
  color TEXT, tags TEXT NOT NULL DEFAULT '[]',      -- JSON array
  pinned INTEGER NOT NULL DEFAULT 0,
  x REAL NOT NULL, y REAL NOT NULL, w INTEGER NOT NULL DEFAULT 320, z REAL NOT NULL DEFAULT 0,
  group_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  deleted_at INTEGER, rev INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE groups (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', color TEXT,
  x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0, z REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

- `w` 为三档预设（240/320/480），高度由渲染进程测量后回写 `meta`? 否——高度不入库，渲染时按内容自适应；分组容器的高度随成员包围盒计算并持久化。
- 软删除（`deleted_at`）保留，便于未来多端同步墓碑；查询一律过滤。
- 相机（`{x, y, zoom}`）存 `meta.camera`，拖动/缩放后 400ms 防抖写库。

### 搜索

中文子串检索不用 FTS5（`unicode61` 分词器会把整段连续汉字当成单一 token，`trigram` 又要求 ≥3 字符），改为**主进程内存索引**：启动时把 `id / text / tags / pinned / created_at` 读入 Map，搜索走 `toLowerCase().includes()` + 标签/时间/收藏过滤，再按相关性（命中位置、更新时间）排序。个人数据量级（≤ 万条）下毫秒级返回，且对中文、混排、标点行为直观。

## IPC 契约

`contextIsolation: true`、`nodeIntegration: false`，preload 通过 `contextBridge` 暴露 `window.jot`：

```
notes:list            → { notes, groups, camera }
notes:create(payload) → Note
notes:update(patch)   → Note            // 位置/文字/标签/颜色/宽度/分组/收藏
notes:delete(ids)     → void
notes:search(query)   → Note[]
groups:create/update/delete
images:save({dataUrl, thumbDataUrl}) → { id, w, h }   // 主进程落盘
settings:get / settings:set          // COS 密钥只回传"是否已配置"
shortcut:probe(accel) → { ok, conflictWith? }  // 先 unregister 再试注册
shortcut:set(accel)   → 同上
backup:now / backup:status           // 状态通过事件推送
win:minimize / win:maximize / win:close
capture:submit(payload) / capture:close / capture:locate(noteId)
```

事件（main → renderer）：`notes:changed`、`backup:status`、`capture:open-with-data`、`locate:note`、`win:state`。

图片读取走自定义协议 `jot://img/<sha256>`（`protocol.handle`），避免 `file://` 与 CSP 冲突，同时天然可缓存。

## 画布实现

- DOM + CSS transform：世界层 `transform: translate3d(camX, camY, 0) scale(z)`，卡片绝对定位 `left/top`。
- 相机：滚轮 = 平移，`Ctrl/⌘ + 滚轮` = 以光标为锚点缩放（0.25–2.0）；中键/空格拖动平移；空白左键拖拽 = 框选。
- 拖动卡片：`pointerdown` → `setPointerCapture`，屏幕像素增量除以 `zoom` 后写入世界坐标；吸附阈值 6px，候选为其他卡片/组的 左/中/右、上/中/下 共 6 条参考线，命中即吸附并绘制参考线。
- 分组：组成员记录 `group_id`；拖动组标题条时递归移动成员；组成员包围盒决定容器矩形；折叠时成员 `display: none` 且容器高度归零。
- 折叠/编辑/拖动期间只用局部 state，结束后再落库，避免高频 IPC。
- 卡片文本：受控 `textarea`（编辑态）/ 只读 Markdown 轻渲染（展示态，支持标题、列表、行内代码、代码块、链接、粗体），行数超 12 行折叠。
- 图片：`jot://img/<sha>` 缩略图铺满卡片，点击打开浮层看原图（`jot://img/<sha>?full=1`）。

## 备份（COS）

- `cos-nodejs-sdk-v5`，`putObject` 上传：`<prefix>/db/jot-<ts>.sqlite`（滚动保留最近 10 份）+ `<prefix>/images/<sha256>`（幂等，已存在则跳过）。
- 触发：内容变更后 30s 防抖；应用启动 60s 后一次；设置页"立即备份"手动触发。
- 状态机：`idle → syncing → ok | error(message)`，通过 `backup:status` 事件推给顶栏状态点与托盘菜单。
- 快照一致性：先用 `db.exec('VACUUM INTO ?')` 生成一致性副本再上传，避免读到半写状态。
- 恢复：设置页"从云端恢复"列出最近快照，下载后替换本地库并重启应用（MVP 提供命令行级能力，UI 只做选择 + 确认）。

## 自动更新

`electron-updater` + `generic` provider，`url` 指向 COS 上公开读的 `updates/` 前缀。设置页可切换自动/手动检查。无代码签名，首次安装触发 SmartScreen 警告，属预期。

## 安全边界

- 渲染进程无 Node 权限，全部能力经 preload 白名单。
- COS `SecretKey` 用 `safeStorage.encryptString` 加密后存 `settings.json`，读取只回传 `configured: true`。
- 生产构建禁用 `devTools`、开启 `webSecurity`，外部链接一律 `shell.openExternal` 且限制 http/https。

## 风险

| 风险 | 应对 |
|---|---|
| 卡片量大后 DOM 数量高 | 先不做虚拟化，用 `content-visibility: auto` 缓解；超过 1000 条再评估 |
| 中文搜索需求变化（拼音、模糊） | 搜索接口独立成 `search()`，可替换实现 |
| COS 上传大图慢 | 图片写入与上传都在主进程异步，失败不阻塞输入 |
