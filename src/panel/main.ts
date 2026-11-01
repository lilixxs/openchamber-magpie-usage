import { connectHost } from '@openchamber/sdk';

import { mountPanel } from './app.ts';

const host = connectHost();
const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('Missing #root');

mountPanel({ host, root });
