import { ChatMessage, DealershipSettings, Vehicle } from '../types';

export type HandoffPurpose = 'sales' | 'financing' | 'visit' | 'tradein';

export interface WhatsAppDestination {
  purpose: HandoffPurpose;
  label: string;
  rawNumber: string;
  normalizedNumber: string;
  isConfigured: boolean;
}

export interface WhatsAppHandoffParams {
  storeWhatsappNumber: string;
  storeName?: string;
  leadName?: string | null;
  leadPhone?: string | null;
  includeContactData?: boolean;
  sessionId?: string | null;
  contextSummary?: string | null;
  vehicleLabel?: string | null;
  purpose?: HandoffPurpose;
  destinationLabel?: string | null;
  messages?: ChatMessage[];
  vehicles?: Vehicle[];
  existingSummary?: string | null;
}

export interface WhatsAppHandoffResult {
  url: string;
  text: string;
  shortRef: string;
  normalizedStorePhone: string;
  contextSummary: string;
  destinationLabel: string;
  purpose: HandoffPurpose;
}

/**
 * Resolves the active WhatsApp destination from the single centralized DealershipSettings.
 * Supports optional financing WhatsApp with clear department label, falling back cleanly
 * to the primary sales WhatsApp when financing is not separately configured.
 */
export function resolveWhatsAppDestination(
  settings: Partial<DealershipSettings> | null | undefined,
  purpose: HandoffPurpose = 'sales',
  fallbackWhatsapp?: string | null
): WhatsAppDestination {
  const salesRaw =
    (settings?.salesWhatsapp || '').trim() ||
    (settings?.whatsapp || '').trim() ||
    (fallbackWhatsapp || '').trim();
  const financingRaw = (settings?.financingWhatsapp || '').trim();

  if (purpose === 'financing' && financingRaw) {
    const normalized = normalizeStoreWhatsAppNumber(financingRaw);
    return {
      purpose: 'financing',
      label: (settings?.financingWhatsappLabel || 'Financeiro / Simulação').trim(),
      rawNumber: financingRaw,
      normalizedNumber: normalized,
      isConfigured: Boolean(normalized),
    };
  }

  const normalizedSales = normalizeStoreWhatsAppNumber(salesRaw);
  const baseLabel = (settings?.salesWhatsappLabel || 'Consultor de Vendas').trim();
  const purposeLabel =
    purpose === 'visit'
      ? `${baseLabel} (Solicitação de visita)`
      : purpose === 'tradein'
        ? `${baseLabel} (Pré-avaliação de troca)`
        : purpose === 'financing'
          ? `${baseLabel} (Simulação de financiamento)`
          : baseLabel;

  return {
    purpose,
    label: purposeLabel,
    rawNumber: salesRaw,
    normalizedNumber: normalizedSales,
    isConfigured: Boolean(normalizedSales),
  };
}

/**
 * Normalizes a Brazilian/international store WhatsApp number to pure digits with DDI.
 * Examples:
 * - "5551999999999" -> "5551999999999"
 * - "(51) 99999-9999" -> "5551999999999"
 * - "+55 11 99482-1040" -> "5511994821040"
 */
export function normalizeStoreWhatsAppNumber(raw: string | null | undefined): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits.slice(0, 15);
}

/**
 * Generates a short human-friendly reference code from the session_id so the
 * salesperson can immediately locate the full conversation in Admin -> Conversas IA.
 */
export function formatSessionShortId(sessionId?: string | null): string {
  const clean = (sessionId || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!clean) return 'ATEND';
  return clean.slice(-6);
}

function stripMarkdownLight(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikePhoneOnly(text: string): boolean {
  const digits = text.replace(/\D/g, '');
  const letters = text.replace(/[^a-zA-ZÀ-ÿ]/g, '');
  return digits.length >= 8 && letters.length <= 2;
}

function looksLikeShortNameOnly(text: string, leadName?: string | null): boolean {
  const cleanText = stripMarkdownLight(text).toLowerCase();
  const cleanLead = (leadName || '').trim().toLowerCase();
  if (!cleanText) return true;
  if (cleanLead && cleanText === cleanLead) return true;
  if (
    cleanLead &&
    cleanText.length <= cleanLead.length + 18 &&
    cleanText.includes(cleanLead) &&
    !/carro|suv|sedan|hatch|troca|financ|simul|visita|preço|preco|fipe|valor|estoque|parcel/i.test(
      cleanText
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Extracts a concise, accurate handoff topic from already-captured session data
 * (saved summary or recent client messages + inventory matching) with ZERO AI calls.
 */
export function extractHandoffContextFromMessages(
  messages: ChatMessage[] = [],
  vehicles: Vehicle[] = [],
  leadName?: string | null,
  existingSummary?: string | null
): string {
  if (existingSummary && existingSummary.trim()) {
    const match = existingSummary.match(
      /Ve[íi]culo\s*\/\s*Interesse:\*?\*?\s*([^\n]+)/i
    );
    const extracted = match?.[1] ? stripMarkdownLight(match[1]) : '';
    if (
      extracted &&
      !/^n[ãa]o\s+(especificado|informado|mencionado)/i.test(extracted)
    ) {
      return extracted.slice(0, 120);
    }
  }

  const clientTexts = messages
    .filter((m) => m.sender === 'cliente')
    .map((m) => {
      if (m.text?.trim()) return stripMarkdownLight(m.text);
      if (m.audio?.transcription?.trim()) {
        return stripMarkdownLight(m.audio.transcription);
      }
      if (m.attachment?.name) return `Anexo (${m.attachment.name})`;
      return '';
    })
    .filter(
      (txt) =>
        txt.length >= 3 &&
        !looksLikePhoneOnly(txt) &&
        !looksLikeShortNameOnly(txt, leadName)
    );

  const combinedClientLower = clientTexts.join(' ').toLowerCase();
  const matchedVehicle = vehicles.find((v) => {
    const model = v.model.trim().toLowerCase();
    const brandModel = `${v.brand} ${v.model}`.trim().toLowerCase();
    return (
      (model.length >= 3 && combinedClientLower.includes(model)) ||
      (brandModel.length >= 4 && combinedClientLower.includes(brandModel))
    );
  });

  const intents: string[] = [];
  if (/financ|parcel|entrada|simul|taxa|cr[ée]dito|cons[óo]rcio/i.test(combinedClientLower)) {
    intents.push('simulação de financiamento');
  }
  if (/troca|usado|avaliar|meu carro|dar na troca/i.test(combinedClientLower)) {
    intents.push('pré-avaliação de troca');
  }
  if (
    /(?:agendar|marcar|solicitar)\s+(?:uma\s+)?visita|test.?drive/i.test(combinedClientLower) &&
    !/n[ãa]o\s+agend|sem\s+agend/i.test(combinedClientLower)
  ) {
    intents.push('solicitação de visita');
  }
  if (/fipe|desconto|proposta|negoci|à vista|a vista/i.test(combinedClientLower)) {
    intents.push('proposta comercial');
  }

  if (matchedVehicle) {
    const vehicleLabel = `${matchedVehicle.brand} ${matchedVehicle.model} ${matchedVehicle.year}`;
    return intents.length > 0
      ? `${vehicleLabel} (${intents.slice(0, 2).join(' e ')})`
      : vehicleLabel;
  }

  if (clientTexts.length > 0) {
    const latestMeaningful = clientTexts[clientTexts.length - 1];
    if (latestMeaningful.length <= 95) {
      return latestMeaningful;
    }
    if (intents.length > 0) {
      return intents.slice(0, 2).join(' e ');
    }
    return `${latestMeaningful.slice(0, 92).trim()}...`;
  }

  if (intents.length > 0) {
    return intents.slice(0, 2).join(' e ');
  }

  return 'dúvidas sobre veículos do estoque';
}

/**
 * Lightweight local intent detector (zero AI tokens).
 * Respects explicit "não agende" / exploratory hours questions so they NEVER trigger handoff cards.
 */
export function detectHumanHandoffIntent(text: string): boolean {
  const clean = (text || '').trim();
  if (!clean) return false;
  if (/n[ãa]o\s+(?:agende|quero\s+agendar|precisa\s+agendar)|sem\s+agendar/i.test(clean)) {
    return false;
  }
  return /(falar\s+com\s+(?:um\s+)?(?:consultor|vendedor|atendente|humano|gerente)|atendimento\s+humano|quero\s+(?:agendar|visitar|negociar|fechar|falar\s+no\s+whats)|agendar\s+(?:uma\s+)?visita|test[\s-]?drive|whats\s*app|solicitar\s+(?:uma\s+)?simula|negocia[çc][ãa]o\s+direta|passar\s+(?:pro|para\s+o)\s+vendedor)/i.test(
    clean
  );
}

/**
 * Assembles the pre-filled WhatsApp message and `https://wa.me/{phone}?text=...` link.
 * Customer personal contact data (name/phone) is included ONLY when `includeContactData` is true.
 */
export function buildWhatsAppHandoffUrl(
  params: WhatsAppHandoffParams
): WhatsAppHandoffResult {
  const normalizedStorePhone = normalizeStoreWhatsAppNumber(
    params.storeWhatsappNumber
  );
  const storeName = (params.storeName || 'Armazém do Carro').trim();
  const includeContact = Boolean(params.includeContactData);
  const cleanName = includeContact ? (params.leadName || '').trim() : '';
  const cleanPhone = includeContact ? (params.leadPhone || '').trim() : '';
  const shortRef = formatSessionShortId(params.sessionId);
  const purpose: HandoffPurpose = params.purpose || 'sales';
  const destinationLabel =
    (params.destinationLabel || '').trim() ||
    (purpose === 'financing' ? 'Financeiro / Simulação' : 'Consultor de Vendas');

  const rawContext =
    params.contextSummary?.trim() ||
    (params.vehicleLabel ? `${params.vehicleLabel}` : '') ||
    extractHandoffContextFromMessages(
      params.messages,
      params.vehicles,
      params.leadName,
      params.existingSummary
    );
  const contextSummary = rawContext.slice(0, 140);

  const identityPart = cleanName
    ? cleanPhone
      ? `Olá! Sou ${cleanName} (${cleanPhone}).`
      : `Olá! Sou ${cleanName}.`
    : cleanPhone
      ? `Olá! Meu contato é ${cleanPhone}.`
      : 'Olá!';

  const actionLine =
    purpose === 'visit'
      ? `Gostaria de solicitar um horário de visita sobre: ${contextSummary}.`
      : purpose === 'financing'
        ? `Gostaria de solicitar uma simulação de financiamento para: ${contextSummary}.`
        : purpose === 'tradein'
          ? `Gostaria de continuar a pré-avaliação de troca sobre: ${contextSummary}.`
          : `Vim pelo atendimento do ${storeName} e gostaria de falar sobre: ${contextSummary}.`;

  const refPart = params.sessionId ? ` (Ref: #${shortRef})` : '';
  const text = `${identityPart} ${actionLine}${refPart}`.trim();

  const url = normalizedStorePhone
    ? `https://wa.me/${normalizedStorePhone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;

  return {
    url,
    text,
    shortRef,
    normalizedStorePhone,
    contextSummary,
    destinationLabel,
    purpose,
  };
}

