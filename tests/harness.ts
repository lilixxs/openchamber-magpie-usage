// Test-only helpers: a fake magpie gateway, a temp config file, and a started
// local service. Not a test file, so `bun test` does not collect it.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createService, type LocalService, type ServiceOptions } from '../src/service/server.ts';

export const TOKEN = 'test-token';

/* -------------------------------- gateway -------------------------------- */

export type GatewayRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  authorization: string | null;
};

export type GatewayReply = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};

export type Gateway = {
  url: string;
  requests: GatewayRequest[];
  close(): Promise<void>;
};

export const startGateway = async (
  handler: (request: GatewayRequest) => GatewayReply | Promise<GatewayReply>,
): Promise<Gateway> => {
  const requests: GatewayRequest[] = [];
  const server = createServer((request, response) => {
    response.on('error', () => {});
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const record: GatewayRequest = {
      method: request.method ?? 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      authorization: request.headers.authorization ?? null,
    };
    requests.push(record);
    void Promise.resolve(handler(record))
      .then((reply) => {
        if (response.writableEnded || response.destroyed) return;
        response.writeHead(reply.status ?? 200, {
          'content-type': 'application/json; charset=utf-8',
          ...reply.headers,
        });
        response.end(reply.body ?? '');
      })
      .catch(() => {
        if (!response.destroyed) response.destroy();
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

/** A port nothing listens on, for the connection-refused path. */
export const deadPortUrl = async (): Promise<string> => {
  const gateway = await startGateway(() => ({ status: 200, body: '{}' }));
  await gateway.close();
  return gateway.url;
};

/* --------------------------------- config -------------------------------- */

export type TempDir = { path: string; dispose(): void };

export const makeTempDir = (): TempDir => {
  const path = mkdtempSync(join(tmpdir(), 'magpie-usage-test-'));
  return {
    path,
    dispose: () => rmSync(path, { recursive: true, force: true }),
  };
};

export const writeConfig = (dir: TempDir, value: unknown): string => {
  const path = join(dir.path, 'config.jsonc');
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
  return path;
};

/** Writes raw text to a named config file, for JSONC and migration tests. */
export const writeConfigText = (dir: TempDir, text: string, name = 'config.jsonc'): string => {
  const path = join(dir.path, name);
  writeFileSync(path, text, 'utf8');
  return path;
};

/* -------------------------------- service -------------------------------- */

const running: LocalService[] = [];

export const startService = async (options: Partial<ServiceOptions> = {}): Promise<LocalService> => {
  const service = createService({ port: 0, token: TOKEN, ...options });
  running.push(service);
  await service.start();
  return service;
};

export const stopAll = async (): Promise<void> => {
  await Promise.all(running.splice(0).map((service) => service.stop()));
};

export type Answer = { status: number; body: string };

export const call = (url: string, path: string, token: string | null = TOKEN): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      `${url}${path}`,
      { method: 'GET', headers: token === null ? {} : { authorization: `Bearer ${token}` } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });

export const request = (url: string, method: string, path: string, token: string | null = TOKEN): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      `${url}${path}`,
      { method, headers: token === null ? {} : { authorization: `Bearer ${token}` } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });

/** A JSON POST, the way the host proxy sends a `serviceRequest` body. */
export const post = (
  url: string,
  path: string,
  body: unknown,
  token: string | null = TOKEN,
): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const req = httpRequest(
      `${url}${path}`,
      {
        method: 'POST',
        headers: {
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: text }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
