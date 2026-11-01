// src/service/server.ts
import { createServer } from "node:http";

// src/shared/health.ts
var SERVICE_NAME = "magpie-usage";
var SERVICE_API_VERSION = 1;

// src/service/server.ts
var writeJson = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};
var createService = ({ port, token }) => {
  let server;
  let boundPort = port;
  return {
    get url() {
      return `http://127.0.0.1:${boundPort}`;
    },
    async start() {
      if (server)
        return;
      const next = createServer((request, response) => {
        if (request.headers.authorization !== `Bearer ${token}`) {
          writeJson(response, 401, { error: "unauthorized" });
          return;
        }
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/health") {
          writeJson(response, 200, { ok: true, name: SERVICE_NAME, apiVersion: SERVICE_API_VERSION });
          return;
        }
        writeJson(response, 404, { error: "not-found" });
      });
      await new Promise((resolve, reject) => {
        next.once("error", reject);
        next.listen(port, "127.0.0.1", () => {
          next.off("error", reject);
          resolve();
        });
      });
      const address = next.address();
      if (address && typeof address === "object")
        boundPort = address.port;
      server = next;
    },
    async stop() {
      const current = server;
      server = undefined;
      if (!current)
        return;
      await new Promise((resolve) => current.close(() => resolve()));
    }
  };
};

// src/service/main.ts
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? "";
if (!Number.isInteger(port) || port <= 0 || port > 65535 || token === "") {
  console.error("OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required");
  process.exit(1);
}
var service = createService({ port, token });
service.start().catch((error) => {
  console.error("Local service failed to start:", error);
  process.exit(1);
});
var shutdown = () => {
  service.stop().then(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
