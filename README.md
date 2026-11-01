# openchamber-magpie-usage

OpenChamber 扩展：在右侧栏显示 Magpie 网关的用量与配额。

**当前状态：项目框架。** 面板已接通 OpenChamber 宿主桥与本地服务；用量数据尚未实现。需求与开发步骤另行编写，不在本仓库内推测。

## 安装

在 OpenChamber 打开 **Settings → Extensions**，把下面的地址填入 *Folder, ZIP, or URL*，然后选择 **Add**：

```text
https://github.com/lilixxs/openchamber-magpie-usage.git
```

安装后批准 **Run a local service**。面板需要该服务读取网关配置并发起请求。

开发时可直接填入本地目录：

```text
D:\学习\git-prj\js_prj\openchamber-magpie-usage
```

文件夹安装直接运行当前目录。修改源码后重新构建，再在 Extensions 中重新加载。

## 开发

需要 Bun 1.4 或更高版本。

```bash
bun install
bun run check     # 类型检查 → 测试 → 构建
bun run build     # 只构建 panel/main.js 和 service/main.js
bun test          # 只跑测试
bun test tests/service.test.ts
bun run typecheck
```

OpenChamber 不编译 TypeScript。`panel/main.js` 与 `service/main.js` 是构建产物，必须提交。修改 `src/` 后运行 `bun run build`。

## 结构

| 路径 | 作用 |
| --- | --- |
| `package.json` | npm 清单 + `openchamber` 清单（面板、服务、引擎下限） |
| `src/panel/main.ts` | 面板源码：宿主桥、主题、服务请求 |
| `src/service/server.ts` | 本地 HTTP 服务工厂：`/health`、Bearer 校验 |
| `src/service/main.ts` | 服务入口：读取宿主注入的端口与 token |
| `src/shared/health.ts` | 面板与服务共用的 `/health` 契约 |
| `panel/index.html` | 面板页面；只加载 `./main.js` |
| `panel/styles.css` | 面板样式；颜色取自宿主主题变量 |
| `tests/` | 清单校验、`/health` 解析、真实 HTTP 服务测试 |

## 边界

- 面板运行在沙箱 iframe。它不能读文件、不能直接访问网关、不能拨号访问本地服务。
- 本地服务以当前用户权限运行。它只监听 `127.0.0.1`，每个请求都校验 `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN`。
- 网关密钥只允许进入服务进程，不得进入面板、bundle、日志或提交记录。
- 面板通过 `host.serviceRequest()` 调用服务；路径不能带 scheme 或主机名。

## 发布

1. 修改 `package.json` 的 `version`。
2. 运行 `bun run build`。
3. 提交 `panel/main.js` 和 `service/main.js`。
4. 推送。Git 安装在 Extensions 中检测到更高的 `version` 后可更新。

## 许可

MIT
