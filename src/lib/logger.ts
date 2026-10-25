type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function sanitize(fields: Fields) {
  const copy: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (/password|secret|token|cookie|authorization/i.test(key)) continue;
    copy[key] = value instanceof Error ? { name: value.name, message: value.message } : value;
  }
  return copy;
}

export function logEvent(level: Level, event: string, fields: Fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...sanitize(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logInfo = (event: string, fields?: Fields) => logEvent("info", event, fields);
export const logWarn = (event: string, fields?: Fields) => logEvent("warn", event, fields);
export const logError = (event: string, fields?: Fields) => logEvent("error", event, fields);
