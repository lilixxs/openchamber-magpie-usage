import { connectHost, HostRequestError } from '@openchamber/sdk';
import { applyHostReady, mountBadge, mountButton } from '@openchamber/sdk/ui';
import type { ServiceStatus } from '@openchamber/sdk';

import manifest from '../../package.json';
import { readHealth } from '../shared/health.ts';

const host = connectHost();
const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('Missing #root');

document.title = manifest.openchamber.contributes.panel.name;

const element = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const row = (label: string): { node: HTMLElement; value: HTMLElement } => {
  const node = element('div', 'row');
  const value = element('span', 'row-value', '—');
  node.append(element('span', 'row-key', label), value);
  return { node, value };
};

const header = element('header', 'header');
const heading = element('div', 'heading');
heading.append(
  element('h1', 'title', manifest.openchamber.contributes.panel.name),
  element('p', 'subtitle', 'OpenChamber extension scaffold'),
);
header.append(heading, element('span', 'version', `v${manifest.version}`));

const hostCard = element('section', 'card');
hostCard.append(element('div', 'label', 'Workbench'));
const surface = row('Surface');
const locale = row('Locale');
const project = row('Project');
hostCard.append(surface.node, locale.node, project.node);

const serviceCard = element('section', 'card');
const serviceHead = element('div', 'card-head');
const badgeRoot = element('span', 'badge-slot');
serviceHead.append(element('div', 'label', 'Local service'), badgeRoot);
const output = element('pre', 'output', 'No request yet.');
const actions = element('div', 'actions');
serviceCard.append(
  serviceHead,
  element(
    'p',
    'muted',
    'The panel cannot read files or call the gateway directly. Work that needs either belongs in the local service.',
  ),
  actions,
  output,
);

const footer = element(
  'p',
  'footer',
  'Framework only: the host bridge and the service are wired. Usage data comes after the requirements are written.',
);

root.append(header, hostCard, serviceCard, footer);

const badge = mountBadge(badgeRoot, { label: 'unknown', tone: 'neutral' });

const describeError = (error: unknown): string => {
  if (!(error instanceof HostRequestError)) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.code) {
    case 'NO_SERVICE':
    case 'NOT_GRANTED':
      return 'The local service is not approved. Open Settings → Extensions and allow it, then retry.';
    case 'DISABLED':
      return 'The extension is paused in Settings → Extensions.';
    case 'SERVICE_FAILED':
      return 'The local service stopped. It restarts on the next request.';
    default:
      return `Service request failed: ${error.code}.`;
  }
};

const toneForStatus = (status: ServiceStatus): 'neutral' | 'success' | 'warning' | 'error' => {
  if (status === 'ready') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'starting') return 'warning';
  return 'neutral';
};

const refreshStatus = async (): Promise<void> => {
  try {
    const { status } = await host.serviceStatus();
    badge.update({ label: status, tone: toneForStatus(status) });
  } catch (error) {
    if (error instanceof HostRequestError && error.code === 'HOST_UNAVAILABLE') {
      badge.update({ label: 'outside OpenChamber', tone: 'neutral' });
      return;
    }
    badge.update({ label: 'unknown', tone: 'neutral' });
  }
};

const checkButton = mountButton(actions, {
  label: 'Check service',
  variant: 'outline',
  size: 'sm',
  onClick: () => {
    void checkService();
  },
});

let checking = false;

const checkService = async (): Promise<void> => {
  if (checking) return;
  checking = true;
  checkButton.update({ loading: true });
  output.textContent = 'Requesting /health…';
  try {
    const result = await host.serviceRequest({ method: 'GET', path: '/health' });
    const health = readHealth(result.body);
    if (result.status === 200 && health) {
      output.textContent = `HTTP ${result.status} · ${health.name} · API v${health.apiVersion}`;
      badge.update({ label: 'ready', tone: 'success' });
    } else {
      output.textContent = `HTTP ${result.status} · ${result.body}`;
      badge.update({ label: 'unexpected answer', tone: 'error' });
    }
  } catch (error) {
    output.textContent = describeError(error);
    badge.update({ label: 'unavailable', tone: 'error' });
  } finally {
    checking = false;
    checkButton.update({ loading: false });
    void refreshStatus();
  }
};

let firstReady = true;

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  surface.value.textContent = context.surface;
  locale.value.textContent = context.locale;
  project.value.textContent = context.directory ?? 'No project';
  if (firstReady) {
    firstReady = false;
    void refreshStatus();
  }
});
