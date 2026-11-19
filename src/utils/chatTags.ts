export type ChatLeadTagId =
  | 'Lead Quente'
  | 'Financiamento'
  | 'Troca'
  | 'Agendar Visita'
  | 'Frio / Dúvida';

export interface ChatTagConfig {
  id: ChatLeadTagId;
  emoji: string;
  label: string;
  shortLabel: string;
  badgeClass: string;
  activeButtonClass: string;
  inactiveButtonClass: string;
}

export const CHAT_LEAD_TAGS: ChatTagConfig[] = [
  {
    id: 'Lead Quente',
    emoji: '🔥',
    label: '🔥 Lead Quente',
    shortLabel: 'Lead Quente',
    badgeClass:
      'bg-rose-500/15 text-rose-300 border border-rose-500/35',
    activeButtonClass:
      'bg-rose-600 text-white border-rose-500 shadow-xs shadow-rose-950/40',
    inactiveButtonClass:
      'bg-rose-500/10 text-rose-300 border-rose-500/25 hover:bg-rose-500/20 hover:border-rose-500/45',
  },
  {
    id: 'Financiamento',
    emoji: '💰',
    label: '💰 Financiamento',
    shortLabel: 'Financiamento',
    badgeClass:
      'bg-emerald-500/15 text-emerald-300 border border-emerald-500/35',
    activeButtonClass:
      'bg-emerald-600 text-white border-emerald-500 shadow-xs shadow-emerald-950/40',
    inactiveButtonClass:
      'bg-emerald-500/10 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/20 hover:border-emerald-500/45',
  },
  {
    id: 'Troca',
    emoji: '🔄',
    label: '🔄 Troca',
    shortLabel: 'Troca',
    badgeClass:
      'bg-sky-500/15 text-sky-300 border border-sky-500/35',
    activeButtonClass:
      'bg-sky-600 text-white border-sky-500 shadow-xs shadow-sky-950/40',
    inactiveButtonClass:
      'bg-sky-500/10 text-sky-300 border-sky-500/25 hover:bg-sky-500/20 hover:border-sky-500/45',
  },
  {
    id: 'Agendar Visita',
    emoji: '📅',
    label: '📅 Agendar Visita',
    shortLabel: 'Agendar Visita',
    badgeClass:
      'bg-amber-500/15 text-amber-300 border border-amber-500/35',
    activeButtonClass:
      'bg-amber-600 text-white border-amber-500 shadow-xs shadow-amber-950/40',
    inactiveButtonClass:
      'bg-amber-500/10 text-amber-300 border-amber-500/25 hover:bg-amber-500/20 hover:border-amber-500/45',
  },
  {
    id: 'Frio / Dúvida',
    emoji: '❄️',
    label: '❄️ Frio / Dúvida',
    shortLabel: 'Frio / Dúvida',
    badgeClass:
      'bg-zinc-500/15 text-zinc-300 border border-zinc-500/35',
    activeButtonClass:
      'bg-zinc-600 text-white border-zinc-400 shadow-xs',
    inactiveButtonClass:
      'bg-zinc-500/10 text-zinc-300 border-zinc-500/25 hover:bg-zinc-500/20 hover:border-zinc-500/45',
  },
];

export function getChatTagConfig(tag?: string | null): ChatTagConfig | null {
  if (!tag) return null;
  const clean = tag.trim();
  return CHAT_LEAD_TAGS.find((t) => t.id === clean) ?? null;
}

/**
 * Formats Brazilian phone numbers progressively as the user types:
 * - 10 digits: (00) 0000-0000
 * - 11 digits: (00) 00000-0000
 */
export function formatBrazilianPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}
