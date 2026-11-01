# AGENTS.md

## 项目

OpenChamber guest 扩展，含右侧栏面板和本地服务。宿主不编译 TypeScript；安装时只读取已构建的 JS。

入口链：`src/panel/main.ts` → `panel/main.js`；`src/service/main.ts` → `service/main.js`；`src/shared/health.ts` 是面板与服务共用的 `/health` 契约。

## 命令

- `bun run typecheck`：`tsc --noEmit`。
- `bun test`：全部测试。单文件：`bun test tests/service.test.ts`。
- `bun run build`：生成 `panel/main.js` 和 `service/main.js`。
- `bun run check`：typecheck → test → build。提交前运行。
- CI 另跑 `git diff --exit-code -- panel/main.js service/main.js`。

## 构建

- `panel/main.js` 必须是 classic IIFE。沙箱 iframe 不能加载 ESM。
- `service/main.js` 用 `--node` 构建，保留 ESM 和 Node 内置模块。
- 两个产物都要提交。安装检查磁盘文件；缺任一个报 `missing-build`。
- `src/panel/main.ts` 导入 `package.json`。改动版本或面板名称后必须重建，否则面板显示的版本落后于安装清单。
- `panel/locales/*.json` 由 `src/panel/main.ts` 静态导入并内联进 `panel/main.js`（面板禁止 `fetch`）。改词条、加语言或改 `index.json` 后必须重建面板产物。
- 清单测试要求 `panel/main.js` 已存在。新克隆后先跑 `bun run build`。
- 构建命令不创建输出目录。新增 `service/`、`background/` 等输出目录时，先提交目录中的产物，或先手动建目录。

## 清单

- 扩展清单写在 `package.json` 的 `openchamber` 字段。没有单独的清单文件。
- `panel.id`、`panel.entry`、`service.entry` 由宿主解析。改路径时同步改文件和测试。
- `engines.openchamber` 当前为 `>=2.5.0`；`@openchamber/sdk` 固定 `2.5.1`。升级 SDK 时同时改这两处。
- `parseManifest` 从 `@openchamber/sdk/schemas` 导入。主入口不导出它。
- `<script src>` 指向的文件必须在包内。安装检查只验证本地文件，不验证远程地址。

## 运行时契约

- 面板只能调用 `host.*`。不能 `fetch` 网关，也不能直接访问本地服务。
- 服务从 `OPENCHAMBER_SERVICE_PORT` 与 `OPENCHAMBER_SERVICE_TOKEN` 取值。缺一个就退出。
- 服务只绑 `127.0.0.1`。每个请求校验 Bearer。不得记录 token。
- 密钥只能进入服务进程。不得写入面板、bundle、日志或提交。

## UI

- 每次 `onReady` 调用 `applyHostReady`。控件只挂载一次；重复快照只更新值。
- 颜色用宿主变量 `--oc-*`，不要写死浅色或深色值。
- 不得硬编码用户可见文案。词条在 `panel/locales/*.json`；新增键必须同时更新 `en.json` 与 `zh-CN.json`，复数键按 CLDR 类别配齐。新增语言还要在 `src/panel/main.ts` 增加 import 与 `MESSAGES` 映射（构建期内联）。规则见 `docs/translations.md`。
- 额度卡标记在 `src/panel/main.ts`：`.quo-card` 是容器（`container-type: inline-size`），每个 pool 一个 `.q-pool` 两列网格，窄于 260px 自动单列。展开状态按卡片顺序键记在内存里的 `Set` 中，不写任何存储。拖拽用 window 上的 pointer 监听，不用 `setPointerCapture`：重排会把持有捕获的卡片从 DOM 里移出，Chromium 会当场丢掉捕获。

## 状态

用量面板已实现并交付；额度卡按 magpie 自己的额度页改版（厂商标识、池化两列、剩余优先、拖拽排序）。界面文案已接入 i18n（`en` / `zh-CN`），语言由 `config.json` 的 `language` 控制。

面板与服务共用 `src/shared/magpie.ts`（配置解析、上游载荷规范化、卡片顺序键、错误词汇表）、`src/shared/format.ts`（格式化、命中率、窗口百分比）与 `src/shared/quotas-view.ts`（pool 分组、分层折叠、窗口排序、剩余金额行、余额拆分、图标映射）。

已确定的事实：

- 配置只来自 `$XDG_CONFIG_HOME/openchamber-magpie-usage/config.json`，没有该变量时 `~/.config/openchamber-magpie-usage/config.json`（`baseUrl`、可选 `apiKey`、`refreshSeconds` 默认 60、可选 `cardOrder`、可选 `language`）。服务每个请求重读文件；文件缺失或非法时回退到 `http://127.0.0.1:3425` 且无密钥。`cardOrder` 宽松解析：坏值只丢该项，绝不影响端点。`language` 非字符串/空串时回退 `auto` 并置 `languageInvalid`，端点与密钥照常生效；未知代码由面板对照注册表判定。
- 服务路由：`/health`（契约未变）、`/config`（含 `cardOrder`、`language`、`languageInvalid` 与 `reset`）、`POST /config/order`（唯一写路由）、`/v1/magpie/usage?period=`、`/v1/magpie/quotas?kept=1|refresh=1`。`/config` 只回答 `apiKeyConfigured` 布尔值，绝不回传密钥。
- 写顺序：读 → 合并 `cardOrder` → 临时文件 → 按原权限 `chmod` → `rename`；同一进程内串成一条 promise 链。文件不是合法 JSON 对象时先备份为 `.bak`（已存在则 `.bak-<UTC 时间戳>`）再写入只含 `cardOrder` 的文件，并把 `{ at, backupPath }` 记在内存里由 `/config` 回报。
- 非环回端点必须 https。跨源重定向一律拒绝（`redirect: "manual"`），密钥只随同源请求发送。
- 上游 `GET /v1/magpie/quotas?kept=1` 在本机 magpie `0.1.2470` 上返回空 `data`；服务在此时回退到最近一次成功读数（`stale: true`），无缓存时做一次普通读取。
- 命中率口径为 `cache_read / (input + cache_read + cache_write)`，分母为 0 时面板不显示该值。
- 额度窗口按 `pool` 分组，一个 pool 一行、两列网格，卡宽 <260px 时（容器查询）改单列。同一 pool 里名字尾段匹配 `(High|Low|Medium)` 的窗口视为分层并隐藏；pool 内没有时长窗口时保留用得最多的一层。无 pool 的窗口共用一个无标签行。
- 卡片顺序键为 `encodeURIComponent(provider)|encodeURIComponent(kind)|encodeURIComponent(user)`，同一三元组追加 `#2`、`#3`；过期键忽略，未列出的卡按网关顺序排在末尾。
- 厂商标识内联在 `src/panel/logos.ts`（来自 yetone/magpie，MIT）：彩色标记用 data URI `<img>`，单色标记用 `currentColor` 遮罩；未知供应商用 `generic`。
- 面板只经 `host.serviceRequest` 取数与写顺序；不读写任何浏览器存储；不提供密钥输入。

验证：`bun run check` 全绿；两次构建字节一致；模拟宿主下的真实网关实测覆盖 12 张卡、拖拽/键盘排序、配置备份与重置、260px 容器查询；写盘失败显示 `order not saved`。安装后的右侧栏像素外观与真实宿主交互仍未验证，见 README「验证记录」。
