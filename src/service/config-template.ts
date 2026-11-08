/**
 * The one canonical config template. It is used for a new file, for the
 * panel's explicit create button, and for rebuilding a structurally damaged
 * file. Existing valid files are never rewritten into this shape.
 */
import type {
  ConfigRecoveryResult,
  ConfigRecoveryValues,
} from '../shared/config-document.ts';
import { DEFAULT_PROVIDER_ICONS, type ConfigRecovery } from '../shared/magpie.ts';

export type TemplateValues = {
  baseUrl: string;
  apiKey: string | null;
  refreshSeconds: number;
  fontScale: number;
  language: string;
  providerIcons: Record<string, string>;
};

export const TEMPLATE_DEFAULTS: TemplateValues = {
  baseUrl: 'http://127.0.0.1:3425',
  apiKey: null,
  refreshSeconds: 60,
  fontScale: 100,
  language: 'auto',
  providerIcons: { ...DEFAULT_PROVIDER_ICONS },
};

const orderBlock = (order: string[]): string =>
  JSON.stringify(order, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n');

/**
 * Seven active settings plus fixed bilingual comments. Examples are comments,
 * so a fictional key or order can never become an active value.
 */
export const renderConfigTemplate = (
  order: string[] = [],
  values: TemplateValues = TEMPLATE_DEFAULTS,
): string => {
  const key = values.apiKey === null ? 'null' : JSON.stringify(values.apiKey);
  return [
    '{',
    '  // baseUrl: absolute http(s) URL of the magpie gateway. Plain http is accepted only for a loopback host.',
    '  // baseUrl：magpie 网关的绝对 http(s) URL；仅环回地址允许使用明文 http。',
    `  "baseUrl": ${JSON.stringify(values.baseUrl)},`,
    '',
    '  // apiKey: the gateway key. Only the local service reads it; the panel never displays it.',
    '  // apiKey：网关密钥。只由本地服务读取，面板不会显示。',
    '  // Example / 示例: "apiKey": "replace-with-your-gateway-key"',
    `  "apiKey": ${key},`,
    '',
    '  // refreshSeconds: integer from 5 to 3600.',
    '  // refreshSeconds：5 到 3600 的整数。',
    `  "refreshSeconds": ${values.refreshSeconds},`,
    '',
    "  // fontScale: integer from 50 to 200, the panel's type scale in percent.",
    '  // fontScale：50 到 200 的整数，面板字号百分比。',
    `  "fontScale": ${values.fontScale},`,
    '',
    "  // cardOrder is managed by the panel's drag and keyboard reordering. The whole array",
    '  // is replaced on save, so comments inside the array may be dropped.',
    '  // cardOrder 由面板拖拽与键盘排序管理；保存时整个数组会被替换，数组内注释可能丢失。',
    `  "cardOrder": ${orderBlock(order)},`,
    '',
    '  // language: "auto", "en", or "zh-CN".',
    '  // language："auto"、"en" 或 "zh-CN"。',
    `  "language": ${JSON.stringify(values.language)},`,
    '',
    '  // providerIcons: map a provider (the last segment of its name) to a bundled icon name.',
    '  // Unknown names are silently ignored; the normal generated, file-name, or generic fallback still applies.',
    '  // providerIcons：把供应商（取名称末段）映射到面板内置的图标名；未知名称会被静默忽略，仍按既有的生成图标、文件名、通用图标顺序回退。',
    '  // At most 200 entries; each key and each value is at most 80 characters.',
    '  // 最多 200 项；每个键与值各不超过 80 个字符。',
    `  "providerIcons": ${JSON.stringify(values.providerIcons)}`,
    '}',
    '',
  ].join('\n');
};

/**
 * Every line of the old text becomes a line comment. Line comments are used
 * instead of a block comment because the old text may itself contain a block
 * comment terminator.
 */
export const commentPreviousText = (text: string): string => {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => (line === '' ? '//' : `// ${line}`)).join('\n');
};

/**
 * A rebuilt file starts with the full template and the submitted order, then
 * keeps the previous text as comments. No separate `.bak` file is created.
 */
export const renderRebuiltConfig = (
  previousText: string,
  order: string[],
  values: ConfigRecoveryValues,
  at: string,
): string => {
  const active = renderConfigTemplate(order, values);
  const marker = [
    '// --- Previous config text, kept as comments / 旧配置原文（保留为注释）---',
    `// Rebuilt on ${at} after a syntax, duplicate-key, or root-shape error.`,
    `// 因语法、重复键或根结构错误，已于 ${at} 重建。`,
    '// The active settings above are the template defaults plus any field that could be',
    '// proved complete in the old text; everything else fell back to its default.',
    '// 上方生效值是模板默认值加上旧文中可证明完整的字段；其余字段已回退默认。',
    '',
  ].join('\n');

  return `${active}\n${marker}${commentPreviousText(previousText)}\n`;
};

/** Builds the safe report kept in service memory. It never contains the text or key. */
export const recoveryReport = (
  at: string,
  recovered: ConfigRecoveryResult,
): ConfigRecovery => ({
  at,
  restored: recovered.restored,
  defaulted: recovered.defaulted,
  previousText: 'appended-comments',
});
