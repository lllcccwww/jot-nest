# Journal - linchengwei (Part 1)

> AI development session journal
> Started: 2026-11-18

---

## 2026-11-18 · 便签画布应用 Jot（MVP 从 0 到可安装）

**任务**：`.trellis/tasks/11-18-notes-canvas-mvp`

**做了什么**

- 一轮需求追问后定稿：单张无限自由画布、全局热键浮窗捕捉、鼠标优先、本地 SQLite 为真相源 + COS 只做备份、单机（不做冲突解决）、Windows 首发。
- 关键环境发现：Electron 45 内置 Node 24，`node:sqlite`（含 FTS5）开箱可用 → 全项目**零原生模块**，省掉 better-sqlite3 / sharp 的 rebuild 与打包风险；图片降采样改在渲染进程用 canvas 完成。
- 落地的模块：主进程（窗口/托盘/热键/COS 备份/自动更新）、SQLite 数据仓（软删除 + rev，为多端留位）、preload 白名单、无限画布（相机、框选、吸附、分组、就地编辑、搜索淡出定位）、捕捉浮窗、设置面板、亮暗双主题。
- 交付物：`npm run dev` 可开发，`npm run dist` 产出 NSIS 安装包（117MB）与便携版（107MB）。
- 新增 `tools/verify.mjs`：Playwright 驱动真实 Electron，走完 15 项核心链路并把截图写到 `.tmp/shots/`。连跑 3 次全绿。

**踩到的坑（已写入 spec）**
1. **拖拽跳位**：拖拽期间会混入另一只指针（真实鼠标）的 `pointermove`（buttons=0），旧逻辑当作同一次拖拽 → 卡片瞬移到真实鼠标位置。改为按 `pointerId` 过滤，并加"同一指针 buttons=0 即收尾"的兜底。
2. **卡片上不能用 setPointerCapture**：click 会重定向到捕获元素，图片点击（灯箱）失效。
3. **编辑态被卸载会丢草稿**：点击画布空白处直接 `setEditingId(null)` 不会触发 blur；改为依赖 blur + 卸载前用 ref 兜底落库。
4. **Electron 45 剪贴板 API 换代**：`clipboard.readImage()` 已不存在，改为 `clipboard.read()` → `ClipboardItem.getType('image/png')` 取 Blob。
5. **测试数据污染**：加 `JOT_USER_DATA` / `--user-data=` 支持独立数据目录，验证脚本每次从空白开始。
6. **恢复后立即 `app.exit(0)`**：IPC 回包未送达渲染进程，界面会误报「恢复失败」。改成先返回结果，600ms 后再 `relaunch + exit`。
7. **安装包文件名带空格**：`electron-updater` 用 `latest.yml` 里的 `path` 拼 URL，`Jot Setup 0.1.0.exe` 会 404；改为 `Jot-Setup-0.1.0.exe`。

**待验证（需要有凭据/网络才能测）**

- ~~COS 上传/恢复全链路~~ → 已用真实桶跑通（`tools/verify-cos.mjs`）。
- ~~更新源可访问性~~ → `updates/` 已用对象级 `public-read` 上传并通过匿名 GET / Range 验证。
- **版本升级跳转**尚未实测：需要先装 0.1.0，再把版本号提到 0.1.1 上传覆盖 `updates/` 后观察。
- 托盘单击/右键菜单与全局热键在打包版的真实行为（打包版已能启动，托盘图标资源已随包分发）。

**结果**

PRD 验收标准 1–8 全部通过：其中 5 条有自动化或真实桶证据，另 4 条（热键唤出浮窗、真实剪贴板图片粘贴、关闭进托盘与托盘恢复、框选与吸附参考线）由开发者在安装包上人工确认。任务已归档。

**仓库**

已 `git init` 并推送到 https://github.com/lllcccwww/jot-nest（公开）。推送前做了三件事：抹除桶名与本地路径、把提交邮箱从公司邮箱改为 GitHub noreply 并重写历史作者、全量凭据扫描。

**仍未做**

- COS SecretKey 曾在对话中明文出现，建议轮换为“仅授权该桶”的子账号密钥（待开发者处理）。
- 自动更新已按需求关闭（`updateFeedUrl` 置空），`updates/` 下仍有一个 116MB 的公开安装包，是否删除待定。

**下一步**

- 用真实使用一周后再决定：多端同步、导出功能、待办/代码块卡片。
