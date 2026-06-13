export function statusStyles(status: string): string {
  if (status === 'completed') return 'bg-green-500/10 text-green-400 border-green-500/20';
  if (status === 'failed' || status === 'cancelled') return 'bg-red-500/10 text-red-400 border-red-500/20';
  return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
}
