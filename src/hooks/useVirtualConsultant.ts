import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChatAttachment,
  ChatAudioMeta,
  ChatMessage,
  ChatReplyContext,
  ChatSuggestedAction,
  ChatTriageStage,
  DealershipSettings,
  Lead,
  Vehicle,
  VehicleCardData,
  VehicleComparisonData,
  VehicleFinancingSummary,
  VehicleSearchFilters,
} from '../types';
import { formatBrazilianPhone } from '../utils/chatTags';
import { formatBRL, formatKm } from '../utils/formatters';
import {
  clearLocalChatState,
  loadLocalChatStateAsync,
  loadLocalChatStateSync,
  saveLocalChatState,
} from '../utils/chatLocalStorage';

interface UseVirtualConsultantParams {
  active: boolean;
  targetVehicle: Vehicle | null;
  vehicles: Vehicle[];
  settings: DealershipSettings;
  originLabel?: string;
  leadSourceLabel?: Lead['source'];
  leadNote?: string;
  persistStorageKey?: string;
  onCaptureLead: (lead: Lead) => Promise<Lead>;
  onSyncLeadChat?: (leadId: string, chatHistory: ChatMessage[]) => Promise<void>;
}

export interface SendRichMessagePayload {
  text?: string;
  audio?: ChatAudioMeta | null;
  attachment?: ChatAttachment | null;
  replyTo?: ChatReplyContext | null;
}

export interface IncomingVisitorNotification {
  id: string;
  title: string;
  body: string;
}

const LAST_BROADCAST_KEY_PREFIX = 'armazem_last_broadcast_id_';

function createChatSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `sess-${Date.now().toString(36)}-${rand}`;
}

function nowTimePt(): string {
  return new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createWelcomeMessage(tradeName: string): ChatMessage {
  return {
    id: `msg-ia-welcome-${Date.now()}`,
    sender: 'ia',
    text: `Olá! Bem-vindo à **${tradeName}**. Posso filtrar veículos disponíveis por preço, km ou câmbio, comparar opções, simular saldo de financiamento ou responder sobre horários e troca.\n\nEscolha um atalho abaixo ou me diga o carro que você procura:`,
    timestamp: nowTimePt(),
  };
}

function createTriageAskNameMessage(tradeName: string): ChatMessage {
  return {
    id: `msg-ia-triage-name-${Date.now()}`,
    sender: 'ia',
    text: `Olá! Bem-vindo à **${tradeName}**. Para começarmos seu atendimento, qual é o seu **nome**?`,
    timestamp: nowTimePt(),
  };
}

function createTriageAskPhoneMessage(leadName: string): ChatMessage {
  const firstName = getFirstName(leadName);
  return {
    id: `msg-ia-triage-phone-${Date.now()}`,
    sender: 'ia',
    text: `Prazer, **${firstName}**! Qual é o seu **WhatsApp com DDD** para contato e envio de simulações?

_Ao informar seu número, você concorda com o contato comercial conforme nossa Política de Privacidade (LGPD)._`,
    timestamp: nowTimePt(),
  };
}

function createTriageInvalidPhoneMessage(leadName: string): ChatMessage {
  const firstName = getFirstName(leadName);
  return {
    id: `msg-ia-triage-phone-retry-${Date.now()}`,
    sender: 'ia',
    text: `Não consegui identificar um WhatsApp válido com DDD, **${firstName}**. Pode enviar no formato **(11) 99999-9999**?`,
    timestamp: nowTimePt(),
  };
}

function createTriageCompleteMessage(
  tradeName: string,
  leadName: string
): ChatMessage {
  const firstName = getFirstName(leadName);
  return {
    id: `msg-ia-triage-complete-${Date.now()}`,
    sender: 'ia',
    text: `Perfeito, **${firstName}**! Cadastro confirmado. Como posso te ajudar hoje na **${tradeName}**? Escolha uma opção abaixo ou envie sua dúvida por texto, áudio ou foto:`,
    timestamp: nowTimePt(),
  };
}

function getFirstName(fullName: string): string {
  const clean = fullName.trim().replace(/\s+/g, ' ');
  return clean.split(' ')[0] || clean;
}

function normalizeNameForComparison(name: string): string {
  return getFirstName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function hasValidPhoneDigits(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 13;
}

function extractValidBrazilianPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  if (digits.length < 10 || digits.length > 11) {
    return null;
  }
  // Reject obvious repeated fake sequences like 0000000000 or 11111111111
  if (/^(\d)\1+$/.test(digits)) {
    return null;
  }
  return formatBrazilianPhone(digits);
}

function extractTriageName(raw: string): string | null {
  let cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  cleaned = cleaned
    .replace(
      /^(?:ol[áa]|oi|bom\s+dia|boa\s+tarde|boa\s+noite)[,!.\s-]*/i,
      ''
    )
    .replace(
      /^(?:me\s+chamo|meu\s+nome\s+(?:é|e)|pode\s+me\s+chamar\s+de|aqui\s+(?:é|e)\s+(?:o|a)?|eu\s+sou\s+(?:o|a)?|sou\s+(?:o|a)?)\s+/i,
      ''
    )
    .replace(/[!?.:,;]+$/g, '')
    .trim();

  // Reject messages that are mostly digits (e.g., phone entered instead of name)
  const lettersOnly = cleaned.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (lettersOnly.length < 2) return null;

  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-zÀ-ÿ'-]/g, ''))
    .filter((w) => w.length >= 1);

  if (words.length === 0) return null;

  const formatted = words
    .slice(0, 4)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 80);

  return formatted.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 2 ? formatted : null;
}

function createReturningWelcomeMessage(
  tradeName: string,
  leadName: string
): ChatMessage {
  const firstName = getFirstName(leadName);
  return {
    id: `msg-ia-return-welcome-${Date.now()}`,
    sender: 'ia',
    text: `Olá novamente, **${firstName}**! Que bom ter você de volta à **${tradeName}**.

Em que posso ajudar hoje? Escolha uma opção rápida abaixo ou **envie sua dúvida por texto, áudio ou foto** direto!`,
    timestamp: nowTimePt(),
  };
}

/**
 * Adapts restored chat history for a returning fully identified visitor:
 * - Shows a single personalized returning-visitor greeting with the Quick Menu
 *   alongside the preserved conversation history (never duplicating on repeated reloads).
 */
function personalizeRestoredHistory(
  history: ChatMessage[],
  tradeName: string,
  leadName: string
): ChatMessage[] {
  const cleanLead = leadName.trim();
  if (!cleanLead || history.length === 0) return history;

  const firstName = getFirstName(cleanLead);
  const returningBubble = createReturningWelcomeMessage(tradeName, cleanLead);

  if (
    history.length === 1 &&
    history[0].sender === 'ia' &&
    (history[0].id.startsWith('msg-ia-welcome') ||
      history[0].id.startsWith('msg-ia-return-welcome') ||
      history[0].id.startsWith('msg-ia-triage-name'))
  ) {
    return [returningBubble];
  }

  const updated = history.map((msg, idx) => {
    if (
      idx === 0 &&
      msg.sender === 'ia' &&
      msg.id.startsWith('msg-ia-welcome') &&
      msg.text.toLowerCase().includes('como posso te chamar')
    ) {
      return {
        ...msg,
        text: `Olá, **${firstName}**! Sou o **Consultor Oficial** da **${tradeName}**. Todos os nossos seminovos contam com **laudo cautelar 100% aprovado** e **garantia de 90 dias (CDC)**.`,
      };
    }
    return msg;
  });

  const lastMsg = updated[updated.length - 1];
  if (lastMsg && lastMsg.id.startsWith('msg-ia-return-welcome')) {
    updated[updated.length - 1] = {
      ...returningBubble,
      id: lastMsg.id,
    };
    return updated;
  }

  return [...updated, returningBubble];
}

const SWITCH_NAME_BLOCKLIST = new Set([
  'cliente', 'visitante', 'interessado', 'interessada', 'carro', 'carros',
  'veiculo', 'veículo', 'estoque', 'financiamento', 'troca', 'visita',
  'simular', 'quero', 'preciso', 'gostaria', 'obrigado', 'obrigada',
]);

function detectExplicitDifferentUserName(
  text: string,
  currentName: string
): string | null {
  const currentNorm = normalizeNameForComparison(currentName);
  if (!currentNorm || !text.trim()) return null;

  const patterns = [
    /(?:^|[\s,!.;-])(?:me\s+chamo|meu\s+nome\s+(?:é|e)|pode\s+me\s+chamar\s+de|aqui\s+(?:é|e)\s+(?:o|a)|eu\s+sou\s+(?:o|a)|sou\s+(?:o|a))\s+([A-Za-zÀ-ÿ]{2,20}(?:\s+[A-Za-zÀ-ÿ]{2,20})?)(?=$|[\s,!.;?:-]|(?:\s+(?:e|quero|gostaria|preciso|tenho|estou|tô|to|vim|queria|tudo|bom|boa|sobre|qual|quais|quanto|vocês|voces|vcs|pode|por|para)\b))/i,
  ];

  for (const rx of patterns) {
    const match = text.match(rx);
    if (!match?.[1]) continue;
    const rawWords = match[1].trim().split(/\s+/).filter(Boolean);
    const firstWord = rawWords[0];
    if (!firstWord || firstWord.length < 2) continue;
    const firstLower = firstWord.toLowerCase();
    if (SWITCH_NAME_BLOCKLIST.has(firstLower)) continue;

    const candidateNorm = normalizeNameForComparison(firstWord);
    if (candidateNorm && candidateNorm !== currentNorm) {
      const formatted = rawWords
        .slice(0, 2)
        .filter((w) => !SWITCH_NAME_BLOCKLIST.has(w.toLowerCase()))
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
      if (formatted) return formatted;
    }
  }
  return null;
}

function buildLightweightLeadHistory(transcript: ChatMessage[]): ChatMessage[] {
  return transcript.map((m) => ({
    id: m.id,
    sender: m.sender,
    text:
      m.text ||
      (m.audio?.transcription
        ? `[Áudio] ${m.audio.transcription}`
        : m.audio
          ? '[Mensagem de áudio]'
          : m.attachment
            ? `[Anexo: ${m.attachment.name}]`
            : ''),
    timestamp: m.timestamp,
    ...(m.replyTo ? { replyTo: m.replyTo } : {}),
  }));
}

function playSubtleChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(784, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1046, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
  } catch {
    // Ignore autoplay/audio restrictions
  }
}

export function useVirtualConsultant({
  active,
  targetVehicle,
  vehicles,
  settings,
  originLabel = 'Vitrine',
  leadSourceLabel = 'Chat IA do Site',
  leadNote = 'Lead capturado pelo Consultor Virtual de IA.',
  persistStorageKey,
  onCaptureLead,
  onSyncLeadChat,
}: UseVirtualConsultantParams) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [replyingTo, setReplyingTo] = useState<ChatReplyContext | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [activeAudioMessageId, setActiveAudioMessageId] = useState<string | null>(null);
  const [hasStreamFirstToken, setHasStreamFirstToken] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState<string>(() => {
    if (!persistStorageKey || targetVehicle) return '';
    return (loadLocalChatStateSync(persistStorageKey)?.customerName || '').trim();
  });
  const [customerWhatsapp, setCustomerWhatsapp] = useState<string>(() => {
    if (!persistStorageKey || targetVehicle) return '';
    return (
      loadLocalChatStateSync(persistStorageKey)?.customerWhatsapp || ''
    ).trim();
  });
  const [lgpdConsent, setLgpdConsent] = useState<boolean>(() => {
    if (!persistStorageKey || targetVehicle) return false;
    const savedPhone = (
      loadLocalChatStateSync(persistStorageKey)?.customerWhatsapp || ''
    ).trim();
    return hasValidPhoneDigits(savedPhone);
  });
  const [isSavingLead, setIsSavingLead] = useState(false);
  const [leadSaveError, setLeadSaveError] = useState<string | null>(null);
  const [leadSaved, setLeadSaved] = useState(false);
  const [persistedLeadId, setPersistedLeadId] = useState<string | null>(null);
  const [incomingNotification, setIncomingNotification] =
    useState<IncomingVisitorNotification | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastTriggerRef = useRef<string | null>(null);
  const persistedLeadIdRef = useRef<string | null>(null);
  const customerNameRef = useRef<string>(customerName);
  const customerWhatsappRef = useRef<string>(customerWhatsapp);
  const abortControllerRef = useRef<AbortController | null>(null);
  const initialSessionId = useRef<string>(
    persistStorageKey && !targetVehicle
      ? loadLocalChatStateSync(persistStorageKey)?.sessionId ||
          createChatSessionId()
      : createChatSessionId()
  ).current;
  const [sessionId, setSessionId] = useState<string>(initialSessionId);
  const sessionIdRef = useRef<string>(initialSessionId);
  const updateSessionId = useCallback((nextId: string) => {
    sessionIdRef.current = nextId;
    setSessionId(nextId);
  }, []);
  const storageReadyRef = useRef<boolean>(false);
  const storageVersionRef = useRef<number>(0);
  const userMutatedRef = useRef<boolean>(false);
  const lastConsultantMsgIdRef = useRef<number>(0);
  const lastBroadcastIdRef = useRef<number>(0);

  const [activeFilters, setActiveFilters] = useState<VehicleSearchFilters>({});
  const [recentVehicleIds, setRecentVehicleIds] = useState<string[]>([]);
  const [focusedVehicleId, setFocusedVehicleId] = useState<string | null>(
    targetVehicle?.id || null
  );
  const [compareVehicleIds, setCompareVehicleIds] = useState<string[]>([]);
  const [lastFailedSend, setLastFailedSend] = useState<{
    messages: ChatMessage[];
    options?: {
      userMessageId?: string;
      replyTo?: ChatReplyContext | null;
      audio?: ChatAudioMeta | null;
      attachment?: ChatAttachment | null;
    };
  } | null>(null);

  const activeFiltersRef = useRef<VehicleSearchFilters>({});
  const recentVehicleIdsRef = useRef<string[]>([]);
  const focusedVehicleIdRef = useRef<string | null>(targetVehicle?.id || null);
  const compareVehicleIdsRef = useRef<string[]>([]);

  // Non-blocking chat: visitors can search vehicles, financing, and hours immediately without forced contact capture
  const triageStage: ChatTriageStage = 'complete';

  useEffect(() => {
    persistedLeadIdRef.current = persistedLeadId;
  }, [persistedLeadId]);

  useEffect(() => {
    customerNameRef.current = customerName;
  }, [customerName]);

  useEffect(() => {
    customerWhatsappRef.current = customerWhatsapp;
  }, [customerWhatsapp]);

  useEffect(() => {
    if (!active) {
      abortControllerRef.current?.abort();
    }
  }, [active]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const clearReply = useCallback(() => {
    setReplyingTo(null);
  }, []);

  const dismissIncomingNotification = useCallback(() => {
    setIncomingNotification(null);
  }, []);

  const syncVisitorIdentityToServer = useCallback(
    async (leadName: string, leadPhone?: string) => {
      try {
        await fetch('/api/public/chat-session/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            leadName,
            leadPhone: leadPhone || undefined,
            origem: originLabel,
          }),
        });
      } catch {
        // Silent fallback if offline; local state still persists
      }
    },
    [originLabel]
  );

  const sendMessageToAi = useCallback(
    async (
      nextMessages: ChatMessage[],
      vehicleContext: Vehicle | null,
      options?: {
        userMessageId?: string;
        replyTo?: ChatReplyContext | null;
        audio?: ChatAudioMeta | null;
        attachment?: ChatAttachment | null;
      }
    ) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const hasAudioPayload = Boolean(options?.audio);
      let didTimeout = false;
      const timeoutMs = hasAudioPayload ? 35_000 : 30_000;
      const requestTimeoutId = window.setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, timeoutMs);

      setIsSending(true);
      setIsProcessingAudio(hasAudioPayload);
      setActiveAudioMessageId(
        hasAudioPayload && options?.userMessageId ? options.userMessageId : null
      );
      setHasStreamFirstToken(false);
      setErrorMsg(null);

      try {
        const inventorySummary = vehicles
          .filter((v) => v.status !== 'Vendido')
          .map(
            (v) =>
              `${v.brand} ${v.model} ${v.version} (${v.year}, ${formatKm(v.km)}, ${formatBRL(v.price)}${
                v.fipePrice > 0
                  ? `, FIPE${v.fipeCode ? ` ${v.fipeCode}` : ''}: ${formatBRL(v.fipePrice)}`
                  : ''
              })`
          )
          .join('\n');

        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
          body: JSON.stringify({
            stream: true,
            sessionId: sessionIdRef.current,
            origem: originLabel,
            ...(customerNameRef.current.trim()
              ? { visitorName: customerNameRef.current.trim() }
              : {}),
            chatContext: {
              activeFilters: activeFiltersRef.current,
              recentVehicleIds: recentVehicleIdsRef.current,
              focusedVehicleId: focusedVehicleIdRef.current,
              compareVehicleIds: compareVehicleIdsRef.current,
              baseUrl: typeof window !== 'undefined' ? window.location.origin : '',
            },
            messages: nextMessages.map((m) => ({
              sender: m.sender,
              text:
                m.text ||
                (m.audio?.transcription
                  ? `[Áudio]: ${m.audio.transcription}`
                  : m.audio
                    ? 'Mensagem de áudio'
                    : m.attachment
                      ? `Anexo enviado: ${m.attachment.name}`
                      : ''),
            })),
            replyTo: options?.replyTo
              ? {
                  id: options.replyTo.id,
                  sender: options.replyTo.sender,
                  preview: options.replyTo.preview,
                }
              : null,
            audio: options?.audio
              ? {
                  dataUrl: options.audio.url,
                  mimeType: options.audio.mimeType,
                  durationSec: options.audio.durationSec,
                }
              : null,
            attachment: options?.attachment
              ? {
                  dataUrl: options.attachment.url,
                  name: options.attachment.name,
                  mimeType: options.attachment.mimeType,
                }
              : null,
            vehicle: vehicleContext
              ? {
                  brand: vehicleContext.brand,
                  model: vehicleContext.model,
                  version: vehicleContext.version,
                  year: vehicleContext.year,
                  km: vehicleContext.km,
                  price: vehicleContext.price,
                  fipePrice: vehicleContext.fipePrice,
                  fipeCode: vehicleContext.fipeCode,
                  color: vehicleContext.color,
                  transmission: vehicleContext.transmission,
                  fuel: vehicleContext.fuel,
                  status: vehicleContext.status,
                  optionals: vehicleContext.optionals,
                }
              : null,
            inventorySummary,
            settings: {
              tradeName: settings.tradeName,
              address: settings.address,
              city: settings.city,
              state: settings.state,
              whatsapp: settings.salesWhatsapp || settings.whatsapp,
              hoursWeekdays: settings.hoursWeekdays,
              hoursSaturday: settings.hoursSaturday,
              hoursSunday: settings.hoursSunday,
              aiAssistantName: settings.aiAssistantName,
            },
          }),
        });

        const contentType = response.headers.get('content-type') || '';

        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as {
            error?: string;
            stockQueryError?: boolean;
          };
          throw new Error(errData.error || 'Erro ao responder mensagem.');
        }

        setLastFailedSend(null);
        const aiMsgId = `msg-ia-${Date.now()}`;
        const aiTimestamp = nowTimePt();

        let workingMessages = nextMessages;
        const applyTranscriptionToUserMsg = (transcription: string) => {
          if (!options?.userMessageId || !transcription.trim()) return;
          workingMessages = workingMessages.map((m) =>
            m.id === options.userMessageId && m.audio
              ? {
                  ...m,
                  audio: { ...m.audio, transcription: transcription.trim() },
                }
              : m
          );
          setMessages((prev) =>
            prev.map((m) =>
              m.id === options.userMessageId && m.audio
                ? {
                    ...m,
                    audio: { ...m.audio, transcription: transcription.trim() },
                  }
                : m
            )
          );
        };

        interface StructuredMetaPayload {
          transcription?: string;
          visitorName?: string;
          vehicleCards?: VehicleCardData[];
          comparison?: VehicleComparisonData | null;
          financingSummary?: VehicleFinancingSummary | null;
          activeFilters?: VehicleSearchFilters;
          recentVehicleIds?: string[];
          focusedVehicleId?: string | null;
          promptAttachPhotos?: boolean;
          suggestedActions?: ChatSuggestedAction[];
          stockQueryError?: boolean;
          isVisitInquiryOnly?: boolean;
          suppressHandoff?: boolean;
        }

        let capturedMeta: Partial<ChatMessage> = {};
        const applyStructuredMeta = (meta: StructuredMetaPayload) => {
          if (meta.transcription) {
            applyTranscriptionToUserMsg(meta.transcription);
          }
          if (meta.visitorName?.trim() && !customerNameRef.current.trim()) {
            const cleanName = meta.visitorName.trim();
            customerNameRef.current = cleanName;
            setCustomerName(cleanName);
          }
          if (meta.activeFilters !== undefined) {
            activeFiltersRef.current = meta.activeFilters;
            setActiveFilters(meta.activeFilters);
          }
          if (Array.isArray(meta.recentVehicleIds)) {
            recentVehicleIdsRef.current = meta.recentVehicleIds;
            setRecentVehicleIds(meta.recentVehicleIds);
          }
          if (meta.focusedVehicleId !== undefined) {
            focusedVehicleIdRef.current = meta.focusedVehicleId;
            setFocusedVehicleId(meta.focusedVehicleId);
          }
          capturedMeta = {
            ...(Array.isArray(meta.vehicleCards) && meta.vehicleCards.length > 0
              ? { vehicleCards: meta.vehicleCards }
              : {}),
            ...(meta.comparison ? { comparison: meta.comparison } : {}),
            ...(meta.financingSummary
              ? { financingSummary: meta.financingSummary }
              : {}),
            ...(meta.promptAttachPhotos ? { promptAttachPhotos: true } : {}),
            ...(Array.isArray(meta.suggestedActions) &&
            meta.suggestedActions.length > 0
              ? { suggestedActions: meta.suggestedActions }
              : {}),
            ...(meta.stockQueryError ? { stockQueryError: true } : {}),
            ...(meta.isVisitInquiryOnly ? { isVisitInquiryOnly: true } : {}),
            ...(meta.suppressHandoff ? { suppressHandoff: true } : {}),
          };
          if (meta.stockQueryError) {
            setLastFailedSend({ messages: nextMessages, options });
          }
        };

        if (!contentType.includes('text/event-stream') || !response.body) {
          const data = (await response.json()) as StructuredMetaPayload & {
            reply: string;
          };
          applyStructuredMeta(data);
          const aiMsg: ChatMessage = {
            id: aiMsgId,
            sender: 'ia',
            text: data.reply,
            timestamp: aiTimestamp,
            ...capturedMeta,
          };
          const updatedTranscript = [...workingMessages, aiMsg];
          setMessages(updatedTranscript);
          if (persistedLeadIdRef.current && onSyncLeadChat) {
            void onSyncLeadChat(
              persistedLeadIdRef.current,
              buildLightweightLeadHistory(updatedTranscript)
            );
          }
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let sseBuffer = '';
        let accumulatedText = '';
        let streamMessageInserted = false;

        const upsertStreamingMessage = (text: string) => {
          const streamingMsg: ChatMessage = {
            id: aiMsgId,
            sender: 'ia',
            text,
            timestamp: aiTimestamp,
            ...capturedMeta,
          };
          if (!streamMessageInserted) {
            streamMessageInserted = true;
            setHasStreamFirstToken(true);
            setMessages((prev) => [...prev, streamingMsg]);
          } else {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsgId ? { ...m, ...capturedMeta, text } : m
              )
            );
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const events = sseBuffer.split('\n\n');
          sseBuffer = events.pop() ?? '';

          for (const rawEvent of events) {
            const lines = rawEvent
              .split('\n')
              .filter((line) => line.startsWith('data:'));
            for (const line of lines) {
              const jsonStr = line.slice(5).trim();
              if (!jsonStr) continue;
              const parsed = JSON.parse(jsonStr) as StructuredMetaPayload & {
                type: 'meta' | 'chunk' | 'done' | 'error';
                text?: string;
                reply?: string;
                error?: string;
              };

              if (parsed.type === 'meta') {
                applyStructuredMeta(parsed);
              } else if (parsed.type === 'chunk' && parsed.text) {
                accumulatedText += parsed.text;
                upsertStreamingMessage(accumulatedText);
              } else if (parsed.type === 'done') {
                const finalText = (parsed.reply || accumulatedText).trim();
                if (finalText) {
                  upsertStreamingMessage(finalText);
                  const updatedTranscript: ChatMessage[] = [
                    ...workingMessages,
                    {
                      id: aiMsgId,
                      sender: 'ia',
                      text: finalText,
                      timestamp: aiTimestamp,
                      ...capturedMeta,
                    },
                  ];
                  if (persistedLeadIdRef.current && onSyncLeadChat) {
                    void onSyncLeadChat(
                      persistedLeadIdRef.current,
                      buildLightweightLeadHistory(updatedTranscript)
                    );
                  }
                }
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error || 'Erro durante resposta da IA.');
              }
            }
          }
        }
      } catch (err: unknown) {
        setLastFailedSend({ messages: nextMessages, options });
        if (didTimeout) {
          setErrorMsg(
            hasAudioPayload
              ? 'O processamento do áudio demorou mais que o esperado. Tente enviar um áudio mais curto ou escreva sua mensagem por texto.'
              : 'O atendimento demorou mais que o esperado. Clique em Tentar novamente.'
          );
          return;
        }
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setErrorMsg(
          err instanceof Error
            ? err.message
            : hasAudioPayload
              ? 'Não foi possível processar o áudio agora. Tente enviar novamente ou digite sua dúvida.'
              : 'Não foi possível conectar ao assistente no momento.'
        );
      } finally {
        window.clearTimeout(requestTimeoutId);
        setIsSending(false);
        setIsProcessingAudio(false);
        setActiveAudioMessageId(null);
        setHasStreamFirstToken(false);
      }
    },
    [onSyncLeadChat, originLabel, settings, vehicles]
  );

  // Initialize greeting, restore local history (when persistStorageKey is set), or auto-inquiry
  useEffect(() => {
    if (!active) return;

    const triggerKey = targetVehicle
      ? targetVehicle.id
      : persistStorageKey
        ? `general:${persistStorageKey}`
        : 'general';
    if (lastTriggerRef.current === triggerKey && messages.length > 0) {
      return;
    }

    lastTriggerRef.current = triggerKey;
    storageReadyRef.current = false;
    userMutatedRef.current = false;
    storageVersionRef.current += 1;
    const hydrationVersion = storageVersionRef.current;

    if (targetVehicle) {
      updateSessionId(createChatSessionId());
      setLeadSaved(false);
      setLeadSaveError(null);
      setLgpdConsent(false);
      setPersistedLeadId(null);
      setReplyingTo(null);
      persistedLeadIdRef.current = null;
      setErrorMsg(null);

      const autoUserMsg: ChatMessage = {
        id: `msg-cli-${Date.now()}`,
        sender: 'cliente',
        text: `Olá! Tenho interesse no **${targetVehicle.brand} ${targetVehicle.model} ${targetVehicle.version}** (**${targetVehicle.year}** · **${formatBRL(targetVehicle.price)}**). Ele está disponível para visita e financiamento?`,
        timestamp: nowTimePt(),
      };
      setMessages([autoUserMsg]);
      void sendMessageToAi([autoUserMsg], targetVehicle, {
        userMessageId: autoUserMsg.id,
      });
      return;
    }

    if (persistStorageKey) {
      const savedSync = loadLocalChatStateSync(persistStorageKey);

      // Initialize last seen broadcast ID so historical broadcasts don't duplicate
      try {
        const storedBroadcastId = Number(
          window.localStorage.getItem(
            `${LAST_BROADCAST_KEY_PREFIX}${persistStorageKey}`
          ) || '0'
        );
        lastBroadcastIdRef.current = Number.isFinite(storedBroadcastId)
          ? storedBroadcastId
          : 0;
      } catch {
        lastBroadcastIdRef.current = 0;
      }

      if (savedSync && savedSync.messages.length > 0) {
        updateSessionId(savedSync.sessionId);
        const initialKnownName = (savedSync.customerName || '').trim();
        const initialKnownPhone = (savedSync.customerWhatsapp || '').trim();
        const isFullyIdentified =
          initialKnownName.length >= 2 && hasValidPhoneDigits(initialKnownPhone);

        // Track highest dbId already restored in local history
        const maxRestoredDbId = savedSync.messages.reduce(
          (max, m) => (m.dbId && m.dbId > max ? m.dbId : max),
          0
        );
        lastConsultantMsgIdRef.current = maxRestoredDbId;

        let restoredMessages: ChatMessage[];
        if (initialKnownName.length >= 2) {
          restoredMessages = personalizeRestoredHistory(
            savedSync.messages,
            settings.tradeName,
            initialKnownName
          );
        } else {
          // Restore previous text-only or rich history cleanly without blocking on triage
          restoredMessages = savedSync.messages;
        }

        setMessages(restoredMessages);
        setLeadSaved(Boolean(savedSync.leadSaved));
        setPersistedLeadId(savedSync.persistedLeadId ?? null);
        persistedLeadIdRef.current = savedSync.persistedLeadId ?? null;
        customerNameRef.current = initialKnownName;
        customerWhatsappRef.current = initialKnownPhone;
        setCustomerName(initialKnownName);
        setCustomerWhatsapp(initialKnownPhone);
        setLgpdConsent(hasValidPhoneDigits(initialKnownPhone));
        setLeadSaveError(null);
        setReplyingTo(null);
        setErrorMsg(null);
        storageReadyRef.current = true;
      } else {
        updateSessionId(createChatSessionId());
        lastConsultantMsgIdRef.current = 0;
        setLeadSaved(false);
        setLeadSaveError(null);
        setLgpdConsent(false);
        setPersistedLeadId(null);
        setReplyingTo(null);
        persistedLeadIdRef.current = null;
        customerNameRef.current = '';
        customerWhatsappRef.current = '';
        setCustomerName('');
        setCustomerWhatsapp('');
        setErrorMsg(null);
        setMessages([createWelcomeMessage(settings.tradeName)]);
        storageReadyRef.current = true;
      }

      // Async hydration from IndexedDB restores full audio/image/PDF payloads if available
      void loadLocalChatStateAsync(persistStorageKey).then((savedAsync) => {
        if (
          !savedAsync ||
          savedAsync.messages.length === 0 ||
          storageVersionRef.current !== hydrationVersion ||
          userMutatedRef.current
        ) {
          return;
        }
        const resolvedName = (
          customerNameRef.current ||
          savedAsync.customerName ||
          ''
        ).trim();
        const resolvedPhone = (
          customerWhatsappRef.current ||
          savedAsync.customerWhatsapp ||
          ''
        ).trim();
        const isFullyIdentified =
          resolvedName.length >= 2 && hasValidPhoneDigits(resolvedPhone);

        const maxAsyncDbId = savedAsync.messages.reduce(
          (max, m) => (m.dbId && m.dbId > max ? m.dbId : max),
          lastConsultantMsgIdRef.current
        );
        lastConsultantMsgIdRef.current = maxAsyncDbId;

        if (savedSync) {
          if (
            savedAsync.sessionId === savedSync.sessionId &&
            savedAsync.messages.length >= savedSync.messages.length &&
            isFullyIdentified
          ) {
            setMessages(
              personalizeRestoredHistory(
                savedAsync.messages,
                settings.tradeName,
                resolvedName
              )
            );
          }
        } else if (isFullyIdentified) {
          updateSessionId(savedAsync.sessionId);
          setMessages(
            personalizeRestoredHistory(
              savedAsync.messages,
              settings.tradeName,
              resolvedName
            )
          );
          setLeadSaved(Boolean(savedAsync.leadSaved));
          setPersistedLeadId(savedAsync.persistedLeadId ?? null);
          persistedLeadIdRef.current = savedAsync.persistedLeadId ?? null;
          customerNameRef.current = resolvedName;
          customerWhatsappRef.current = resolvedPhone;
          setCustomerName(resolvedName);
          setCustomerWhatsapp(resolvedPhone);
          setLgpdConsent(true);
        }
      });

      // Sync persisted session identity (lead_name / lead_phone) from Neon chat_sessions
      if (savedSync?.sessionId) {
        void fetch(
          `/api/public/chat-session/${encodeURIComponent(savedSync.sessionId)}`
        )
          .then((res) => (res.ok ? res.json() : null))
          .then(
            (
              data: {
                found?: boolean;
                leadName?: string | null;
                leadPhone?: string | null;
              } | null
            ) => {
              if (
                !data ||
                !data.found ||
                storageVersionRef.current !== hydrationVersion ||
                userMutatedRef.current
              ) {
                return;
              }
              const serverName = data.leadName?.trim() || '';
              const serverPhone = data.leadPhone?.trim() || '';
              const finalName = customerNameRef.current.trim() || serverName;
              const finalPhone =
                customerWhatsappRef.current.trim() || serverPhone;

              if (serverName && !customerNameRef.current.trim()) {
                customerNameRef.current = serverName;
                setCustomerName(serverName);
              }
              if (serverPhone && !customerWhatsappRef.current.trim()) {
                customerWhatsappRef.current = serverPhone;
                setCustomerWhatsapp(serverPhone);
                if (hasValidPhoneDigits(serverPhone)) {
                  setLgpdConsent(true);
                }
              }
              if (
                finalName.length >= 2 &&
                hasValidPhoneDigits(finalPhone) &&
                (!customerNameRef.current.trim() ||
                  !hasValidPhoneDigits(customerWhatsappRef.current))
              ) {
                setMessages((prev) =>
                  personalizeRestoredHistory(prev, settings.tradeName, finalName)
                );
              }
            }
          )
          .catch(() => {
            // Silent fallback when offline or unavailable
          });
      }
      return;
    }

    updateSessionId(createChatSessionId());
    setLeadSaved(false);
    setLeadSaveError(null);
    setLgpdConsent(false);
    setPersistedLeadId(null);
    setReplyingTo(null);
    persistedLeadIdRef.current = null;
    setErrorMsg(null);
    setMessages([createWelcomeMessage(settings.tradeName)]);
  }, [
    active,
    messages.length,
    persistStorageKey,
    sendMessageToAi,
    settings.tradeName,
    targetVehicle,
    updateSessionId,
  ]);

  // Persist conversation automatically to localStorage + IndexedDB when enabled
  useEffect(() => {
    if (
      !persistStorageKey ||
      targetVehicle ||
      !storageReadyRef.current ||
      messages.length === 0 ||
      isSending
    ) {
      return;
    }
    saveLocalChatState(persistStorageKey, {
      version: 1,
      sessionId: sessionIdRef.current,
      messages,
      leadSaved,
      persistedLeadId,
      customerName,
      customerWhatsapp,
      updatedAt: Date.now(),
    });
  }, [
    customerName,
    customerWhatsapp,
    isSending,
    leadSaved,
    messages,
    persistStorageKey,
    persistedLeadId,
    targetVehicle,
  ]);

  // Lightweight polling for live Consultant Messages & Store Broadcasts on /chat
  useEffect(() => {
    if (!active || !persistStorageKey || targetVehicle) return;

    let cancelled = false;
    const pollUpdates = async () => {
      const currentSession = sessionIdRef.current;
      if (!currentSession || cancelled) return;
      try {
        const res = await fetch(
          `/api/public/chat-session/${encodeURIComponent(
            currentSession
          )}/updates?afterMessageId=${lastConsultantMsgIdRef.current}&afterBroadcastId=${lastBroadcastIdRef.current}`
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          consultantMessages?: Array<{
            id: number;
            content: string;
            senderLabel: string;
            createdAt: string;
          }>;
          broadcasts?: Array<{
            id: number;
            title: string | null;
            message: string;
            createdBy: string | null;
            createdAt: string;
          }>;
        };

        const newConsultantMsgs = Array.isArray(data.consultantMessages)
          ? data.consultantMessages
          : [];
        const newBroadcasts = Array.isArray(data.broadcasts)
          ? data.broadcasts
          : [];

        if (newConsultantMsgs.length === 0 && newBroadcasts.length === 0) {
          return;
        }

        const appendedBubbles: ChatMessage[] = [];
        let latestToast: IncomingVisitorNotification | null = null;

        for (const cm of newConsultantMsgs) {
          if (cm.id > lastConsultantMsgIdRef.current) {
            lastConsultantMsgIdRef.current = cm.id;
          }
          appendedBubbles.push({
            id: `msg-consultant-${cm.id}`,
            dbId: cm.id,
            sender: 'ia',
            text: cm.content,
            timestamp: new Date(cm.createdAt).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            isHumanConsultant: true,
            senderLabel: cm.senderLabel || 'Consultor da Loja',
          });
          latestToast = {
            id: `toast-cm-${cm.id}`,
            title: cm.senderLabel || `Consultor · ${settings.tradeName}`,
            body: cm.content.slice(0, 140),
          };
        }

        for (const bc of newBroadcasts) {
          if (bc.id > lastBroadcastIdRef.current) {
            lastBroadcastIdRef.current = bc.id;
          }
          const formattedText = bc.title
            ? `**${bc.title}**\n\n${bc.message}`
            : bc.message;
          appendedBubbles.push({
            id: `msg-broadcast-${bc.id}`,
            broadcastId: bc.id,
            sender: 'ia',
            text: formattedText,
            timestamp: new Date(bc.createdAt).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            isHumanConsultant: true,
            senderLabel: bc.title || `Aviso · ${settings.tradeName}`,
          });
          latestToast = {
            id: `toast-bc-${bc.id}`,
            title: bc.title || `Aviso da ${settings.tradeName}`,
            body: bc.message.slice(0, 140),
          };
        }

        if (lastBroadcastIdRef.current > 0) {
          try {
            window.localStorage.setItem(
              `${LAST_BROADCAST_KEY_PREFIX}${persistStorageKey}`,
              String(lastBroadcastIdRef.current)
            );
          } catch {
            // Ignore storage errors
          }
        }

        if (appendedBubbles.length > 0 && !cancelled) {
          userMutatedRef.current = true;
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const uniqueNew = appendedBubbles.filter(
              (m) => !existingIds.has(m.id)
            );
            if (uniqueNew.length === 0) return prev;
            return [...prev, ...uniqueNew];
          });

          if (latestToast) {
            setIncomingNotification(latestToast);
            playSubtleChime();
            if (
              typeof window !== 'undefined' &&
              'Notification' in window &&
              Notification.permission === 'granted' &&
              document.hidden
            ) {
              try {
                new Notification(latestToast.title, {
                  body: latestToast.body,
                  icon: '/pwa-192x192.png',
                });
              } catch {
                // Ignore browser notification exceptions
              }
            }
          }
        }
      } catch {
        // Silent polling failure
      }
    };

    const initialTimeout = window.setTimeout(() => void pollUpdates(), 2500);
    const intervalId = window.setInterval(() => void pollUpdates(), 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(initialTimeout);
      window.clearInterval(intervalId);
    };
  }, [active, persistStorageKey, settings.tradeName, targetVehicle]);

  const resetConversation = useCallback(() => {
    abortControllerRef.current?.abort();
    storageVersionRef.current += 1;
    userMutatedRef.current = true;

    if (persistStorageKey) {
      clearLocalChatState(persistStorageKey);
    }

    updateSessionId(createChatSessionId());
    lastConsultantMsgIdRef.current = 0;
    setIsSending(false);
    setIsProcessingAudio(false);
    setActiveAudioMessageId(null);
    setHasStreamFirstToken(false);
    setInput('');
    setReplyingTo(null);
    setErrorMsg(null);
    setIncomingNotification(null);
    setLeadSaved(false);
    setLeadSaveError(null);
    setLgpdConsent(false);
    setPersistedLeadId(null);
    persistedLeadIdRef.current = null;
    customerNameRef.current = '';
    customerWhatsappRef.current = '';
    setCustomerName('');
    setCustomerWhatsapp('');
    activeFiltersRef.current = {};
    recentVehicleIdsRef.current = [];
    focusedVehicleIdRef.current = null;
    compareVehicleIdsRef.current = [];
    setActiveFilters({});
    setRecentVehicleIds([]);
    setFocusedVehicleId(null);
    setCompareVehicleIds([]);
    setLastFailedSend(null);
    setMessages([createWelcomeMessage(settings.tradeName)]);
    storageReadyRef.current = true;
  }, [persistStorageKey, settings.tradeName, updateSessionId]);

  const sendRichMessage = useCallback(
    (payload: SendRichMessagePayload) => {
      if (isSending) return;
      const trimmedText = (payload.text || '').trim();
      const hasAudio = Boolean(payload.audio);
      const hasAttachment = Boolean(payload.attachment);
      if (!trimmedText && !hasAudio && !hasAttachment) return;

      const effectiveReply =
        payload.replyTo !== undefined ? payload.replyTo : replyingTo;

      const userMsgId = `msg-cli-${Date.now()}`;
      const userMsg: ChatMessage = {
        id: userMsgId,
        sender: 'cliente',
        text: trimmedText,
        timestamp: nowTimePt(),
        ...(effectiveReply ? { replyTo: effectiveReply } : {}),
        ...(payload.audio ? { audio: payload.audio } : {}),
        ...(payload.attachment ? { attachment: payload.attachment } : {}),
      };

      // 2-Step Conversational Triage (Zero Gemini tokens consumed!)
      if (persistStorageKey && !targetVehicle && triageStage !== 'complete') {
        userMutatedRef.current = true;
        setInput('');
        setReplyingTo(null);

        if (triageStage === 'ask_name') {
          const extractedName = extractTriageName(trimmedText);
          if (!extractedName) {
            const retryBubble: ChatMessage = {
              id: `msg-ia-triage-name-retry-${Date.now()}`,
              sender: 'ia',
              text: 'Para começarmos, pode digitar apenas o seu **nome**?',
              timestamp: nowTimePt(),
            };
            const nextMsgs = [...messages, userMsg, retryBubble];
            setMessages(nextMsgs);
            return;
          }

          customerNameRef.current = extractedName;
          setCustomerName(extractedName);
          void syncVisitorIdentityToServer(extractedName);

          const askPhoneBubble = createTriageAskPhoneMessage(extractedName);
          const nextMsgs = [...messages, userMsg, askPhoneBubble];
          setMessages(nextMsgs);
          saveLocalChatState(persistStorageKey, {
            version: 1,
            sessionId: sessionIdRef.current,
            messages: nextMsgs,
            leadSaved,
            persistedLeadId: persistedLeadIdRef.current,
            customerName: extractedName,
            customerWhatsapp: customerWhatsappRef.current,
            updatedAt: Date.now(),
          });
          return;
        }

        if (triageStage === 'ask_phone') {
          const validPhone = extractValidBrazilianPhone(trimmedText);
          if (!validPhone) {
            const retryPhoneBubble = createTriageInvalidPhoneMessage(
              customerNameRef.current || 'visitante'
            );
            const nextMsgs = [...messages, userMsg, retryPhoneBubble];
            setMessages(nextMsgs);
            return;
          }

          customerWhatsappRef.current = validPhone;
          setCustomerWhatsapp(validPhone);
          setLgpdConsent(true);
          void syncVisitorIdentityToServer(
            customerNameRef.current,
            validPhone
          );

          const completeBubble = createTriageCompleteMessage(
            settings.tradeName,
            customerNameRef.current
          );
          const nextMsgs = [...messages, userMsg, completeBubble];
          setMessages(nextMsgs);
          saveLocalChatState(persistStorageKey, {
            version: 1,
            sessionId: sessionIdRef.current,
            messages: nextMsgs,
            leadSaved,
            persistedLeadId: persistedLeadIdRef.current,
            customerName: customerNameRef.current,
            customerWhatsapp: validPhone,
            updatedAt: Date.now(),
          });
          return;
        }
      }

      // If another person explicitly introduces a different name in the same browser,
      // isolate into a brand-new session_id and ask for their WhatsApp cleanly.
      const switchedUserName =
        persistStorageKey && !targetVehicle && trimmedText
          ? detectExplicitDifferentUserName(trimmedText, customerNameRef.current)
          : null;

      let nextMessages: ChatMessage[];
      let effectiveCustomerName = customerNameRef.current;
      let effectiveLeadSaved = leadSaved;
      let effectivePersistedLeadId = persistedLeadIdRef.current;
      let effectiveCustomerWhatsapp = customerWhatsappRef.current;

      if (switchedUserName) {
        if (persistStorageKey) {
          clearLocalChatState(persistStorageKey);
        }
        storageVersionRef.current += 1;
        updateSessionId(createChatSessionId());
        lastConsultantMsgIdRef.current = 0;
        effectiveCustomerName = switchedUserName;
        effectiveLeadSaved = false;
        effectivePersistedLeadId = null;
        effectiveCustomerWhatsapp = '';

        customerNameRef.current = switchedUserName;
        customerWhatsappRef.current = '';
        persistedLeadIdRef.current = null;
        setCustomerName(switchedUserName);
        setCustomerWhatsapp('');
        setLeadSaved(false);
        setLeadSaveError(null);
        setLgpdConsent(false);
        setPersistedLeadId(null);

        void syncVisitorIdentityToServer(switchedUserName);
        const askPhoneBubble = createTriageAskPhoneMessage(switchedUserName);
        nextMessages = [
          createTriageAskNameMessage(settings.tradeName),
          { ...userMsg, replyTo: undefined },
          askPhoneBubble,
        ];
        userMutatedRef.current = true;
        setMessages(nextMessages);
        setInput('');
        setReplyingTo(null);
        if (persistStorageKey) {
          saveLocalChatState(persistStorageKey, {
            version: 1,
            sessionId: sessionIdRef.current,
            messages: nextMessages,
            leadSaved: false,
            persistedLeadId: null,
            customerName: switchedUserName,
            customerWhatsapp: '',
            updatedAt: Date.now(),
          });
        }
        return;
      }

      nextMessages = [...messages, userMsg];
      userMutatedRef.current = true;
      setMessages(nextMessages);
      setInput('');
      setReplyingTo(null);

      if (persistStorageKey && !targetVehicle) {
        saveLocalChatState(persistStorageKey, {
          version: 1,
          sessionId: sessionIdRef.current,
          messages: nextMessages,
          leadSaved: effectiveLeadSaved,
          persistedLeadId: effectivePersistedLeadId,
          customerName: effectiveCustomerName,
          customerWhatsapp: effectiveCustomerWhatsapp,
          updatedAt: Date.now(),
        });
      }

      if (effectivePersistedLeadId && onSyncLeadChat) {
        void onSyncLeadChat(
          effectivePersistedLeadId,
          buildLightweightLeadHistory(nextMessages)
        );
      }

      void sendMessageToAi(nextMessages, targetVehicle, {
        userMessageId: userMsgId,
        replyTo: effectiveReply ?? null,
        audio: payload.audio ?? null,
        attachment: payload.attachment ?? null,
      });
    },
    [
      isSending,
      leadSaved,
      messages,
      onSyncLeadChat,
      persistStorageKey,
      replyingTo,
      sendMessageToAi,
      settings.tradeName,
      syncVisitorIdentityToServer,
      targetVehicle,
      triageStage,
      updateSessionId,
    ]
  );

  const sendQuickPrompt = useCallback(
    (promptText: string) => {
      sendRichMessage({ text: promptText, replyTo: null });
    },
    [sendRichMessage]
  );

  const handleSend = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isSending) return;
      sendRichMessage({ text: trimmed });
    },
    [input, isSending, sendRichMessage]
  );

  const handleSaveContactToCrm = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!customerName.trim() || !customerWhatsapp.trim() || isSavingLead) return;
      if (!lgpdConsent) {
        setLeadSaveError(
          'Marque a caixa de consentimento (LGPD) para autorizar o contato comercial.'
        );
        return;
      }

      setIsSavingLead(true);
      setLeadSaveError(null);

      const newLead: Lead = {
        id: `lead-web-${Date.now()}`,
        name: customerName.trim(),
        whatsapp: customerWhatsapp.trim(),
        email: '',
        cpf: '',
        rg: '',
        address: '',
        city: `${settings.city} - ${settings.state}`,
        vehicleInterestId: targetVehicle?.id || '',
        vehicleInterestLabel: targetVehicle
          ? `${targetVehicle.brand} ${targetVehicle.model} ${targetVehicle.year}`
          : 'Atendimento Consultor IA',
        stage: 'Novo Lead',
        source: leadSourceLabel,
        createdAt: 'Agora',
        lastActivity: 'Agora',
        notes: leadNote,
        lgpdConsent: true,
        chatSessionId: sessionIdRef.current,
        chatHistory: buildLightweightLeadHistory(messages),
      };

      try {
        const savedLead = await onCaptureLead(newLead);
        setPersistedLeadId(savedLead.id);
        persistedLeadIdRef.current = savedLead.id;
        setLeadSaved(true);
      } catch (err: unknown) {
        setLeadSaveError(
          err instanceof Error
            ? err.message
            : 'Não foi possível registrar seu interesse. Tente novamente.'
        );
      } finally {
        setIsSavingLead(false);
      }
    },
    [
      customerName,
      customerWhatsapp,
      isSavingLead,
      leadNote,
      leadSourceLabel,
      lgpdConsent,
      messages,
      onCaptureLead,
      settings.city,
      settings.state,
      targetVehicle,
    ]
  );

  const toggleCompareVehicle = useCallback((vehicleId: string) => {
    setCompareVehicleIds((prev) => {
      const next = prev.includes(vehicleId)
        ? prev.filter((id) => id !== vehicleId)
        : [...prev.slice(-2), vehicleId];
      compareVehicleIdsRef.current = next;
      return next;
    });
  }, []);

  const clearCompareVehicles = useCallback(() => {
    compareVehicleIdsRef.current = [];
    setCompareVehicleIds([]);
  }, []);

  const compareSelectedVehicles = useCallback(() => {
    const ids = compareVehicleIdsRef.current;
    if (ids.length < 2) return;
    const labels = ids
      .map((id) => {
        const found = vehicles.find((v) => v.id === id);
        return found ? `${found.brand} ${found.model} ${found.year} (#${found.id})` : `#${id}`;
      })
      .join(' e ');
    sendQuickPrompt(`Compare ${labels}`);
    clearCompareVehicles();
  }, [clearCompareVehicles, sendQuickPrompt, vehicles]);

  const clearActiveFilters = useCallback(() => {
    activeFiltersRef.current = {};
    setActiveFilters({});
    sendQuickPrompt('Limpar filtros e ver todo o estoque disponível');
  }, [sendQuickPrompt]);

  const retryLastMessage = useCallback(() => {
    if (!lastFailedSend || isSending) return;
    setErrorMsg(null);
    void sendMessageToAi(
      lastFailedSend.messages,
      targetVehicle,
      lastFailedSend.options
    );
  }, [isSending, lastFailedSend, sendMessageToAi, targetVehicle]);

  return {
    sessionId,
    messages,
    input,
    setInput,
    replyingTo,
    setReplyingTo,
    clearReply,
    isSending,
    isProcessingAudio,
    activeAudioMessageId,
    hasStreamFirstToken,
    errorMsg,
    setErrorMsg,
    canRetry: Boolean(lastFailedSend),
    retryLastMessage,
    activeFilters,
    recentVehicleIds,
    focusedVehicleId,
    compareVehicleIds,
    toggleCompareVehicle,
    clearCompareVehicles,
    compareSelectedVehicles,
    clearActiveFilters,
    customerName,
    setCustomerName,
    customerWhatsapp,
    setCustomerWhatsapp,
    triageStage,
    incomingNotification,
    dismissIncomingNotification,
    lgpdConsent,
    setLgpdConsent,
    isSavingLead,
    leadSaveError,
    leadSaved,
    messagesEndRef,
    sendRichMessage,
    sendQuickPrompt,
    handleSend,
    handleSaveContactToCrm,
    resetConversation,
  };
}
