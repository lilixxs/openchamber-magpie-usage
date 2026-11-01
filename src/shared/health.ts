/** Contract shared by the panel and the local service. */
export const SERVICE_NAME = 'magpie-usage';
export const SERVICE_API_VERSION = 1;

export type Health = {
  ok: true;
  name: string;
  apiVersion: number;
};

/** Returns a Health object for a well-formed `/health` answer, otherwise null. */
export const readHealth = (body: string): Health | null => {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.name !== 'string' || typeof record.apiVersion !== 'number') {
    return null;
  }
  return { ok: true, name: record.name, apiVersion: record.apiVersion };
};
