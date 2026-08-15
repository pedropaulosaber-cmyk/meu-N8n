import pino from 'pino';

export interface Logger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(level: string): Logger {
  const base = pino({
    level,
    // Rede de segurança em cima do mascarador do motor: mesmo que algo
    // escape do maskSensitive, estes caminhos nunca chegam ao log.
    redact: {
      paths: [
        'credentials',
        '*.credentials',
        'apiKey',
        '*.apiKey',
        'authorization',
        '*.authorization',
      ],
      remove: true,
    },
  });

  const wrap = (instance: pino.Logger): Logger => ({
    debug: (obj, msg) => instance.debug(obj as object, msg),
    info: (obj, msg) => instance.info(obj as object, msg),
    warn: (obj, msg) => instance.warn(obj as object, msg),
    error: (obj, msg) => instance.error(obj as object, msg),
    child: (bindings) => wrap(instance.child(bindings)),
  });

  return wrap(base);
}
