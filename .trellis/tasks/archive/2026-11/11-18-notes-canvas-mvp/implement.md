# 实现计划 — Jot

## 阶段 1：工程骨架（可启动）

- [x] 依赖与构建配置：`package.json`、`electron.vite.config.ts`、`tsconfig*.json`、`electron-builder.yml`
- [x] `src/shared/types.ts`：数据模型与 IPC 契约类型
- [x] 主进程最小启动：单实例、主窗口（frameless）、`node:sqlite` 建表
- [x] preload 白名单

验证：`npm run dev` 打开一个空的无边框窗口，数据库文件在 `%APPDATA%\jot-nest\jot.db` 生成。

## 阶段 2：数据与捕捉链路

- [x] `store/notes.ts`：CRUD + 内存索引搜索 + 相机持久化
- [x] `store/images.ts`：写原图/缩略图，`jot://` 协议
- [x] `store/settings.ts`：`settings.json` + `safeStorage` 加密 COS 密钥
- [x] 全局热键注册 + `shortcut:probe` 冲突检测
- [x] 捕捉浮窗：粘贴预览、提交、落位计算、"已保存 · 定位"
- [x] 托盘菜单与关闭收托盘

验证：热键唤出浮窗 → 存文字/图片 → 主窗口出现卡片；重启后仍在。

## 阶段 3：画布

- [x] 相机（平移/缩放/飞行/全览）+ 相机持久化
- [x] 卡片渲染（三档宽度、自动高度、12 行折叠、Markdown 轻渲染）
- [x] 拖动、多选（框选/shift）、吸附参考线与视觉反馈、层级
- [x] 就地编辑、卡片上色、标签编辑、收藏
- [x] 分组容器（创建/命名/整体移动/折叠）
- [x] 顶栏：搜索框、筛选 chip、缩放控件、全览、飞回最近
- [x] 搜索高亮/淡出效果
- [x] 图片浮层预览

验证：PRD 验收标准 2–6 全通过。

## 阶段 4：备份、设置、打包

- [x] COS 备份器（VACUUM INTO 快照 + 图片幂等上传 + 状态机 + 防抖调度）
- [x] 设置页：COS 配置、热键录制、主题、开机自启、更新开关、立即备份/恢复
- [x] `electron-updater` 接入（generic provider 指向 COS `updates/`）
- [x] `electron-builder` NSIS + portable 配置、图标、单实例
- [x] 全量自检：`npm run typecheck`、`npm run build`、`npm run dist`

验证：PRD 验收标准 7–8。

**实际验证状态**

- 验收 8（打包）：已产出 `release/Jot Setup 0.1.0.exe`（117MB）与 `Jot-0.1.0-portable.exe`（107MB），`win-unpacked` 可启动。
- 验收 7（COS 备份）：**已用真实桶跑通**（`tools/verify-cos.mjs`）——配置加密保存、立即备份成功、快照上传、图片按 sha256 上传、快照下载后可打开且含全部 4 张卡片、二次备份图片零重传、测试对象清理干净。真实应用目录已写入配置并完成了首次备份。
- 灾难恢复演练：**已跑通**（`tools/verify-restore.mjs`）——备份 → 删光本地库 → `backup.restore()` → 应用重启 → 库回到 2 张卡片且内容正确。附带修了一个真缺陷：原实现恢复后立即 `app.exit(0)`，IPC 回包未送达，界面会误报失败；改为延迟 600ms 再重启。
- 自动更新：`updates/latest.yml`、`Jot-Setup-0.1.0.exe`、`.blockmap` 已以对象级 `public-read` 上传，匿名 GET 与 Range 请求均通过；更新源已写进应用设置。**版本升级跳转尚未实测**（需要先装旧版再发新版）。
- 自动化验证：`npm run verify` 覆盖其余 13 项（建卡/拖拽落库/搜索淡出/全览/多选成组/分组拖动/折叠/就地编辑/浮窗提交/图片卡片与灯箱/快捷键探测/设置面板/重启持久化），连跑 3 次全绿。

## 人工验收（开发者确认）

以下 4 项自动化测不到，已由开发者在本机安装 `Jot-Setup-0.1.0.exe` 后实际操作确认通过：

1. `Ctrl+Alt+N` 能唤出捕捉浮窗。
2. 截图粘贴进浮窗能看到缩略图，保存后卡片落在当前视野中央。
3. 点关闭后窗口进托盘、托盘图标点击能恢复窗口。
4. 空白处拖拽可框选多张卡片；拖动卡片时出现蓝色对齐参考线。

至此 PRD 验收标准 1–8 全部通过，任务可归档。

## 质量门

- `npm run typecheck`（node + web 两侧）：通过
- `npm run build`：通过
- `npm run verify`：15 项检查全绿（含 2 项快捷键探测）
- 无原生依赖：不依赖需要 `electron-rebuild` 的包（SQLite 用 Electron 内置 `node:sqlite`）

## 回滚点

- 阶段 1 结束：骨架可启动，后续所有改动都在其上增量。
- 备份模块与画布解耦，出问题可关掉备份不影响主流程。
