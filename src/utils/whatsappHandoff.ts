import { ChatMessage, DealershipSettings, Vehicle } from '../types';
import {
  extractTradeInInfo,
  extractVehicleMatchTokens,
  getVehicleDisplayTitle,
  normalizeTextForMatch,
  resolveVehicleSheetLink,
} from './vehicleDomain';

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
  focusedVehicle?: Vehicle | null;
  baseUrl?: string | null;
  purpose?: HandoffPurpose;
  destinationLabel?: string | null;
  messages?: ChatMessage[];
  vehicles?: Vehicle[];
  existingSummary?: string | null;
  dealership?: Partial<DealershipSettings> | null;
}

export interface WhatsAppHandoffResult {
  url: string;
  text: string;
  shortRef: string;
  normalizedStorePhone: string;
  contextSummary: string;
  destinationLabel: string;
  purpose: HandoffPurpose;
  resolvedVehicleId: string | null;
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

function resolveVehicleFromConversation(
  messages: ChatMessage[] = [],
  vehicles: Vehicle[] = []
): Vehicle | null {
  if (vehicles.length === 0 || messages.length === 0) return null;

  // 1. Check latest AI message that had a single focused card or financingSummary
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.sender !== 'ia') continue;
    if (m.financingSummary?.vehicleId) {
      const found = vehicles.find((v) => String(v.id) === String(m.financingSummary!.vehicleId));
      if (found) return found;
    }
    if (m.vehicleCards && m.vehicleCards.length === 1) {
      const found = vehicles.find((v) => String(v.id) === String(m.vehicleCards![0].id));
      if (found) return found;
    }
  }

  // 2. Scan recent client messages in reverse order using extractVehicleMatchTokens
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.sender !== 'cliente') continue;
    const raw = m.text || m.audio?.transcription || '';
    const norm = normalizeTextForMatch(raw);
    if (!norm) continue;
    // Skip pure trade-in description clauses without stock vehicle mention
    const candidates = vehicles.filter((v) => {
      const { modelTokens } = extractVehicleMatchTokens(v);
      return modelTokens.some((tok) =>
        new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(norm)
      );
    });
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      const yr = norm.match(/\b(20[0-2]\d)\b/)?.[1];
      if (yr) {
        const byYr = candidates.filter((v) => v.year.includes(yr));
        if (byYr.length === 1) return byYr[0];
      }
      if (/\bmanual\b/i.test(norm)) {
        const byManual = candidates.filter((v) => /manual/i.test(v.transmission));
        if (byManual.length === 1) return byManual[0];
      }
      if (/\bautomatico\b/i.test(norm)) {
        const byAuto = candidates.filter((v) => /autom/i.test(v.transmission));
        if (byAuto.length === 1) return byAuto[0];
      }
    }
  }

  return null;
}

function buildCompactTradeInLabel(messages: ChatMessage[] = []): string | null {
  const clientTexts = messages
    .filter((m) => m.sender === 'cliente')
    .map((m) => m.text || m.audio?.transcription || '')
    .filter(Boolean);
  if (clientTexts.length === 0) return null;

  // Isolate turns that describe the customer's trade-in vehicle so stock vehicle turns
  // (e.g., "Me confirma se o Onix 2021 é manual") never contaminate the trade-in label.
  const tradeInPattern =
    /\b(troca|dar na troca|usado na troca|avaliar meu|meu carro|tenho um|meu usado|para troca)\b/i;
  const tradeInTexts = clientTexts.filter((txt) =>
    tradeInPattern.test(normalizeTextForMatch(txt))
  );
  if (tradeInTexts.length === 0) return null;

  const info = extractTradeInInfo(tradeInTexts);
  if (!info.hasAnyDetail) return null;
  const parts = [info.model, info.version, info.year, info.engine, info.transmission, info.km].filter(
    Boolean
  );
  return parts.length > 0 ? parts.join(' ') : null;
}

function extractIntentsFromMessages(messages: ChatMessage[] = []): string[] {
  const combinedClientLower = messages
    .filter((m) => m.sender === 'cliente')
    .map((m) => stripMarkdownLight(m.text || m.audio?.transcription || ''))
    .join(' ')
    .toLowerCase();

  const intents: string[] = [];
  if (/financ|parcel|entrada|simul|taxa|cr[ée]dito|cons[óo]rcio/i.test(combinedClientLower)) {
    intents.push('simulação de financiamento');
  }
  if (/troca|usado|avaliar|meu carro|dar na troca/i.test(combinedClientLower)) {
    intents.push('avaliação de troca');
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
  return intents;
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

  const matchedVehicle = resolveVehicleFromConversation(messages, vehicles);
  const intents = extractIntentsFromMessages(messages);
  const tradeInLabel = buildCompactTradeInLabel(messages);

  if (matchedVehicle) {
    const vehicleLabel = `${getVehicleDisplayTitle(matchedVehicle)} ${matchedVehicle.year} (Ref. #${matchedVehicle.id})`;
    const extra: string[] = [];
    if (intents.includes('simulação de financiamento')) {
      extra.push('simulação de financiamento');
    }
    if (tradeInLabel) {
      extra.push(`meu usado na troca: ${tradeInLabel}`);
    } else if (intents.includes('avaliação de troca')) {
      extra.push('avaliação de troca');
    }
    if (intents.includes('solicitação de visita')) {
      extra.push('solicitação de visita');
    }
    return extra.length > 0 ? `${vehicleLabel} — ${extra.join(' e ')}` : vehicleLabel;
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

  if (tradeInLabel) {
    const finPart = intents.includes('simulação de financiamento')
      ? ' e simulação de financiamento'
      : '';
    return `pré-avaliação do meu usado na troca (${tradeInLabel})${finPart}`;
  }

  if (intents.length > 0) {
    return intents.slice(0, 2).join(' e ');
  }

  if (clientTexts.length > 0) {
    const latestMeaningful = clientTexts[clientTexts.length - 1];
    return latestMeaningful.length <= 95
      ? latestMeaningful
      : `${latestMeaningful.slice(0, 92).trim()}...`;
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
 * Preserves the exact focused vehicle (from card, sheet, or active chat), includes its
 * shareable sheet URL when available, clearly differentiates interest vehicle vs trade-in,
 * and keeps customer personal contact data strictly opt-in (off by default).
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

  const resolvedVehicle =
    params.focusedVehicle ||
    resolveVehicleFromConversation(params.messages, params.vehicles);

  const tradeInLabel = buildCompactTradeInLabel(params.messages);
  const intents = extractIntentsFromMessages(params.messages);

  const identityPart = cleanName
    ? cleanPhone
      ? `Olá! Sou ${cleanName} (${cleanPhone}).`
      : `Olá! Sou ${cleanName}.`
    : cleanPhone
      ? `Olá! Meu contato é ${cleanPhone}.`
      : 'Olá!';

  let contextSummary = '';
  let actionLine = '';
  const resolvedLink = resolvedVehicle
    ? resolveVehicleSheetLink(resolvedVehicle, params.baseUrl, params.dealership)
    : null;
  const sheetUrl = resolvedLink?.fullUrl || null;

  if (resolvedVehicle) {
    const vehicleName = `${getVehicleDisplayTitle(resolvedVehicle)} ${resolvedVehicle.year}`;
    const subjectParts: string[] = [];
    if (purpose === 'financing' || intents.includes('simulação de financiamento')) {
      subjectParts.push('uma simulação de financiamento');
    }
    if (purpose === 'visit' || intents.includes('solicitação de visita')) {
      subjectParts.push('uma solicitação de visita');
    }
    if (!tradeInLabel && (purpose === 'tradein' || intents.includes('avaliação de troca'))) {
      subjectParts.push('avaliação do meu usado na troca');
    }

    const subjectSuffix =
      subjectParts.length > 0 ? ` e ${subjectParts.join(' + ')}` : '';
    const tradeInClause = tradeInLabel ? ` Usado na troca: ${tradeInLabel}.` : '';
    contextSummary = `${vehicleName}${subjectSuffix}${tradeInLabel ? ` · Usado na troca: ${tradeInLabel}` : ''}`.slice(
      0,
      160
    );

    actionLine =
      purpose === 'visit'
        ? `Gostaria de solicitar um horário de visita para conhecer o ${vehicleName}.${tradeInClause}`
        : `Gostaria de conversar sobre o ${vehicleName}${subjectSuffix}.${tradeInClause}`;

    if (sheetUrl && /^https?:\/\//i.test(sheetUrl)) {
      const linkPrefix =
        resolvedLink?.isExternal && !resolvedLink.hasOfficialVehicleUrl
          ? 'Vitrine'
          : 'Ficha';
      actionLine += ` ${linkPrefix}: ${sheetUrl}`;
    }
  } else {
    const rawContext =
      params.contextSummary?.trim() ||
      (params.vehicleLabel ? `${params.vehicleLabel}` : '') ||
      extractHandoffContextFromMessages(
        params.messages,
        params.vehicles,
        params.leadName,
        params.existingSummary
      );
    contextSummary = rawContext.slice(0, 150);

    actionLine =
      purpose === 'visit'
        ? `Gostaria de solicitar um horário de visita sobre: ${contextSummary}.`
        : purpose === 'financing'
          ? `Gostaria de solicitar uma simulação de financiamento sobre: ${contextSummary}.`
          : purpose === 'tradein'
            ? `Gostaria de continuar a pré-avaliação de troca (${tradeInLabel || contextSummary}).`
            : `Vim pelo atendimento do ${storeName} e gostaria de falar sobre: ${contextSummary}.`;
  }

  const refPart = params.sessionId ? ` Ref. #${shortRef}` : '';
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
    resolvedVehicleId: resolvedVehicle?.id || null,
  };
}

