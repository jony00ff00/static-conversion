/** Tiny --key=value argument parser shared by the scripts. */
export function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, ...v] = a.slice(2).split('=');
      flags[k!] = v.length ? v.join('=') : true;
    } else positional.push(a);
  }
  return { positional, flags };
}

/** "20,15,20,15" (top,right,bottom,left) or "18" (all sides). */
export function parseMargins(v: string | true | undefined) {
  if (typeof v !== 'string') return undefined;
  const n = v.split(',').map(Number);
  if (n.some((x) => !Number.isFinite(x))) throw new Error(`Bad --margins: ${v}`);
  if (n.length === 1) return { top: n[0]!, right: n[0]!, bottom: n[0]!, left: n[0]! };
  if (n.length === 4) return { top: n[0]!, right: n[1]!, bottom: n[2]!, left: n[3]! };
  throw new Error('--margins takes 1 or 4 values in mm: top,right,bottom,left');
}
