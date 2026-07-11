export type SimulatorMode = 'connect' | 'check' | 'dry-run';

export function parseMode(args: readonly string[]): SimulatorMode {
  if (args.includes('--dry-run')) return 'dry-run';
  if (args.includes('--check')) return 'check';
  return 'connect';
}
