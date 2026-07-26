/**
 * Structured logger — standalone port of the host platform's logger.
 *
 * Same call shape (`logger.info(msg, fields)`), JSON lines to stdout so a
 * container log driver can parse it.
 */

type Fields = Record<string, unknown>;

function emit(level: string, msg: string, fields?: Fields): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: Fields) => emit("debug", msg, fields),
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};
