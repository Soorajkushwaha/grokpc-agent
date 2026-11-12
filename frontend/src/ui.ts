export const CHANNEL_PALETTE = [
  { bg: 'bg-cyan-500/15', text: 'text-cyan-300', ring: 'ring-cyan-400/80', dot: 'bg-cyan-400', solid: 'bg-gradient-to-br from-cyan-500 to-sky-600' },
  { bg: 'bg-violet-500/15', text: 'text-violet-300', ring: 'ring-violet-400/80', dot: 'bg-violet-400', solid: 'bg-gradient-to-br from-violet-500 to-indigo-600' },
  { bg: 'bg-rose-500/15', text: 'text-rose-300', ring: 'ring-rose-400/80', dot: 'bg-rose-400', solid: 'bg-gradient-to-br from-rose-500 to-pink-600' },
  { bg: 'bg-amber-500/15', text: 'text-amber-300', ring: 'ring-amber-400/80', dot: 'bg-amber-400', solid: 'bg-gradient-to-br from-amber-500 to-orange-600' },
  { bg: 'bg-emerald-500/15', text: 'text-emerald-300', ring: 'ring-emerald-400/80', dot: 'bg-emerald-400', solid: 'bg-gradient-to-br from-emerald-500 to-teal-600' },
  { bg: 'bg-sky-500/15', text: 'text-sky-300', ring: 'ring-sky-400/80', dot: 'bg-sky-400', solid: 'bg-gradient-to-br from-sky-500 to-blue-600' },
] as const;

export function channelTheme(id: string) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n += id.charCodeAt(i);
  return CHANNEL_PALETTE[n % CHANNEL_PALETTE.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.trim().slice(0, 2) || '?').toUpperCase();
}

export function relativeTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const m = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (m < 1) return 'abhi';
  if (m < 60) return `${m} min pehle`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h pehle`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'kal';
  return `${d} din pehle`;
}
