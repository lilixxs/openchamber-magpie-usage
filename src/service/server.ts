// Runs under the app's Node runtime on 127.0.0.1. The panel reaches it only
// through the host's authenticated `serviceRequest` proxy.
import { createServer, type Server, type ServerResponse } from 'node:http';

import { SERVICE_API_VERSION, SERVICE_NAME } from '../shared/health.ts';

export type ServiceOptions = {
  /** 0 asks the OS for a free port. */
  port: number;
  token: string;
};

export type LocalService = {
  readonly url: string;
  start(): Promise<void>;
  stop(): Promise<void>;
};

const writeJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};

export const createService = ({ port, token }: ServiceOptions): LocalService => {
  let server: Server | undefined;
  let boundPort = port;

  return {
    get url(): string {
      return `http://127.0.0.1:${boundPort}`;
    },

    async start(): Promise<void> {
      if (server) return;
      const next = createServer((request, response) => {
        if (request.headers.authorization !== `Bearer ${token}`) {
          writeJson(response, 401, { error: 'unauthorized' });
          return;
        }
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (request.method === 'GET' && url.pathname === '/health') {
          writeJson(response, 200, { ok: true, name: SERVICE_NAME, apiVersion: SERVICE_API_VERSION });
          return;
        }
        writeJson(response, 404, { error: 'not-found' });
      });

      await new Promise<void>((resolve, reject) => {
        next.once('error', reject);
        next.listen(port, '127.0.0.1', () => {
          next.off('error', reject);
          resolve();
        });
      });

      const address = next.address();
      if (address && typeof address === 'object') boundPort = address.port;
      server = next;
    },

    async stop(): Promise<void> {
      const current = server;
      server = undefined;
      if (!current) return;
      await new Promise<void>((resolve) => current.close(() => resolve()));
    },
  };
};
