import { ChatMessage, Vehicle } from '../types';

export interface WhatsAppHandoffParams {
  storeWhatsappNumber: string;
  storeName?: string;
  leadName?: string | null;
  leadPhone?: string | null;
  sessionId?: string | null;
  contextSummary?: string | null;
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
  // 1. If a saved commercial summary already exists, extract its Vehicle/Interest line
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

  // 2. Scan recent substantive client messages (excluding pure name/phone triage turns)
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

  // 3. Match any vehicle from real inventory mentioned by the visitor
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
    intents.push('avaliação de troca');
  }
  if (/visita|agend|showroom|test.?drive|ver o carro|pessoalmente/i.test(combinedClientLower)) {
    intents.push('agendamento de visita');
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

  return 'opções de estoque e simulação de atendimento';
}

/**
 * Lightweight local intent detector (zero AI tokens) to surface the green
 * "Falar com Consultor no WhatsApp" card whenever the visitor asks for a human,
 * direct negotiation, visit scheduling, or financing simulation.
 */
export function detectHumanHandoffIntent(text: string): boolean {
  const clean = (text || '').trim();
  if (!clean) return false;
  return /(falar\s+com\s+(?:um\s+)?(?:consultor|vendedor|atendente|humano|gerente)|atendimento\s+humano|quero\s+(?:agendar|visitar|negociar|fechar|falar\s+no\s+whats)|agendar\s+(?:uma\s+)?visita|test[\s-]?drive|whats\s*app|solicitar\s+(?:uma\s+)?simula|negocia[çc][ãa]o\s+direta|passar\s+(?:pro|para\s+o)\s+vendedor)/i.test(
    clean
  );
}

/**
 * Assembles the pre-filled WhatsApp message and `https://wa.me/{phone}?text=...` link
 * purely from existing session data — zero API cost, zero Gemini tokens.
 */
export function buildWhatsAppHandoffUrl(
  params: WhatsAppHandoffParams
): WhatsAppHandoffResult {
  const normalizedStorePhone = normalizeStoreWhatsAppNumber(
    params.storeWhatsappNumber
  );
  const storeName = (params.storeName || 'Armazém do Carro').trim();
  const cleanName = (params.leadName || '').trim();
  const cleanPhone = (params.leadPhone || '').trim();
  const shortRef = formatSessionShortId(params.sessionId);

  const contextSummary = (
    params.contextSummary?.trim() ||
    extractHandoffContextFromMessages(
      params.messages,
      params.vehicles,
      cleanName,
      params.existingSummary
    )
  ).slice(0, 140);

  const identityPart = cleanName
    ? cleanPhone
      ? `Olá! Sou ${cleanName} (WhatsApp: ${cleanPhone}).`
      : `Olá! Sou ${cleanName}.`
    : cleanPhone
      ? `Olá! Meu WhatsApp é ${cleanPhone}.`
      : 'Olá!';

  const text = `${identityPart} Vim pelo atendimento virtual do ${storeName} e gostaria de continuar minha simulação/atendimento sobre: ${contextSummary}. (Ref: #${shortRef})`;

  const url = normalizedStorePhone
    ? `https://wa.me/${normalizedStorePhone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;

  return {
    url,
    text,
    shortRef,
    normalizedStorePhone,
    contextSummary,
  };
}
