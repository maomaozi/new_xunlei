# 迅雷下载（Xunlei Downloader）

基于对 `xunlei-pan-cli 3.23.3` 的逆向分析开发的前后端分离 Web 应用。内置官方迅雷下载引擎（任务调度器 + xldownloadlib 内核），在普通 Linux 主机上原生运行，不依赖 NAS 或 Docker 版迅雷：FastAPI RESTful 后端 + React 单页应用，拟态（Neumorphism）+ 磨砂玻璃视觉风格，桌面侧边栏 / 移动端原生风格底部标签栏（操作面板、长按多选、底部弹窗），可作为 PWA 安装到桌面或手机主屏。

> 站点本身**没有独立登录**，只集成迅雷账号登录。任何能访问本站的人都能操作已登录的迅雷账号，请只在可信局域网中使用。

## 功能

| 模块 | 能力 |
|---|---|
| 账号 | 引擎统一扫码登录、会话自动续期、会员与空间概览 |
| 云盘 | 目录浏览（虚拟滚动 + 无限加载）、列表/网格视图、排序、筛选、分类（视频/图片/音频/文档/压缩包/收藏）、新建文件夹、重命名、移动、复制、收藏、移入回收站/彻底删除、详情（GCID、直链、分辨率…）、在线播放、外部播放器、复制直链、浏览器下载 |
| 上传 | 浏览器上传文件/文件夹（保留目录结构）、上传服务器本机文件或目录；GCID 秒传优先，未命中走阿里云 OSS STS 直传（大文件 Multipart 分片并发） |
| 内置 HTTP 下载器 | （可选）云盘文件/文件夹从 VIP CDN 多线程分段下载，断点续传、全局限速、同名冲突策略、CDN 节点故障自动换链 |
| 云添加 | 磁力、HTTP(S)、FTP、ed2k 批量提交，`.torrent` 本地解析预览后提交，单个磁力/种子可勾选要下载的子文件，选择保存位置，进度自动刷新，删除任务（可同时删文件） |
| 下载（迅雷引擎） | 磁力、HTTP(S)、FTP、ed2k、thunder 链接与 .torrent 直接下载到本机（P2SP / BT / 会员加速），可勾选子文件、选择保存目录；暂停 / 继续 / 重试 / 删除（可同时删文件）、加速通道显示、超级加速试用；云盘文件与文件夹经引擎取回本机 |
| 下载引擎 | 自动拉起并守护内置 `xunlei-pan-cli` 引擎（启动注入 `DriveLogLevel=debug` 根治 403、设置热更新、异常重启自愈），纯本地内存毫秒级进度/速度直读（零云端延迟）、Go PProf 运行时性能剖析与 Goroutine 诊断、会员超级加速试用一键重置、统一扫码登录、磁盘占用、冲突进程检测与日志管理 |
| 分享 | 创建（有效期、提取码、转存次数）、列表（浏览/转存统计）、复制、取消分享 |
| 回收站 / 动态 | 恢复、彻底删除、清空；云盘动态时间线 |
| 设置 | 账号、网络（域名直连 IP、超时、重试、代理、UA…）、云盘、下载、上传、云添加、分享、播放、外观（主题/强调色/密度/动画）、系统（本机可访问目录）——全部可在网页上修改并立即生效 |

## 目录

```text
backend/    FastAPI + Pydantic v2 + httpx + SQLite（uv 管理，.venv 隔离）
frontend/   React + TypeScript + Vite + Ant Design + Tailwind CSS v4 + TanStack Query（Bun）
docs/       架构说明
engine/     内置迅雷下载引擎二进制（xunlei-pan-cli，linux/arm64）
start.sh    一键启动（开发 / --prod）
```

## 启动

```bash
./start.sh          # 开发：前端 http://127.0.0.1:5176 ，API http://127.0.0.1:8011/docs
./start.sh --prod   # 构建前端并由 API 进程统一提供服务：http://127.0.0.1:8011
```

也可以分别启动：

```bash
cd backend && uv sync --locked && uv run uvicorn app.main:app --host 0.0.0.0 --port 8011
cd frontend && bun install --frozen-lockfile && bun --bun run dev
```

## 下载引擎

后端启动时自动拉起 `engine/xunlei-pan-cli.*`（数据目录 `backend/data/engine`），并在「下载引擎」页显示状态。云盘与下载统一使用引擎账号，在「设置 → 账号」或「下载引擎」扫码一次即可。引擎独占 Refresh Token 并自行续期，后端只读取活动 Access Token，不另行登录或刷新。

账号页可同步状态、退出和切换账号。退出会同时影响云盘与下载；引擎停止或会话过期时，后端停止使用旧 Token。独立扫码、密码登录、凭据导入和手动修改设备 ID 已移除；旧后端独立 Token 在升级后的首次启动时清除，引擎已有登录与下载数据保留。

注意同一设备 ID 只能有一个引擎实例在线，请停止其他 NAS / Docker 版迅雷。

The platform selector under Settings → 下载引擎 → 进程与运行环境（高级） supports
QNAP (default), Synology, Docker and Linux. Saving a platform change restarts the engine.
Platform access depends on the account; the Linux verification used a temporary protection
period rather than confirmed permanent authorization. See [docs/architecture.md](docs/architecture.md)
for the verified scope and Linux VFS behavior.

## 数据

所有运行时数据位于 `backend/data/`（已加入 `.gitignore`）：`xunlei_web.sqlite3`（设置、凭据、传输任务）与 `uploads/`（浏览器上传暂存）。

## 检查

```bash
cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
cd frontend && bun --bun run lint && bun --bun run test && bun --bun run build
```

更多细节见 [docs/architecture.md](docs/architecture.md)。
