// Entry the host spawns for this extension. The host sets the port and the
// shared bearer token; the process must bind loopback only.
import { createService } from './server.ts';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';

if (!Number.isInteger(port) || port <= 0 || port > 65535 || token === '') {
  console.error('OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required');
  process.exit(1);
}

const service = createService({ port, token });

void service.start().catch((error: unknown) => {
  console.error('Local service failed to start:', error);
  process.exit(1);
});

const shutdown = (): void => {
  void service.stop().then(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
