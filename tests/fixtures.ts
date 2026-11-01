// Payloads shaped like the live gateway, trimmed to what the tests assert.

export const usagePayload = {
  period: '7d',
  since: '2026-10-26T00:00:00+08:00',
  calls: 6274,
  errors: 50,
  retried: 12,
  loops: 0,
  input: 16_184_969,
  output: 2_622_360,
  cache_read: 607_959_073,
  cache_write: 0,
  reasoning: 12_345,
  cost: 53.2038,
  unpriced: 7,
  credits: 1326.22,
  credited: 410,
  bucket: 'day',
  series: [
    {
      label: '10-30',
      time: '2026-10-30T00:00:00+08:00',
      calls: 10,
      input: 1000,
      output: 200,
      cache_read: 5000,
      cache_write: 0,
      cost: 0.5,
      unpriced: 0,
    },
    {
      label: '10-31',
      time: '2026-10-31T00:00:00+08:00',
      calls: 20,
      input: 2000,
      output: 300,
      cache_read: 9000,
      cache_write: 0,
      cost: 1.5,
      unpriced: 1,
    },
    {
      label: '11-01',
      time: '2026-11-01T00:00:00+08:00',
      calls: 5,
      input: 100,
      output: 50,
      cache_read: 0,
      cache_write: 0,
      cost: 0,
      unpriced: 0,
    },
  ],
};

export const quotaPayload = {
  object: 'list',
  data: [
    {
      provider: 'r-magpie/workbuddy',
      name: 'WorkBuddy · Remote magpie',
      kind: 'subscription',
      plan: 'Free plan',
      user: 'Lilixxs',
      readAt: '2026-11-01T05:20:37.352Z',
      from: 'Remote magpie',
      windows: [
        {
          name: 'Credits',
          used: 19.323136488673764,
          remaining: 80.67686351132623,
          display: '998.04 / 5165',
          amount: 998.04,
          limit: 5165,
          unit: 'credits',
          resetsAt: '2026-11-30T15:59:59Z',
          runsOutAt: '2026-11-16T04:00:14Z',
          runsOut: 66.96,
          pool: 'Claude & GPT',
        },
      ],
    },
    {
      provider: 'r-magpie/deepseek',
      name: 'DeepSeek · Remote magpie',
      kind: 'balance',
      windows: [],
      balance: '¥21.08',
      readAt: '2026-11-01T03:00:23.024Z',
      from: 'Remote magpie',
    },
    {
      provider: 'r-magpie/openrouter',
      name: 'OpenRouter · Remote magpie',
      kind: 'balance',
      windows: [],
      error: '401 Unauthorized: user not found',
      from: 'Remote magpie',
    },
    {
      provider: 'r-magpie/opencode-go',
      name: 'OpenCode Go · Remote magpie',
      kind: 'plan',
      windows: [
        { name: '5 hours', used: 0, remaining: 100 },
        { name: '7 days', used: 5, remaining: 95, resetsAt: '2026-11-02T00:00:00Z' },
      ],
    },
    {
      provider: 'r-magpie/~keys',
      name: 'Remote magpie',
      kind: 'plan',
      user: 'sk-ma…22fc',
      windows: [{ unlimited: true, name: 'Limit', used: 0, remaining: 100 }],
      readAt: '2026-11-01T13:20:47.284+08:00',
      from: 'Remote magpie',
    },
    {
      provider: 'r-magpie/commandcode',
      name: 'Command Code · Remote magpie',
      kind: 'plan',
      plan: 'GOAT',
      windows: [{ name: 'Credits', amount: 18.64, limit: 70, unit: 'USD', display: '$18.64 / $70.00' }],
    },
    {
      provider: 'r-magpie/sparse',
      name: 'Sparse card',
      kind: 'plan',
      windows: [{}],
    },
  ],
};

/**
 * The Antigravity card as the live gateway reports it: three pools, each
 * duration window beside nine per-model tiers named `(High)`, `(Low)`,
 * `(Medium)`. Pool windows come after the tiers and out of duration order.
 */
export const antigravityCard = {
  provider: 'r-magpie/antigravity',
  name: 'Antigravity · Remote magpie',
  kind: 'subscription',
  plan: 'Google AI Pro',
  user: 'lilitju2018@gmail.com',
  readAt: '2026-11-01T03:43:16.613Z',
  from: 'Remote magpie',
  windows: [
    { name: 'Claude & GPT · Claude Opus 5.5 (High)', used: 0, remaining: 100, resetsAt: '2026-11-01T08:43:15Z', pool: 'Claude & GPT' },
    { name: 'Claude & GPT · Claude Opus 5.5 (Low)', used: 0, remaining: 100, resetsAt: '2026-11-01T08:43:15Z', pool: 'Claude & GPT' },
    { name: 'Claude & GPT · Claude Opus 5.5 (Medium)', used: 0, remaining: 100, resetsAt: '2026-11-01T08:43:15Z', pool: 'Claude & GPT' },
    { name: 'Gemini · Gemini 3.8 Flash (High)', used: 0, remaining: 100, resetsAt: '2026-11-01T08:43:15Z', pool: 'Gemini' },
    { name: 'Gemini · Gemini 3.8 Flash (Low)', used: 0, remaining: 100, resetsAt: '2026-11-01T08:43:15Z', pool: 'Gemini' },
    { name: 'Gemini · Gemini 3.8 Flash (Medium)', used: 0, remaining: 100, resetsAt: '2026-11-01T08:43:15Z', pool: 'Gemini' },
    { name: 'Gemini 4 Argon · Gemini 4 Argon (High)', used: 0.54247, remaining: 99.45753, resetsAt: '2026-11-06T14:17:12Z', pool: 'Gemini 4 Argon' },
    { name: 'Gemini 4 Argon · Gemini 4 Argon (Low)', used: 0.54247, remaining: 99.45753, resetsAt: '2026-11-06T14:17:12Z', pool: 'Gemini 4 Argon' },
    { name: 'Gemini 4 Argon · Gemini 4 Argon (Medium)', used: 0.54247, remaining: 99.45753, resetsAt: '2026-11-06T14:17:12Z', pool: 'Gemini 4 Argon' },
    { name: 'Gemini · 7 days', used: 10.095316, remaining: 89.904684, resetsAt: '2026-11-02T06:10:25Z', pool: 'Gemini' },
    { name: 'Gemini · 5 hours', used: 0, remaining: 100, resetsAt: '2026-11-01T08:43:16Z', pool: 'Gemini' },
    { name: 'Claude & GPT · 7 days', used: 0.0192, remaining: 99.9808, resetsAt: '2026-11-06T13:23:27Z', pool: 'Claude & GPT' },
    { name: 'Claude & GPT · 5 hours', used: 0, remaining: 100, resetsAt: '2026-11-01T08:43:16Z', pool: 'Claude & GPT' },
    { name: 'Gemini 4 Argon · 7 days', used: 0.54247, remaining: 99.45753, resetsAt: '2026-11-06T14:17:12Z', pool: 'Gemini 4 Argon' },
  ],
};

/** The two cards that share `r-magpie/commandcode`; only their kind tells them apart. */
export const commandCodeCards = [
  {
    provider: 'r-magpie/commandcode',
    name: 'Command Code · Remote magpie',
    kind: 'plan',
    plan: 'GOAT',
    windows: [
      { name: '5 hours', used: 0.33167358, remaining: 99.66832642, resetsAt: '2026-11-01T08:01:48.653Z' },
      { name: 'Weekly', used: 30.10798799, remaining: 69.89201201, resetsAt: '2026-11-06T05:22:40.936Z' },
      { name: 'Credits', used: 26.62372823, remaining: 73.37627177, resetsAt: '2026-11-12T14:13:14Z', display: '$18.64 / $70.00' },
    ],
    readAt: '2026-11-01T03:06:38.600Z',
    from: 'Remote magpie',
  },
  {
    provider: 'r-magpie/commandcode',
    name: 'Command Code · Remote magpie',
    kind: 'balance',
    windows: [],
    balance: '$51.41',
    readAt: '2026-11-01T03:00:23.797Z',
    from: 'Remote magpie',
  },
];

/** A summary that omits every optional field. */
export const sparseUsagePayload = {
  calls: 0,
  series: [],
};

/** Only what the quota decoder needs, with every optional window field absent. */
export const sparseQuotaPayload = {
  data: [{ provider: 'r-magpie/minimal', windows: [] }],
};
