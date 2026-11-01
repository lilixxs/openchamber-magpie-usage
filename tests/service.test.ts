import { afterEach, describe, expect, test } from 'bun:test';
import { request as httpRequest } from 'node:http';

import { createService, type LocalService } from '../src/service/server.ts';

const TOKEN = 'test-token';
const running: LocalService[] = [];

const start = async (): Promise<LocalService> => {
  const service = createService({ port: 0, token: TOKEN });
  running.push(service);
  await service.start();
  return service;
};

afterEach(async () => {
  await Promise.all(running.splice(0).map((service) => service.stop()));
});

type Answer = { status: number; body: string };

const call = (url: string, path: string, token?: string): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      `${url}${path}`,
      { method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {} },
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

describe('local service', () => {
  test('rejects a request without the bearer token', async () => {
    const service = await start();
    const answer = await call(service.url, '/health');
    expect(answer.status).toBe(401);
  });

  test('answers /health with the shared contract', async () => {
    const service = await start();
    const answer = await call(service.url, '/health', TOKEN);
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ ok: true, name: 'magpie-usage', apiVersion: 1 });
  });

  test('answers unknown routes with 404', async () => {
    const service = await start();
    const answer = await call(service.url, '/usage', TOKEN);
    expect(answer.status).toBe(404);
  });

  test('binds an OS-assigned port when asked for port 0', async () => {
    const service = await start();
    expect(service.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
