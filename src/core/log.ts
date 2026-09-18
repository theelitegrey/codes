const start = Date.now();
function stamp(): string {
  return `[+${((Date.now() - start) / 1000).toFixed(1)}s]`;
}
export const log = {
  info: (msg: string, ...rest: unknown[]) => console.log(`${stamp()} ${msg}`, ...rest),
  warn: (msg: string, ...rest: unknown[]) => console.warn(`${stamp()} WARN ${msg}`, ...rest),
  error: (msg: string, ...rest: unknown[]) => console.error(`${stamp()} ERROR ${msg}`, ...rest),
  stage: (name: string) => console.log(`\n${stamp()} ══ ${name} ══`),
};
