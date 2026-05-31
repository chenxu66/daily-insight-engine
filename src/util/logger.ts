type LogLevel = "debug" | "info" | "warn" | "error";

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function currentLevel(): LogLevel {
  const env = process.env["LOG_LEVEL"];
  if (env && env in levels) return env as LogLevel;
  return "info";
}

function format(stage: string, level: LogLevel, message: string, data?: unknown): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] [${stage}] ${message}`;
  if (data !== undefined) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function createLogger(stage: string): Logger {
  function log(level: LogLevel, message: string, data?: unknown): void {
    if (levels[level] < levels[currentLevel()]) return;
    const line = format(stage, level, message, data);
    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
  };
}
