export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatKm(km: number): string {
  return `${new Intl.NumberFormat('pt-BR').format(km)} km`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}

export function formatWhatsAppLink(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, '');
  const full = digits.startsWith('55') ? digits : `55${digits}`;
  const query = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${full}${query}`;
}

export function formatTodayFullDate(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
}
