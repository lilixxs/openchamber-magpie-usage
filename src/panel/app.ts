import { HostRequestError } from '@openchamber/sdk';
import { applyHostReady, mountBadge, mountButton } from '@openchamber/sdk/ui';
import type { HostClient, ServiceStatus } from '@openchamber/sdk';

import manifest from '../../package.json';
import en from '../../panel/locales/en.json';
import localeIndex from '../../panel/locales/index.json';
import zhCN from '../../panel/locales/zh-CN.json';
import { createTranslator, type MessageVars, type Messages, type Translator } from '../i18n/messages.ts';
import { readRegistry, resolveLocale, type LocaleEntry } from '../i18n/locale.ts';
import {
  DEFAULT_FONT_SCALE,
  DEFAULT_REFRESH_SECONDS,
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  PERIODS,
  applyCardOrder,
  cardOrderKeys,
  isPeriod,
  isServiceErrorBody,
  type ConfigReport,
  type OrderedCard,
  type Period,
  type QuotaCard,
  type QuotaReport,
  type QuotaWindow,
  type ServiceErrorKind,
  type UsageBucket,
  type UsageReport,
} from '../shared/magpie.ts';
import {
  cacheHitRate,
  durationParts,
  formatCompact,
  formatCost,
  formatCredits,
  formatInt,
  formatPercent,
  formatRelative,
  formatWhen,
  quotaLeftPercent,
  type RelativeLabels,
} from '../shared/format.ts';
import {
  balanceParts,
  groupWindows,
  logoFor,
  remainingAmountLine,
  tightestLeftPercent,
  type BalancePart,
} from '../shared/quotas-view.ts';
import { LOGOS, type LogoEntry } from './logos.ts';

/** Monochrome gear, painted with `currentColor`; not a drag handle. */
const GEAR_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>';

export type PanelOptions = {
  /** The host bridge to read through; the panel never reaches the network itself. */
  host: HostClient;
  /** The element the panel builds itself into. */
  root: HTMLElement;
};

export type PanelHandle = {
  /** Stops the refresh timer and detaches from the host. */
  dispose(): void;
};

/**
 * Builds the panel and starts its first cycle. Called once by the entry after
 * `connectHost`; tests call it with a fake host and their own root.
 */
export const mountPanel = ({ host, root }: PanelOptions): PanelHandle => {
  let disposed = false;

  const panelName = manifest.openchamber.contributes.panel.name;
  document.title = panelName;

  /** Cards left open on first paint; the rest start collapsed. Error cards always show. */
  const OPEN_CARDS = 2;

  type Localized = { key: string; vars?: MessageVars };

  const FALLBACK_MESSAGES: Record<string, string> = en;
  let translator: Translator = createTranslator({
    messages: FALLBACK_MESSAGES,
    fallback: FALLBACK_MESSAGES,
    locale: 'en',
  });
  let activeLocale = 'en';
  let activeDir: 'ltr' | 'rtl' = 'ltr';
  let registry: LocaleEntry[] | null = null;
  let hostLocale = 'en';

  /** Reads the current translator, so a locale change reaches every later render. */
  const t: Translator = (key, vars) => translator(key, vars);

  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const setText = (node: HTMLElement, text: string): void => {
    node.textContent = text;
  };

  const setMessage = (node: HTMLElement, text: string | null): void => {
    node.textContent = text ?? '';
    node.hidden = text === null;
  };

  const clear = (node: Element): void => {
    while (node.firstChild) node.removeChild(node.firstChild);
  };

  /* -------------------------------------------------------------------------- */
  /* Layout, built once                                                         */
  /* -------------------------------------------------------------------------- */

  const header = el('header', 'top');
  const heading = el('div', 'heading');
  const title = el('h1', 'title', panelName);
  const subtitle = el('p', 'subtitle', t('panel.subtitle'));
  heading.append(title, subtitle);
  const badgeSlot = el('span', 'badge-slot');
  header.append(heading, badgeSlot);

  const toolbar = el('div', 'toolbar');
  const segmented = el('div', 'segmented');
  segmented.setAttribute('role', 'group');
  segmented.setAttribute('aria-label', t('period.group'));
  const periodButtons = new Map<Period, HTMLButtonElement>();
  for (const period of PERIODS) {
    const button = el('button', 'segment', t(`period.${period}`));
    button.type = 'button';
    button.dataset.period = period;
    button.setAttribute('aria-pressed', period === 'today' ? 'true' : 'false');
    segmented.append(button);
    periodButtons.set(period, button);
  }
  const refreshSlot = el('div', 'refresh-slot');
  toolbar.append(segmented, refreshSlot);

  const banner = el('p', 'banner');
  banner.hidden = true;
  banner.setAttribute('role', 'status');

  const usageCard = el('section', 'card');
  const usageHead = el('div', 'card-head');
  const usageStamp = el('span', 'stamp', '—');
  const usageLabel = el('span', 'label', t('usage.title'));
  usageHead.append(usageLabel, usageStamp);
  const kpis = el('div', 'kpis');

  type Kpi = { label: HTMLElement; value: HTMLElement; sub: HTMLElement };

  const makeKpi = (key: string): Kpi => {
    const cell = el('div', 'kpi');
    const label = el('span', 'kpi-label', t(key));
    const value = el('span', 'kpi-value', '—');
    const sub = el('span', 'kpi-sub', '');
    cell.append(label, value, sub);
    kpis.append(cell);
    return { label, value, sub };
  };

  const kpiTokens = makeKpi('kpi.tokens');
  const kpiCache = makeKpi('kpi.cacheHit');
  const kpiCalls = makeKpi('kpi.calls');
  const kpiCost = makeKpi('kpi.cost');
  const kpiCredits = makeKpi('kpi.credits');

  const chart = el('div', 'chart');
  const chartLegend = el('div', 'legend');
  const legendIn = el('span', 'legend-item', t('usage.legend.in'));
  const legendOut = el('span', 'legend-item legend-out', t('usage.legend.out'));
  chartLegend.append(legendIn, legendOut);
  const sinceLine = el('p', 'since', '—');
  usageCard.append(usageHead, kpis, chart, chartLegend, sinceLine);

  const quotaCard = el('section', 'card');
  const quotaHead = el('div', 'card-head');
  const quotaStamp = el('span', 'stamp', '');
  const quotaOrderNote = el('span', 'stamp stamp-error', '');
  quotaOrderNote.hidden = true;
  const quotaStampSlot = el('span', 'stamp-slot');
  quotaStampSlot.append(quotaOrderNote, quotaStamp);
  const quotaLabel = el('span', 'label', t('quotas.title'));
  quotaHead.append(quotaLabel, quotaStampSlot);
  const quotaList = el('div', 'quotas');
  const quotaLive = el('p', 'quota-live');
  quotaLive.setAttribute('role', 'status');
  quotaLive.setAttribute('aria-live', 'polite');
  quotaCard.append(quotaHead, quotaList, quotaLive);

  const configCard = el('section', 'card config');
  const configHead = el('button', 'config-head');
  configHead.type = 'button';
  configHead.setAttribute('aria-expanded', 'false');
  configHead.setAttribute('aria-controls', 'config-body');
  const configGear = el('span', 'config-gear');
  configGear.innerHTML = GEAR_SVG;
  const configLabel = el('span', 'label', t('config.title'));
  const configStatus = el('span', 'config-status', t('config.status.checking'));
  const configChev = el('span', 'config-chev', '▸');
  configHead.append(configGear, configLabel, configStatus, configChev);

  const configBody = el('div', 'config-body');
  configBody.id = 'config-body';
  configBody.hidden = true;

  const configRows = el('div', 'rows');
  const configIssue = el('p', 'issue');
  configIssue.hidden = true;
  const configLanguage = el('p', 'issue');
  configLanguage.hidden = true;
  const configFontScale = el('p', 'issue');
  configFontScale.hidden = true;
  const configNote = el('p', 'note');
  configNote.hidden = true;
  const configFontNote = el('p', 'note', t('config.fontScale.note'));
  const configRecovery = el('div', 'config-recovery');
  configRecovery.hidden = true;
  const configInit = el('p', 'issue');
  configInit.hidden = true;

  const configCreate = el('div', 'config-create');
  configCreate.hidden = true;
  const configCreateAsk = el('div', 'config-actions');
  const configCreateButton = el('button', 'config-action', t('config.create'));
  configCreateButton.type = 'button';
  configCreateAsk.append(configCreateButton);
  const configCreateConfirm = el('div', 'config-confirm');
  configCreateConfirm.hidden = true;
  const configCreateQuestion = el('p', 'note', '');
  const configCreateActions = el('div', 'config-actions');
  const configCreateYes = el('button', 'config-action', t('config.create.confirmYes'));
  configCreateYes.type = 'button';
  const configCreateNo = el('button', 'config-action config-action-secondary', t('config.create.cancel'));
  configCreateNo.type = 'button';
  configCreateActions.append(configCreateYes, configCreateNo);
  configCreateConfirm.append(configCreateQuestion, configCreateActions);
  const configCreateStatus = el('p', 'note config-create-status');
  configCreateStatus.hidden = true;
  configCreateStatus.setAttribute('role', 'status');
  configCreate.append(configCreateAsk, configCreateConfirm, configCreateStatus);

  const configCopyStatus = el('p', 'note config-copy');
  configCopyStatus.hidden = true;
  configCopyStatus.setAttribute('role', 'status');

  configBody.append(
    configRows,
    configCopyStatus,
    configIssue,
    configRecovery,
    configLanguage,
    configFontScale,
    configNote,
    configFontNote,
    configInit,
    configCreate,
  );
  configCard.append(configHead, configBody);

  type ConfigRow = { key: HTMLElement; value: HTMLElement };

  const configRow = (key: string): ConfigRow => {
    const node = el('div', 'row');
    const label = el('span', 'row-key', t(key));
    const value = el('span', 'row-value', '—');
    node.append(label, value);
    configRows.append(node);
    return { key: label, value };
  };

  const configPathRow = el('div', 'row');
  const configPathKey = el('span', 'row-key', t('config.file'));
  const configPathValue = el('button', 'row-value config-path', '—');
  configPathValue.type = 'button';
  configPathRow.append(configPathKey, configPathValue);
  configRows.append(configPathRow);

  const endpointRow = configRow('config.endpoint');
  const keyRow = configRow('config.apiKey');
  const refreshRow = configRow('config.refresh');
  const fontScaleRow = configRow('config.fontScale');
  const endpointValue = endpointRow.value;
  const keyValue = keyRow.value;
  const refreshValue = refreshRow.value;
  const fontScaleValue = fontScaleRow.value;

  const footer = el('p', 'footer', t('footer.data'));

  root.append(header, toolbar, banner, usageCard, quotaCard, configCard, footer);

  let badgeKey = 'badge.starting';
  let badgeTone: 'neutral' | 'success' | 'warning' | 'error' = 'neutral';

  const badge = mountBadge(badgeSlot, { label: t(badgeKey), tone: badgeTone });

  const setBadge = (key: string, tone: typeof badgeTone): void => {
    badgeKey = key;
    badgeTone = tone;
    badge.update({ label: t(key), tone });
  };

  // Mounted once; `onReady` and every refresh only update values.
  const refreshButton = mountButton(refreshSlot, {
    label: t('button.refresh'),
    variant: 'outline',
    size: 'sm',
    onClick: () => {
      void cycle('manual');
    },
  });

  /* -------------------------------------------------------------------------- */
  /* State                                                                      */
  /* -------------------------------------------------------------------------- */

  type State = {
    period: Period;
    config: ConfigReport | null;
    usage: UsageReport | null;
    quotas: QuotaReport | null;
    /** Card order as last read from or written to the config file. */
    order: string[];
    /** Keys of the cards whose body is open. */
    openCards: Set<string>;
    /** Whether the "first two cards open" default has been applied. */
    openDefaulted: boolean;
    /** Suppresses quota re-rendering while a card is being dragged. */
    dragging: boolean;
    /** Why the last order write failed, shown next to the Quotas stamp. */
    orderError: string | null;
    busy: boolean;
  };

  const state: State = {
    period: 'today',
    config: null,
    usage: null,
    quotas: null,
    order: [],
    openCards: new Set<string>(),
    openDefaulted: false,
    dragging: false,
    orderError: null,
    busy: false,
  };

  let activeFontScale = DEFAULT_FONT_SCALE;

  /** Collapsed by default; only this panel instance remembers it. */
  let configOpen = false;

  const applyConfigOpen = (): void => {
    configBody.hidden = !configOpen;
    configHead.setAttribute('aria-expanded', configOpen ? 'true' : 'false');
    configChev.textContent = configOpen ? '▾' : '▸';
  };

  configHead.addEventListener('click', () => {
    configOpen = !configOpen;
    applyConfigOpen();
  });
  applyConfigOpen();

  type InitMessage = { key: string; vars?: MessageVars };
  type InitState = 'idle' | 'running' | 'done' | 'failed';
  let initState: InitState = 'idle';
  let initMessage: InitMessage | null = null;
  let creatingConfig = false;

  /** Version-prefixed, instance-scoped marker; the only host storage this panel uses. */
  const INIT_MARKER_KEY = 'openchamber-magpie-usage:v1:config-initialized';
  const STORAGE_OPTIONS = { scope: 'instance' as const };

  /**
   * The host has no font-size token for guests (SDK 2.5.1); `fontScale` in the
   * config is the panel's manual equivalent. The root is set after every
   * `applyHostReady`, which otherwise writes `0.875rem` inline.
   */
  const applyFontScale = (scale: number): void => {
    const safe = Number.isFinite(scale) ? scale : DEFAULT_FONT_SCALE;
    const next = Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, Math.round(safe)));
    const changed = next !== activeFontScale;
    activeFontScale = next;
    document.documentElement.style.fontSize = `${(14 * next) / 100}px`;
    if (changed && state.usage) renderUsage();
  };

  /* -------------------------------------------------------------------------- */
  /* Language                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * Bundles are imported, not fetched: the panel runs in a sandboxed iframe with
   * no network of its own, and a package-relative request does not survive the
   * web relay's opaque origin. The registry is read from the imported list.
   */
  const MESSAGES: Record<string, Messages> = {
    en,
    'zh-CN': zhCN as Messages,
  };

  const messagesFor = (code: string): Messages | null => MESSAGES[code] ?? null;

  /** Test locales (for example the Arabic RTL fixture) are never offered at runtime. */
  const localeCodes = (): string[] =>
    registry?.filter((entry) => !entry.test).map((entry) => entry.code) ?? [];

  const localizedDuration = (ms: number): string => {
    const { days, hours, minutes, seconds } = durationParts(ms);
    if (days > 0) return hours > 0 ? t('time.daysHours', { days, hours }) : t('time.days', { value: days });
    if (hours > 0) {
      return minutes > 0 ? t('time.hoursMinutes', { hours, minutes }) : t('time.hours', { value: hours });
    }
    if (minutes > 0) return t('time.minutes', { value: minutes });
    return t('time.seconds', { value: seconds });
  };

  const relativeText = (iso: string | null): string => {
    const labels: RelativeLabels = {
      justNow: t('time.justNow'),
      future: (duration) => t('time.in', { duration }),
      past: (duration) => t('time.ago', { duration }),
      duration: localizedDuration,
    };
    return formatRelative(iso, Date.now(), labels);
  };

  /** Rewrites every mounted label; called when the language resolves or changes. */
  const applyStaticLabels = (): void => {
    document.documentElement.lang = activeLocale;
    document.documentElement.dir = activeDir;

    segmented.setAttribute('aria-label', t('period.group'));
    for (const [period, button] of periodButtons) setText(button, t(`period.${period}`));

    setText(usageLabel, t('usage.title'));
    setText(kpiTokens.label, t('kpi.tokens'));
    setText(kpiCache.label, t('kpi.cacheHit'));
    setText(kpiCalls.label, t('kpi.calls'));
    setText(kpiCost.label, t('kpi.cost'));
    setText(kpiCredits.label, t('kpi.credits'));
    setText(legendIn, t('usage.legend.in'));
    setText(legendOut, t('usage.legend.out'));

    setText(quotaLabel, t('quotas.title'));
    setText(configLabel, t('config.title'));
    setText(configPathKey, t('config.file'));
    setText(endpointRow.key, t('config.endpoint'));
    setText(keyRow.key, t('config.apiKey'));
    setText(refreshRow.key, t('config.refresh'));
    setText(fontScaleRow.key, t('config.fontScale'));
    setText(configFontNote, t('config.fontScale.note'));
    setText(configCreateButton, t('config.create'));
    setText(configCreateYes, t('config.create.confirmYes'));
    setText(configCreateNo, t('config.create.cancel'));
    setText(footer, t('footer.data'));

    refreshButton.update({ label: t('button.refresh') });
    badge.update({ label: t(badgeKey), tone: badgeTone });

    if (state.config) renderConfig();
    else setText(configStatus, t('config.status.checking'));
    if (state.usage) renderUsage();
    if (state.quotas) renderQuotas();
    if (!state.config && !state.usage) setText(subtitle, t('panel.subtitle'));
  };

  let localeToken = 0;
  let registryLoaded = false;

  const syncLocale = async (): Promise<void> => {
    if (disposed) return;
    const config = state.config;
    if (!registry || !config) return;
    const setting = typeof config.language === 'string' && config.language !== '' ? config.language : 'auto';
    const resolved = resolveLocale(setting, hostLocale, localeCodes());
    if (resolved.locale === activeLocale) return;

    const token = ++localeToken;
    const messages = messagesFor(resolved.locale);
    if (token !== localeToken || !messages) return;

    const entry = registry.find((candidate) => candidate.code === resolved.locale);
    activeLocale = resolved.locale;
    activeDir = entry?.dir ?? 'ltr';
    translator = createTranslator({ messages, fallback: FALLBACK_MESSAGES, locale: activeLocale });
    applyStaticLabels();
  };

  const initializeLocales = async (): Promise<void> => {
    if (registryLoaded) return;
    registryLoaded = true;
    const entries = readRegistry(JSON.stringify(localeIndex));
    if (!entries) return;
    registry = entries;
    await syncLocale();
    // The registry decides whether an explicit language is supported, which
    // feeds the configuration card status.
    if (state.config) renderConfig();
  };

  /* -------------------------------------------------------------------------- */
  /* Service access                                                             */
  /* -------------------------------------------------------------------------- */

  const describeHostError = (error: unknown): string => {
    if (!(error instanceof HostRequestError)) {
      return error instanceof Error ? error.message : String(error);
    }
    switch (error.code) {
      case 'NO_SERVICE':
      case 'NOT_GRANTED':
        return t('error.host.noService');
      case 'DISABLED':
        return t('error.host.disabled');
      case 'SERVICE_FAILED':
        return t('error.host.serviceFailed');
      case 'REQUEST_FAILED':
        return t('error.host.requestFailed');
      case 'RESPONSE_TOO_LARGE':
        return t('error.host.responseTooLarge');
      default:
        return t('error.host.generic', { code: error.code });
    }
  };

  /** The service's error vocabulary, in the panel's active language. */
  const serviceErrorText = (kind: ServiceErrorKind | undefined): string => {
    switch (kind) {
      case 'bad-request':
        return t('error.service.badRequest');
      case 'config-conflict':
        return t('error.service.configConflict');
      case 'internal':
        return t('error.service.internal');
      case 'upstream-unauthorized':
        return t('error.service.unauthorized');
      case 'upstream-forbidden':
        return t('error.service.forbidden');
      case 'upstream-status':
        return t('error.service.status');
      case 'upstream-timeout':
        return t('error.service.timeout');
      case 'upstream-network':
        return t('error.service.network');
      case 'upstream-not-json':
        return t('error.service.notJson');
      case 'upstream-schema':
        return t('error.service.schema');
      case 'upstream-redirect':
        return t('error.service.redirect');
      default:
        return t('error.service.unknown');
    }
  };

  type Fetched = { ok: true; value: unknown } | { ok: false; message: string };

  const fetchJson = async (path: string, query?: Record<string, string>): Promise<Fetched> => {
    let result: { status: number; body: string };
    try {
      result = await host.serviceRequest({ method: 'GET', path, ...(query ? { query } : {}) });
    } catch (error) {
      return { ok: false, message: describeHostError(error) };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      return { ok: false, message: t('error.http.notJson', { status: result.status }) };
    }

    if (result.status !== 200) {
      if (isServiceErrorBody(parsed)) {
        const suffix = parsed.error.status === undefined ? '' : ` (HTTP ${parsed.error.status})`;
        return { ok: false, message: `${serviceErrorText(parsed.error.kind)}${suffix}` };
      }
      return { ok: false, message: t('error.http.status', { status: result.status }) };
    }

    return { ok: true, value: parsed };
  };

  const postJson = async (path: string, body: unknown): Promise<Fetched> => {
    let result: { status: number; body: string };
    try {
      result = await host.serviceRequest({ method: 'POST', path, body: JSON.stringify(body) });
    } catch (error) {
      return { ok: false, message: describeHostError(error) };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      return { ok: false, message: t('error.http.notJson', { status: result.status }) };
    }

    if (result.status !== 200) {
      if (isServiceErrorBody(parsed)) {
        // `internal` is this service's own sentence, filled in by us; every other
        // kind is mapped here so upstream text never reaches the panel.
        return {
          ok: false,
          message: parsed.error.kind === 'internal' ? parsed.error.message : serviceErrorText(parsed.error.kind),
        };
      }
      return { ok: false, message: t('error.http.status', { status: result.status }) };
    }
    return { ok: true, value: parsed };
  };

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  const loadConfig = async (): Promise<void> => {
    const answer = await fetchJson('/config');
    if (disposed) return;
    if (!answer.ok) {
      setMessage(banner, answer.message);
      return;
    }
    const value = answer.value;
    if (!isRecord(value) || typeof value.configPath !== 'string' || typeof value.baseUrl !== 'string') {
      setMessage(banner, t('error.shape.config'));
      return;
    }
    state.config = value as unknown as ConfigReport;
    // A failed save keeps the on-screen order; do not let a later config read
    // snap the cards back to the old file order before the next retry.
    if (state.orderError === null) {
      state.order = Array.isArray(value.cardOrder)
        ? value.cardOrder.filter((entry): entry is string => typeof entry === 'string')
        : [];
    }
    renderConfig();
    void syncLocale();
  };

  const loadUsage = async (): Promise<void> => {
    const answer = await fetchJson('/v1/magpie/usage', { period: state.period });
    if (disposed) return;
    if (!answer.ok) {
      state.usage = null;
      renderUsageError(answer.message);
      return;
    }
    const value = answer.value;
    if (!isRecord(value) || !isRecord(value.totals) || !Array.isArray(value.series)) {
      state.usage = null;
      renderUsageError(t('error.shape.usage'));
      return;
    }
    state.usage = value as unknown as UsageReport;
    renderUsage();
  };

  const loadQuotas = async (manual: boolean): Promise<void> => {
    const query: Record<string, string> = manual ? { refresh: '1' } : { kept: '1' };
    const answer = await fetchJson('/v1/magpie/quotas', query);
    if (disposed) return;
    if (!answer.ok) {
      state.quotas = null;
      renderQuotaError(answer.message);
      return;
    }
    const value = answer.value;
    if (!isRecord(value) || !Array.isArray(value.cards)) {
      state.quotas = null;
      renderQuotaError(t('error.shape.quotas'));
      return;
    }
    state.quotas = value as unknown as QuotaReport;
    renderQuotas();
  };

  /* -------------------------------------------------------------------------- */
  /* Config actions                                                             */
  /* -------------------------------------------------------------------------- */

  const copyConfigPath = async (): Promise<void> => {
    const path = state.config?.configPath;
    if (!path) return;
    try {
      await host.writeClipboard(path);
      setMessage(configCopyStatus, t('config.copy.ok'));
    } catch (error) {
      setMessage(configCopyStatus, t('config.copy.failed', { message: describeHostError(error) }));
    }
  };

  configPathValue.addEventListener('click', () => {
    void copyConfigPath();
  });

  const createMissingConfig = async (): Promise<void> => {
    const config = state.config;
    if (!config || creatingConfig) return;
    creatingConfig = true;
    configCreateButton.disabled = true;
    configCreateYes.disabled = true;
    setMessage(configCreateStatus, t('config.create.busy'));

    const answer = await postJson('/config/create', { order: state.order });
    if (disposed) return;
    creatingConfig = false;
    configCreateButton.disabled = false;
    configCreateYes.disabled = false;

    if (!answer.ok) {
      setMessage(configCreateStatus, t('config.create.failed', { message: answer.message }));
      return;
    }

    const created = isRecord(answer.value) && answer.value.created === true;
    configCreateConfirm.hidden = true;
    await loadConfig();
    if (disposed) return;
    if (!created) {
      setMessage(configCreateStatus, t('config.create.exists', { path: config.configPath }));
    } else {
      setMessage(configCreateStatus, null);
    }
    renderConfig();
  };

  configCreateButton.addEventListener('click', () => {
    configCreateConfirm.hidden = false;
    if (state.config) {
      setText(configCreateQuestion, t('config.create.confirm', { path: state.config.configPath }));
    }
  });

  configCreateNo.addEventListener('click', () => {
    configCreateConfirm.hidden = true;
  });

  configCreateYes.addEventListener('click', () => {
    void createMissingConfig();
  });

  /**
   * First open only. The marker is the one exception to "the panel stores
   * nothing": instance-scoped host storage keeps a versioned flag, never the
   * config, a path, the key, the fold state, or the order.
   */
  const initializeConfig = async (): Promise<void> => {
    if (initState !== 'idle' || disposed) return;
    const config = state.config;
    if (!config) return;
    initState = 'running';
    // Disable the manual button while the automatic create is in flight.
    renderConfig();

    try {
      if (!host.storage) throw new Error('Extension storage is unavailable.');
      const marker = await host.storage.get(INIT_MARKER_KEY, STORAGE_OPTIONS);
      if (disposed) return;
      if (marker !== undefined) {
        initState = 'done';
        renderConfig();
        return;
      }
    } catch (error) {
      initState = 'failed';
      initMessage = {
        key: 'config.init.markerFailed',
        vars: { message: describeHostError(error) },
      };
      renderConfig();
      return;
    }

    if (config.present) {
      try {
        if (!host.storage) throw new Error('Extension storage is unavailable.');
        await host.storage.set(
          INIT_MARKER_KEY,
          { version: 1, at: new Date().toISOString() },
          STORAGE_OPTIONS,
        );
        initState = 'done';
      } catch (error) {
        // The marker is bookkeeping; a failure never rolls back an existing file.
        initState = 'done';
        initMessage = {
          key: 'config.init.markerFailed',
          vars: { message: describeHostError(error) },
        };
        renderConfig();
      }
      return;
    }

    // Unreadable or non-regular: never turn that into a create.
    if (config.validity !== 'missing') {
      initState = 'done';
      return;
    }

    const answer = await postJson('/config/create', { order: state.order });
    if (disposed) return;
    if (!answer.ok) {
      initState = 'failed';
      initMessage = {
        key: 'config.init.createFailed',
        vars: { message: answer.message },
      };
      renderConfig();
      return;
    }

    try {
      if (!host.storage) throw new Error('Extension storage is unavailable.');
      await host.storage.set(
        INIT_MARKER_KEY,
        { version: 1, at: new Date().toISOString() },
        STORAGE_OPTIONS,
      );
    } catch (error) {
      // The file exists now; say the marker was not remembered, do not retry.
      initMessage = {
        key: 'config.init.createdMarkerFailed',
        vars: { message: describeHostError(error) },
      };
    }
    initState = 'done';
    await loadConfig();
    if (!disposed) renderConfig();
  };

  /* -------------------------------------------------------------------------- */
  /* Rendering                                                                  */
  /* -------------------------------------------------------------------------- */

  const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));

  const localStamp = (): string => {
    const now = new Date();
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  };

  const supportedConfigLanguage = (language: string): boolean => {
    if (!registry) return true;
    return language === 'auto' || localeCodes().includes(language);
  };

  const configStatusKey = (config: ConfigReport | null): string => {
    if (!config) return 'config.status.checking';
    if (config.validity === 'missing') return 'config.status.missing';
    if (config.validity === 'unreadable') return 'config.status.unreadable';
    if (config.validity === 'invalid') return 'config.status.invalid';
    const setting =
      typeof config.language === 'string' && config.language !== '' ? config.language : 'auto';
    return supportedConfigLanguage(setting) ? 'config.status.valid' : 'config.status.invalid';
  };

  const configStatusTone = (key: string): string => {
    if (key === 'config.status.valid') return 'success';
    if (key === 'config.status.invalid') return 'error';
    if (key === 'config.status.unreadable') return 'warning';
    return 'neutral';
  };

  const renderConfig = (): void => {
    const config = state.config;
    if (!config) {
      setText(configStatus, t('config.status.checking'));
      configStatus.dataset.tone = 'neutral';
      return;
    }

    setText(configPathValue, config.configPath);
    configPathValue.title = t('config.copy');
    setText(
      endpointValue,
      `${config.baseUrl}${t(config.loopback ? 'config.endpoint.loopback' : 'config.endpoint.remote')}`,
    );
    endpointValue.title = config.baseUrl;
    setText(keyValue, t(config.apiKeyConfigured ? 'config.configured' : 'config.notConfigured'));
    setText(refreshValue, t('config.everySeconds', { seconds: config.refreshSeconds }));
    const fontScale = typeof config.fontScale === 'number' ? config.fontScale : DEFAULT_FONT_SCALE;
    setText(fontScaleValue, `${fontScale}%`);
    setMessage(
      configFontScale,
      config.fontScaleInvalid ? t('config.fontScale.invalid', { path: config.configPath }) : null,
    );
    applyFontScale(fontScale);
    setText(
      subtitle,
      t(config.loopback ? 'usage.endpoint.loopback' : 'usage.endpoint.remote', { host: config.host }),
    );

    const statusKey = configStatusKey(config);
    setText(configStatus, t(statusKey));
    configStatus.dataset.tone = configStatusTone(statusKey);

    const issues = Array.isArray(config.issues)
      ? config.issues.filter(
          (issue) => isRecord(issue) && typeof issue.message === 'string' && issue.message !== '',
        )
      : [];
    // `fontScale` and non-string `language` already have localized notices
    // below; do not print the service's English sentence a second time.
    const messages = issues
      .filter((issue) => {
        if (issue.field === 'fontScale' && config.fontScaleInvalid) return false;
        if (issue.field === 'language' && config.languageInvalid) return false;
        return true;
      })
      .map((issue) => issue.message);
    const issueText =
      messages.length > 0
        ? `${messages.join(' ')}${config.issue ? ` ${t('config.fatalNote')}` : ''}`
        : (config.issue?.message ?? null);
    setMessage(configIssue, issueText);

    clear(configRecovery);
    const recovery = config.recovery;
    if (recovery) {
      configRecovery.hidden = false;
      configRecovery.append(
        el('p', 'note', t('config.recovery', { path: config.configPath, at: recovery.at })),
      );
      const restored = Array.isArray(recovery.restored) ? recovery.restored : [];
      const defaulted = Array.isArray(recovery.defaulted) ? recovery.defaulted : [];
      if (restored.length > 0) {
        configRecovery.append(
          el('p', 'note', t('config.recovery.restored', { fields: restored.join(', ') })),
        );
      }
      if (defaulted.length > 0) {
        configRecovery.append(
          el('p', 'note', t('config.recovery.defaulted', { fields: defaulted.join(', ') })),
        );
      }
      if (restored.length === 0 && defaulted.length === 0) {
        configRecovery.append(el('p', 'note', t('config.recovery.none')));
      }
    } else {
      configRecovery.hidden = true;
    }

    const setting = typeof config.language === 'string' && config.language !== '' ? config.language : 'auto';
    const resolved = registry ? resolveLocale(setting, hostLocale, localeCodes()) : null;
    const languageNotice = config.languageInvalid
      ? t('config.language.invalid', { path: config.configPath })
      : resolved?.unsupported
        ? t('config.language.unsupported', { language: setting, path: config.configPath })
        : null;
    setMessage(configLanguage, languageNotice);

    setMessage(
      configNote,
      config.validity === 'missing' ? t('config.missing', { path: config.configPath }) : null,
    );
    setMessage(configInit, initMessage ? t(initMessage.key, initMessage.vars) : null);

    const missing = config.validity === 'missing';
    configCreate.hidden = !missing;
    if (missing) {
      setText(configCreateQuestion, t('config.create.confirm', { path: config.configPath }));
      configCreateButton.disabled = creatingConfig || initState === 'running';
      configCreateYes.disabled = creatingConfig || initState === 'running';
    }

    schedule(config.refreshSeconds);
  };

  const renderUsageError = (message: string): void => {
    setMessage(banner, message);
    for (const kpi of [kpiTokens, kpiCache, kpiCalls, kpiCost, kpiCredits]) {
      setText(kpi.value, '—');
      setText(kpi.sub, '');
    }
    clear(chart);
    setText(sinceLine, t('usage.empty'));
    setText(usageStamp, '—');
    setBadge('badge.error', 'error');
  };

  const renderUsage = (): void => {
    const usage = state.usage;
    if (!usage) return;

    setMessage(banner, null);
    const totals = usage.totals;

    setText(kpiTokens.value, formatCompact(totals.input + totals.output));
    setText(
      kpiTokens.sub,
      t('usage.tokensSub', { input: formatCompact(totals.input), output: formatCompact(totals.output) }),
    );

    const hit = cacheHitRate(totals.input, totals.cacheRead, totals.cacheWrite);
    // A zero denominator hides the rate rather than printing 0% or NaN.
    setText(kpiCache.value, hit === null ? '—' : formatPercent(hit));
    setText(
      kpiCache.sub,
      hit === null ? t('usage.cacheNone') : t('usage.cacheRead', { value: formatCompact(totals.cacheRead) }),
    );

    setText(kpiCalls.value, formatInt(totals.calls));
    setText(
      kpiCalls.sub,
      t('usage.callsSub', { failed: formatInt(totals.errors), retried: formatInt(totals.retried) }) +
        (totals.loops > 0 ? t('usage.loops', { loops: formatInt(totals.loops) }) : ''),
    );

    setText(kpiCost.value, formatCost(totals.cost));
    setText(
      kpiCost.sub,
      totals.unpriced > 0
        ? t('usage.costUnpriced', { count: totals.unpriced })
        : t('usage.costAllPriced'),
    );

    setText(kpiCredits.value, formatCredits(totals.credits));
    setText(
      kpiCredits.sub,
      totals.credited > 0 ? t('usage.creditsReported', { count: totals.credited }) : t('usage.creditsNone'),
    );

    setText(
      sinceLine,
      usage.since ? t('usage.since', { when: formatWhen(usage.since) }) : t('usage.sinceUnknown'),
    );
    const stampPeriod = isPeriod(usage.period) ? usage.period : state.period;
    setText(usageStamp, `${t(`period.${stampPeriod}`)} · ${localStamp()}`);

    if (!state.config) {
      setText(
        subtitle,
        t(usage.loopback ? 'usage.endpoint.loopback' : 'usage.endpoint.remote', { host: usage.host }),
      );
    }

    renderChart(usage.series, isPeriod(usage.period) ? usage.period : state.period);

    setText(
      footer,
      t('usage.footer', { target: usage.loopback ? t('usage.target.this') : usage.host }),
    );

    setBadge('badge.ready', 'success');
  };

  /** How many labels the chart row shows for a period: 7 for 30 days, 6 for 24 hours. */
  const chartLabelCount = (period: Period): number => (period === 'today' ? 6 : 7);

  /**
   * Indices of the buckets that get a label, `count` of them. The first and last bucket
   * are always picked; the rest are spread evenly between, so a label lands on a real bar.
   */
  const pickLabelIndices = (length: number, count: number): number[] => {
    if (length <= 1) return [0];
    const target = Math.min(count, length);
    const picked: number[] = [];
    for (let slot = 0; slot < target; slot += 1) {
      picked.push(Math.round((slot * (length - 1)) / (target - 1)));
    }
    return [...new Set(picked)];
  };

  /**
   * Text for one bucket's label. 24 hours uses the hour from the upstream label (`00`–`23`).
   * 30 days uses `MM-DD` taken from the bucket's own date (the first 10 characters of `time`,
   * which the upstream writes in the gateway's zone), so it matches the day the bar covers.
   */
  const chartLabelText = (bucket: UsageBucket, period: Period): string => {
    if (period === 'today') return bucket.label;
    const match = bucket.time ? /^\d{4}-(\d{2})-(\d{2})/.exec(bucket.time) : null;
    return match ? `${match[1]}-${match[2]}` : bucket.label;
  };

  const renderChart = (series: UsageBucket[], period: Period): void => {
    clear(chart);

    if (series.length === 0) {
      chart.append(el('p', 'note', t('usage.noBuckets')));
      return;
    }

    const peak = Math.max(
      1,
      ...series.map((bucket) => bucket.input + bucket.cacheRead + bucket.cacheWrite + bucket.output),
    );
    const bars = el('div', 'bars');
    series.forEach((bucket) => {
      const inTokens = bucket.input + bucket.cacheRead + bucket.cacheWrite;
      const column = el('div', 'bar');
      const track = el('div', 'bar-track');
      const input = el('div', 'bar-seg bar-in');
      const output = el('div', 'bar-seg bar-out');
      input.style.height = `${Math.min(100, (inTokens / peak) * 100)}%`;
      output.style.height = `${Math.min(100, (bucket.output / peak) * 100)}%`;
      track.append(input, output);
      column.append(track);
      column.title = t('usage.barTitle', {
        label: bucket.label,
        input: formatCompact(inTokens),
        output: formatCompact(bucket.output),
        calls: formatInt(bucket.calls),
        count: bucket.calls,
      });
      bars.append(column);
    });
    chart.append(bars);

    // One label cell per bar, so the label grid shares the bars' geometry. Only the picked
    // buckets carry text: the first is pinned to its bar's left edge, the last to its right
    // edge, and the rest are centred under their bar.
    const count = chartLabelCount(period);
    const indices = pickLabelIndices(series.length, count);
    const slotOf = new Map<number, { edge: 'start' | 'middle' | 'end' }>();
    indices.forEach((index, slot) => {
      const edge = slot === 0 ? 'start' : slot === indices.length - 1 ? 'end' : 'middle';
      slotOf.set(index, { edge });
    });
    const row = el('div', 'bar-labels');
    series.forEach((bucket, index) => {
      const cell = el('div', 'bar-cell');
      const hit = slotOf.get(index);
      if (hit) cell.append(el('span', `bar-label bar-label-${hit.edge}`, chartLabelText(bucket, period)));
      row.append(cell);
    });
    chart.append(row);
  };

  const renderQuotaError = (message: string): void => {
    state.quotas = null;
    clear(quotaList);
    const node = el('section', 'quo-card quo-error');
    const head = el('div', 'quo-head');
    head.append(el('span', 'quo-name', t('quotas.unavailable')));
    node.append(head, el('p', 'quota-err', message));
    quotaList.append(node);
    setText(quotaStamp, '—');
  };

  const cardFoot = (card: QuotaCard): string => {
    const parts: string[] = [];
    if (card.readAt) parts.push(t('quota.read', { relative: relativeText(card.readAt) }));
    if (card.from) parts.push(t('quota.from', { source: card.from }));
    return parts.join(' · ');
  };

  const appendLine = (node: HTMLElement, text: string | null): void => {
    if (!text) return;
    node.append(el('div', 'q-line', text));
  };

  /* -------------------------------------------------------------------------- */
  /* Quota cards                                                                */
  /* -------------------------------------------------------------------------- */

  /** Logo in the header: a colour mark as an image, a single-colour one as a mask. */
  const logoNode = (card: QuotaCard): HTMLElement => {
    const entry: LogoEntry = LOGOS[logoFor(card.provider)];
    // An isolated SVG document: two cards' gradient and clip ids cannot collide.
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(entry.svg)}`;
    if (entry.color) {
      const image = el('img', 'quo-mark');
      image.src = uri;
      image.alt = '';
      image.draggable = false;
      return image;
    }
    const mask = el('span', 'quo-mask');
    // Paint the SVG as a mask, so the mark takes the theme's colour.
    const paint = `url("${uri}") center / contain no-repeat`;
    mask.style.setProperty('mask', paint);
    mask.style.setProperty('-webkit-mask', paint);
    return mask;
  };

  /** What a collapsed card shows on its right: plan, then the tightest figure. */
  const summaryFigure = (card: QuotaCard, balance: BalancePart[]): string => {
    if (card.windows.length === 0) return balance[0]?.value ?? t('quota.summary.balance');
    if (card.windows.every((window) => window.unlimited)) return t('quota.summary.unlimited');
    const left = tightestLeftPercent(card);
    if (left === null) return t('quota.summary.windows', { count: card.windows.length });
    return t('quota.summary.left', { percent: formatPercent(left / 100) });
  };

  const renderPoolWindow = (window: QuotaWindow, pool: string): HTMLElement => {
    const node = el('div', 'q-win');

    const head = el('div', 'q-win-head');
    const name = window.name ?? t('quota.window');
    // The pool name is already the row's label; do not repeat it in every cell.
    const short = pool !== '' && name.startsWith(`${pool} · `) ? name.slice(pool.length + 3) : name;
    head.append(el('span', 'q-win-name', short));

    const left = quotaLeftPercent(window);
    if (window.unlimited) head.append(el('span', 'q-win-fig', t('quota.unlimited')));
    else if (left !== null) {
      head.append(el('span', 'q-win-fig', t('quota.left', { percent: formatPercent(left / 100) })));
    }
    node.append(head);

    if (!window.unlimited) {
      const track = el('div', 'q-track');
      const fill = el('div', 'q-fill');
      // The bar fills to what is left, not to what is spent.
      fill.style.width = `${left ?? 0}%`;
      if (left !== null && left <= 0.5) fill.dataset.low = 'true';
      track.append(fill);
      node.append(track);
    }

    appendLine(
      node,
      remainingAmountLine(window, (amount, unit) => t('quota.remaining', { amount, unit })),
    );
    if (window.resetsAt) {
      appendLine(
        node,
        t('quota.resets', { relative: relativeText(window.resetsAt), when: formatWhen(window.resetsAt) }),
      );
    }
    if (window.runsOutAt) {
      const leftText =
        window.runsOut === null
          ? ''
          : t('quota.leftAmount', {
              amount: formatCredits(window.runsOut),
              unit: window.unit ? ` ${window.unit}` : '',
            });
      appendLine(
        node,
        t('quota.runsOut', {
          relative: relativeText(window.runsOutAt),
          when: formatWhen(window.runsOutAt),
          left: leftText,
        }),
      );
    }
    if (window.pool) appendLine(node, t('quota.pool', { name: window.pool }));

    return node;
  };

  const renderCardBody = (card: QuotaCard): HTMLElement => {
    const body = el('div', 'quo-body');

    if (card.windows.length === 0) {
      const balance = balanceParts(card.balance);
      if (balance.length === 0) {
        body.append(el('p', 'note', t('quota.emptyBody')));
      } else {
        const rows = el('div', 'q-bals');
        for (const part of balance) {
          const row = el('div', 'q-bal');
          if (part.label === null) row.dataset.whole = 'true';
          else row.append(el('span', 'q-bal-label', part.label));
          row.append(el('span', 'q-bal-value', part.value));
          rows.append(row);
        }
        body.append(rows);
      }
    } else {
      // One row per pool, two windows per row, tiers dropped.
      for (const row of groupWindows(card)) {
        const grid = el('div', 'q-pool');
        const lone = row.windows.length === 1 && row.windows[0]?.name === row.pool;
        if (row.pool !== '' && !lone) grid.append(el('div', 'q-pool-name', row.pool));
        for (const window of row.windows) grid.append(renderPoolWindow(window, row.pool));
        body.append(grid);
      }
    }

    const foot = cardFoot(card);
    if (foot) body.append(el('div', 'quo-foot', foot));
    return body;
  };

  /** Card body ids, unique per render so `aria-controls` always resolves. */
  let bodySeq = 0;

  const buildQuotaCard = (entry: OrderedCard): HTMLElement => {
    const { card, key } = entry;
    const cardName = card.name !== '' ? card.name : t('quota.unnamed');
    const node = el('section', 'quo-card');
    node.dataset.key = key;
    const collapsible = card.error === null;
    if (card.error) node.classList.add('quo-error');
    else if (card.windows.length === 0) node.classList.add('quo-balance');

    const head = el('div', 'quo-head');
    const handle = el('button', 'quo-logo');
    handle.type = 'button';
    handle.setAttribute('aria-label', t('quota.dragLabel', { name: cardName }));
    handle.append(logoNode(card));

    if (!collapsible) {
      head.append(handle, el('span', 'quo-name', cardName));
      node.append(head, el('p', 'quota-err', card.error ?? ''));
      const foot = cardFoot(card);
      if (foot) node.append(el('div', 'quo-foot', foot));
      bindDrag(handle, key, cardName);
      return node;
    }

    const balance = balanceParts(card.balance);
    const body = renderCardBody(card);
    bodySeq += 1;
    body.id = `quo-body-${bodySeq}`;

    const open = state.openCards.has(key);
    const summary = el('button', 'quo-summary');
    summary.type = 'button';
    summary.setAttribute('aria-controls', body.id);
    summary.append(el('span', 'quo-name', cardName));
    if (card.plan) summary.append(el('span', 'quo-plan', card.plan));
    summary.append(el('span', 'quo-fig', summaryFigure(card, balance)));
    const chevron = el('span', 'quo-chev');
    summary.append(chevron);

    const applyOpen = (next: boolean): void => {
      node.dataset.open = next ? 'true' : 'false';
      body.hidden = !next;
      summary.setAttribute('aria-expanded', next ? 'true' : 'false');
      chevron.textContent = next ? '▾' : '▸';
    };
    applyOpen(open);

    summary.addEventListener('click', () => {
      const next = !state.openCards.has(key);
      if (next) state.openCards.add(key);
      else state.openCards.delete(key);
      applyOpen(next);
    });

    head.append(handle, summary);
    node.append(head, body);
    bindDrag(handle, key, cardName);
    return node;
  };

  /* -------------------------------------------------------------------------- */
  /* Card order                                                                 */
  /* -------------------------------------------------------------------------- */

  const updateOrderNote = (): void => {
    setMessage(quotaOrderNote, state.orderError === null ? null : t('quota.orderNotSaved'));
    quotaOrderNote.title = state.orderError ?? '';
  };

  const cardNodes = (): HTMLElement[] =>
    Array.from(quotaList.querySelectorAll<HTMLElement>('.quo-card[data-key]'));

  const domOrder = (): string[] =>
    cardNodes()
      .map((node) => node.dataset.key ?? '')
      .filter((key) => key !== '');

  /**
   * Saves the order the panel now shows. The in-memory order is kept even when
   * the write fails, so a failed save does not snap the list back; the next drop
   * retries. The panel never blocks on this.
   */
  const commitOrder = async (order: string[]): Promise<void> => {
    state.order = order;
    const answer = await postJson('/config/order', { order });
    if (disposed) return;
    if (!answer.ok) {
      state.orderError = answer.message;
      updateOrderNote();
      return;
    }
    const value = answer.value;
    if (isRecord(value) && Array.isArray(value.order)) {
      state.order = value.order.filter((entry): entry is string => typeof entry === 'string');
    }
    state.orderError = null;
    updateOrderNote();
    // A save that had to replace a broken file carries the notice; read /config
    // now so the Configuration card says so without waiting for the next cycle.
    if (isRecord(value) && value.recovery !== null && value.recovery !== undefined) void loadConfig();
  };

  type DragState = {
    key: string;
    node: HTMLElement;
    pointerId: number;
    startY: number;
    moved: boolean;
  };

  let drag: DragState | null = null;

  /** Moves the dragged card to the pointer's row. */
  const dragTo = (y: number): void => {
    const dragged = drag?.node;
    if (!dragged) return;
    for (const other of cardNodes()) {
      if (other === dragged) continue;
      const box = other.getBoundingClientRect();
      if (y < box.top + box.height / 2) {
        quotaList.insertBefore(dragged, other);
        return;
      }
    }
    quotaList.append(dragged);
  };

  const announce = (text: string): void => {
    setText(quotaLive, text);
  };

  const moveCard = (key: string, name: string, target: number): void => {
    const nodes = cardNodes();
    const index = nodes.findIndex((node) => node.dataset.key === key);
    if (index === -1) return;
    const clamped = Math.max(0, Math.min(nodes.length - 1, target));
    if (clamped === index) return;
    const node = nodes[index];
    if (!node) return;
    const anchor = nodes[clamped];
    if (!anchor) return;
    if (clamped < index) quotaList.insertBefore(node, anchor);
    else quotaList.insertBefore(node, anchor.nextSibling);
    state.order = domOrder();
    announce(t('quota.moved', { name, position: clamped + 1, total: nodes.length }));
    void commitOrder(state.order);
  };

  const bindDrag = (handle: HTMLButtonElement, key: string, name: string): void => {
    // Window listeners rather than pointer capture: reordering moves the card
    // (the handle's ancestor) with `insertBefore`, and Chromium drops a capture
    // held inside a node it detaches, mid-gesture. Capture was measured losing
    // the pointer on the first reorder, which also froze `state.dragging`.
    let onMove: ((event: PointerEvent) => void) | null = null;
    let onStop: (() => void) | null = null;

    const stop = (): void => {
      if (onMove) window.removeEventListener('pointermove', onMove, true);
      if (onStop) {
        window.removeEventListener('pointerup', onStop, true);
        window.removeEventListener('pointercancel', onStop, true);
        document.documentElement.removeEventListener('pointerleave', onStop);
      }
      onMove = null;
      onStop = null;
    };

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const node = handle.closest<HTMLElement>('.quo-card');
      if (!node) return;
      state.dragging = true;
      drag = { key, node, pointerId: event.pointerId, startY: event.clientY, moved: false };
      node.dataset.dragging = 'true';

      onMove = (move: PointerEvent) => {
        if (!drag || drag.pointerId !== move.pointerId) return;
        if (Math.abs(move.clientY - drag.startY) < 3) return;
        drag.moved = true;
        dragTo(move.clientY);
      };

      onStop = () => {
        const current = drag;
        stop();
        if (!current) return;
        drag = null;
        state.dragging = false;
        delete current.node.dataset.dragging;

        // A refresh during the drag was held back; paint once now that it is over.
        if (current.moved) void commitOrder(domOrder());
        if (state.quotas) renderQuotas();
      };

      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onStop, true);
      window.addEventListener('pointercancel', onStop, true);
      // Released outside the frame: drop the card where it stands.
      document.documentElement.addEventListener('pointerleave', onStop);
    });

    handle.addEventListener('keydown', (event) => {
      const nodes = cardNodes();
      const index = nodes.findIndex((node) => node.dataset.key === key);
      if (index === -1) return;
      let target: number;
      if (event.key === 'ArrowUp') target = index - 1;
      else if (event.key === 'ArrowDown') target = index + 1;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = nodes.length - 1;
      else return;
      event.preventDefault();
      moveCard(key, name, target);
    });
  };

  const renderQuotaStamp = (report: QuotaReport): void => {
    const cards = report.cards;
    const errors = cards.filter((card) => card.error !== null).length;
    const bits: string[] = [
      t(report.stale ? 'quotas.stamp.lastRead' : report.kept ? 'quotas.stamp.cached' : 'quotas.stamp.fresh'),
    ];
    if (report.throttled) bits.push(t('quotas.stamp.throttled'));
    bits.push(t('quotas.stamp.cards', { count: cards.length }));
    if (report.stale && report.asOf) bits.push(relativeText(report.asOf));
    if (errors > 0) bits.push(t('quotas.stamp.errors', { count: errors }));
    setText(quotaStamp, bits.join(' · '));
    updateOrderNote();
  };

  const renderQuotas = (): void => {
    const report = state.quotas;
    if (!report) return;
    // A card is being dragged: rebuilding the list would drop it mid-gesture.
    // The next paint happens on drop.
    if (state.dragging) return;

    clear(quotaList);
    const ordered = applyCardOrder(report.cards, state.order);

    if (ordered.length === 0) {
      quotaList.append(el('p', 'note', t('quotas.none')));
    } else {
      if (!state.openDefaulted) {
        state.openDefaulted = true;
        for (const entry of ordered.slice(0, OPEN_CARDS)) state.openCards.add(entry.key);
      }
      bodySeq = 0;
      for (const entry of ordered) quotaList.append(buildQuotaCard(entry));
    }

    renderQuotaStamp(report);
  };

  /* -------------------------------------------------------------------------- */
  /* Refresh loop                                                               */
  /* -------------------------------------------------------------------------- */

  let timer: number | undefined;
  let refreshSeconds = DEFAULT_REFRESH_SECONDS;

  const schedule = (seconds: number): void => {
    if (disposed) return;
    if (timer !== undefined && seconds === refreshSeconds) return;
    refreshSeconds = seconds;
    if (timer !== undefined) window.clearInterval(timer);
    timer = window.setInterval(() => {
      void cycle('auto');
    }, seconds * 1000);
  };

  const setBusy = (busy: boolean): void => {
    state.busy = busy;
    refreshButton.update({ loading: busy });
    for (const button of periodButtons.values()) button.disabled = busy;
  };

  type CycleMode = 'auto' | 'manual' | 'period';

  const cycle = async (mode: CycleMode): Promise<void> => {
    if (state.busy || disposed) return;
    setBusy(true);
    try {
      if (mode !== 'period') {
        await loadConfig();
        await initializeConfig();
      }
      await loadUsage();
      if (mode !== 'period') await loadQuotas(mode === 'manual');
    } finally {
      setBusy(false);
    }
  };

  const selectPeriod = (period: Period): void => {
    const changed = period !== state.period;
    state.period = period;
    for (const [value, button] of periodButtons) {
      button.setAttribute('aria-pressed', value === period ? 'true' : 'false');
    }
    if (changed) void cycle('period');
  };

  for (const [period, button] of periodButtons) {
    button.addEventListener('click', () => selectPeriod(period));
  }

  /* -------------------------------------------------------------------------- */
  /* Host wiring                                                                */
  /* -------------------------------------------------------------------------- */

  const toneForStatus = (status: ServiceStatus): 'neutral' | 'success' | 'warning' | 'error' => {
    if (status === 'ready') return 'success';
    if (status === 'failed') return 'error';
    if (status === 'starting') return 'warning';
    return 'neutral';
  };

  const refreshStatus = async (): Promise<void> => {
    try {
      const { status } = await host.serviceStatus();
      if (disposed) return;
      if (status !== 'ready') setBadge(`badge.${status}`, toneForStatus(status));
    } catch (error) {
      if (disposed) return;
      if (error instanceof HostRequestError && error.code === 'HOST_UNAVAILABLE') {
        setBadge('badge.outside', 'neutral');
        return;
      }
      setBadge('badge.unknown', 'neutral');
    }
  };

  applyStaticLabels();

  let started = false;

  const unsubscribeReady = host.onReady((context) => {
    if (disposed) return;
    // Theme and host facts are applied on every snapshot; the controls were
    // mounted once above, so a later snapshot only updates values.
    applyHostReady(context, document.documentElement);
    applyFontScale(state.config?.fontScale ?? DEFAULT_FONT_SCALE);
    hostLocale = context.locale;
    if (started) {
      if (state.config) renderConfig();
      void syncLocale();
      return;
    }
    started = true;
    void initializeLocales();
    schedule(refreshSeconds);
    void refreshStatus();
    void cycle('auto');
  });

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
      unsubscribeReady();
      badge.dispose();
      refreshButton.dispose();
    },
  };
};
