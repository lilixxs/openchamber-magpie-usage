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

## 状态

需求与开发步骤尚未落库。不要从 README 推断产品功能，也不要提前实现用量接口。确认需求后再写产品逻辑。
