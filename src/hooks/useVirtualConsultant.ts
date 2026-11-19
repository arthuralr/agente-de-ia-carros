import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChatAttachment,
  ChatAudioMeta,
  ChatMessage,
  ChatReplyContext,
  DealershipSettings,
  Lead,
  Vehicle,
} from '../types';
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

function createChatSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `sess-${Date.now().toString(36)}-${rand}`;
}

function createWelcomeMessage(tradeName: string): ChatMessage {
  const now = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return {
    id: `msg-ia-welcome-${Date.now()}`,
    sender: 'ia',
    text: `Olá! Sou o **Consultor Oficial** da **${tradeName}**. Todos os nossos seminovos contam com **laudo cautelar 100% aprovado** e **garantia de 90 dias (CDC)**.

Antes de começarmos, **como posso te chamar?** Se preferir, já pode tocar em uma opção abaixo ou **enviar sua dúvida por texto, áudio ou foto** direto!`,
    timestamp: now,
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

function createIdentifiedWelcomeMessage(
  tradeName: string,
  leadName: string
): ChatMessage {
  const now = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const firstName = getFirstName(leadName);
  return {
    id: `msg-ia-welcome-${Date.now()}`,
    sender: 'ia',
    text: `Olá, **${firstName}**! Seja bem-vindo(a) à **${tradeName}**. Todos os nossos seminovos contam com **laudo cautelar 100% aprovado** e **garantia de 90 dias (CDC)**.

Como posso te ajudar hoje? Toque em uma opção abaixo ou **envie sua dúvida por texto, áudio ou foto** direto!`,
    timestamp: now,
  };
}

function createReturningWelcomeMessage(
  tradeName: string,
  leadName: string
): ChatMessage {
  const now = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const firstName = getFirstName(leadName);
  return {
    id: `msg-ia-return-welcome-${Date.now()}`,
    sender: 'ia',
    text: `Olá novamente, **${firstName}**! Que bom ter você de volta à **${tradeName}**.

Em que posso ajudar hoje? Escolha uma opção rápida abaixo ou **envie sua dúvida por texto, áudio ou foto** direto!`,
    timestamp: now,
  };
}

/**
 * Adapts restored chat history for a returning identified visitor:
 * - Removes any previous "como posso te chamar?" prompt from the opening bubble.
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

  // Only a welcome bubble existed so far -> replace with personalized returning greeting
  if (
    history.length === 1 &&
    history[0].sender === 'ia' &&
    (history[0].id.startsWith('msg-ia-welcome') ||
      history[0].id.startsWith('msg-ia-return-welcome'))
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

/**
 * Detects when a visitor explicitly introduces a DIFFERENT person's name
 * (e.g., "Me chamo Camila" while browser was linked to "Pedro") so we isolate
 * the session and never mix conversations of different people.
 */
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

/**
 * Strips heavy inline base64 media URLs before syncing to leads.chat_history,
 * since full audio/attachments are persisted in chat_messages.
 */
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
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [lgpdConsent, setLgpdConsent] = useState(false);
  const [isSavingLead, setIsSavingLead] = useState(false);
  const [leadSaveError, setLeadSaveError] = useState<string | null>(null);
  const [leadSaved, setLeadSaved] = useState(false);
  const [persistedLeadId, setPersistedLeadId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastTriggerRef = useRef<string | null>(null);
  const persistedLeadIdRef = useRef<string | null>(null);
  const customerNameRef = useRef<string>(customerName);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(createChatSessionId());
  const storageReadyRef = useRef<boolean>(false);
  const storageVersionRef = useRef<number>(0);
  const userMutatedRef = useRef<boolean>(false);

  useEffect(() => {
    persistedLeadIdRef.current = persistedLeadId;
  }, [persistedLeadId]);

  useEffect(() => {
    customerNameRef.current = customerName;
  }, [customerName]);

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
              whatsapp: settings.whatsapp,
              hoursWeekdays: settings.hoursWeekdays,
              hoursSaturday: settings.hoursSaturday,
              aiAssistantName: settings.aiAssistantName,
            },
          }),
        });

        const contentType = response.headers.get('content-type') || '';

        if (!response.ok) {
          const errData = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(errData.error || 'Erro ao responder mensagem.');
        }

        const aiMsgId = `msg-ia-${Date.now()}`;
        const aiTimestamp = new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        });

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

        if (!contentType.includes('text/event-stream') || !response.body) {
          const data = (await response.json()) as {
            reply: string;
            transcription?: string;
            visitorName?: string;
          };
          if (data.transcription) {
            applyTranscriptionToUserMsg(data.transcription);
          }
          if (data.visitorName?.trim() && !customerNameRef.current.trim()) {
            const cleanName = data.visitorName.trim();
            customerNameRef.current = cleanName;
            setCustomerName(cleanName);
          }
          const aiMsg: ChatMessage = {
            id: aiMsgId,
            sender: 'ia',
            text: data.reply,
            timestamp: aiTimestamp,
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
          };
          if (!streamMessageInserted) {
            streamMessageInserted = true;
            setHasStreamFirstToken(true);
            setMessages((prev) => [...prev, streamingMsg]);
          } else {
            setMessages((prev) =>
              prev.map((m) => (m.id === aiMsgId ? { ...m, text } : m))
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
              const parsed = JSON.parse(jsonStr) as {
                type: 'meta' | 'chunk' | 'done' | 'error';
                text?: string;
                reply?: string;
                transcription?: string;
                visitorName?: string;
                error?: string;
              };

              if (parsed.type === 'meta') {
                if (parsed.transcription) {
                  applyTranscriptionToUserMsg(parsed.transcription);
                }
                if (
                  parsed.visitorName?.trim() &&
                  !customerNameRef.current.trim()
                ) {
                  const cleanName = parsed.visitorName.trim();
                  customerNameRef.current = cleanName;
                  setCustomerName(cleanName);
                }
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
        if (didTimeout) {
          setErrorMsg(
            hasAudioPayload
              ? 'O processamento do áudio demorou mais que o esperado. Tente enviar um áudio mais curto ou escreva sua mensagem por texto.'
              : 'O atendimento demorou mais que o esperado. Tente enviar sua mensagem novamente.'
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
              : 'Não foi possível conectar ao assistente de IA.'
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
      sessionIdRef.current = createChatSessionId();
      setLeadSaved(false);
      setLeadSaveError(null);
      setLgpdConsent(false);
      setPersistedLeadId(null);
      setReplyingTo(null);
      persistedLeadIdRef.current = null;
      setErrorMsg(null);

      const now = new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const autoUserMsg: ChatMessage = {
        id: `msg-cli-${Date.now()}`,
        sender: 'cliente',
        text: `Olá! Tenho interesse no **${targetVehicle.brand} ${targetVehicle.model} ${targetVehicle.version}** (**${targetVehicle.year}** · **${formatBRL(targetVehicle.price)}**). Ele está disponível para visita e financiamento?`,
        timestamp: now,
      };
      setMessages([autoUserMsg]);
      void sendMessageToAi([autoUserMsg], targetVehicle, {
        userMessageId: autoUserMsg.id,
      });
      return;
    }

    if (persistStorageKey) {
      const savedSync = loadLocalChatStateSync(persistStorageKey);
      let activeSessionId: string;
      let initialKnownName = '';

      if (savedSync && savedSync.messages.length > 0) {
        activeSessionId = savedSync.sessionId;
        sessionIdRef.current = savedSync.sessionId;
        initialKnownName = (savedSync.customerName || '').trim();

        const restoredMessages = initialKnownName
          ? personalizeRestoredHistory(
              savedSync.messages,
              settings.tradeName,
              initialKnownName
            )
          : savedSync.messages;

        setMessages(restoredMessages);
        setLeadSaved(Boolean(savedSync.leadSaved));
        setPersistedLeadId(savedSync.persistedLeadId ?? null);
        persistedLeadIdRef.current = savedSync.persistedLeadId ?? null;
        customerNameRef.current = initialKnownName;
        setCustomerName(initialKnownName);
        setCustomerWhatsapp(savedSync.customerWhatsapp || '');
        setLeadSaveError(null);
        setReplyingTo(null);
        setErrorMsg(null);
        storageReadyRef.current = true;
      } else {
        activeSessionId = createChatSessionId();
        sessionIdRef.current = activeSessionId;
        setLeadSaved(false);
        setLeadSaveError(null);
        setLgpdConsent(false);
        setPersistedLeadId(null);
        setReplyingTo(null);
        persistedLeadIdRef.current = null;
        customerNameRef.current = '';
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

        if (savedSync) {
          if (
            savedAsync.sessionId === savedSync.sessionId &&
            savedAsync.messages.length >= savedSync.messages.length
          ) {
            const hydrated = resolvedName
              ? personalizeRestoredHistory(
                  savedAsync.messages,
                  settings.tradeName,
                  resolvedName
                )
              : savedAsync.messages;
            setMessages(hydrated);
            if (resolvedName && !customerNameRef.current) {
              customerNameRef.current = resolvedName;
              setCustomerName(resolvedName);
            }
          }
        } else {
          sessionIdRef.current = savedAsync.sessionId;
          const hydrated = resolvedName
            ? personalizeRestoredHistory(
                savedAsync.messages,
                settings.tradeName,
                resolvedName
              )
            : savedAsync.messages;
          setMessages(hydrated);
          setLeadSaved(Boolean(savedAsync.leadSaved));
          setPersistedLeadId(savedAsync.persistedLeadId ?? null);
          persistedLeadIdRef.current = savedAsync.persistedLeadId ?? null;
          customerNameRef.current = resolvedName;
          setCustomerName(resolvedName);
          setCustomerWhatsapp(savedAsync.customerWhatsapp || '');
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
              if (serverName && !customerNameRef.current.trim()) {
                customerNameRef.current = serverName;
                setCustomerName(serverName);
                setMessages((prev) =>
                  personalizeRestoredHistory(prev, settings.tradeName, serverName)
                );
              }
              if (serverPhone) {
                setCustomerWhatsapp((prev) => prev || serverPhone);
                setLeadSaved(true);
              }
            }
          )
          .catch(() => {
            // Silent fallback when offline or unavailable
          });
      }
      return;
    }

    sessionIdRef.current = createChatSessionId();
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

  const resetConversation = useCallback(() => {
    abortControllerRef.current?.abort();
    storageVersionRef.current += 1;
    userMutatedRef.current = true;

    if (persistStorageKey) {
      clearLocalChatState(persistStorageKey);
    }

    sessionIdRef.current = createChatSessionId();
    setIsSending(false);
    setIsProcessingAudio(false);
    setActiveAudioMessageId(null);
    setHasStreamFirstToken(false);
    setInput('');
    setReplyingTo(null);
    setErrorMsg(null);
    setLeadSaved(false);
    setLeadSaveError(null);
    setLgpdConsent(false);
    setPersistedLeadId(null);
    persistedLeadIdRef.current = null;
    customerNameRef.current = '';
    setCustomerName('');
    setCustomerWhatsapp('');
    setMessages([createWelcomeMessage(settings.tradeName)]);
    storageReadyRef.current = true;
  }, [persistStorageKey, settings.tradeName]);

  const completeInitialIdentification = useCallback(
    async (rawName: string, rawPhone?: string): Promise<void> => {
      const cleanName = rawName.replace(/\s+/g, ' ').trim().slice(0, 120);
      if (cleanName.length < 2) return;

      const cleanPhone = (rawPhone || '').trim().slice(0, 40);
      const phoneDigits = cleanPhone.replace(/\D/g, '');
      const validPhone = phoneDigits.length >= 8 ? cleanPhone : '';

      setIsIdentifying(true);
      try {
        try {
          await fetch('/api/public/chat-session/identify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: sessionIdRef.current,
              leadName: cleanName,
              leadPhone: validPhone || undefined,
              origem: originLabel,
            }),
          });
        } catch {
          // Graceful fallback if offline; local state still persists
        }

        userMutatedRef.current = true;
        customerNameRef.current = cleanName;
        setCustomerName(cleanName);
        if (validPhone) {
          setCustomerWhatsapp(validPhone);
        }

        const personalizedWelcome = createIdentifiedWelcomeMessage(
          settings.tradeName,
          cleanName
        );
        let nextMessagesForStorage: ChatMessage[] = [personalizedWelcome];

        setMessages((prev) => {
          if (
            prev.length === 0 ||
            (prev.length === 1 &&
              prev[0].sender === 'ia' &&
              prev[0].id.startsWith('msg-ia-welcome'))
          ) {
            nextMessagesForStorage = [personalizedWelcome];
            return nextMessagesForStorage;
          }
          nextMessagesForStorage = prev;
          return prev;
        });

        if (persistStorageKey && !targetVehicle) {
          saveLocalChatState(persistStorageKey, {
            version: 1,
            sessionId: sessionIdRef.current,
            messages: nextMessagesForStorage,
            leadSaved,
            persistedLeadId: persistedLeadIdRef.current,
            customerName: cleanName,
            customerWhatsapp: validPhone || customerWhatsapp,
            updatedAt: Date.now(),
          });
        }
      } finally {
        setIsIdentifying(false);
      }
    },
    [
      customerWhatsapp,
      leadSaved,
      originLabel,
      persistStorageKey,
      settings.tradeName,
      targetVehicle,
    ]
  );

  const needsInitialIdentification = Boolean(
    persistStorageKey && !targetVehicle && !customerName.trim()
  );

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
        timestamp: new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        ...(effectiveReply ? { replyTo: effectiveReply } : {}),
        ...(payload.audio ? { audio: payload.audio } : {}),
        ...(payload.attachment ? { attachment: payload.attachment } : {}),
      };

      // If another person explicitly introduces a different name in the same browser,
      // clear the previous identity link and isolate into a brand-new session_id.
      const switchedUserName =
        persistStorageKey && !targetVehicle && trimmedText
          ? detectExplicitDifferentUserName(trimmedText, customerNameRef.current)
          : null;

      let nextMessages: ChatMessage[];
      let effectiveCustomerName = customerNameRef.current;
      let effectiveLeadSaved = leadSaved;
      let effectivePersistedLeadId = persistedLeadIdRef.current;
      let effectiveCustomerWhatsapp = customerWhatsapp;

      if (switchedUserName) {
        if (persistStorageKey) {
          clearLocalChatState(persistStorageKey);
        }
        storageVersionRef.current += 1;
        sessionIdRef.current = createChatSessionId();
        effectiveCustomerName = switchedUserName;
        effectiveLeadSaved = false;
        effectivePersistedLeadId = null;
        effectiveCustomerWhatsapp = '';

        customerNameRef.current = switchedUserName;
        persistedLeadIdRef.current = null;
        setCustomerName(switchedUserName);
        setCustomerWhatsapp('');
        setLeadSaved(false);
        setLeadSaveError(null);
        setLgpdConsent(false);
        setPersistedLeadId(null);

        nextMessages = [
          createWelcomeMessage(settings.tradeName),
          { ...userMsg, replyTo: undefined },
        ];
      } else {
        nextMessages = [...messages, userMsg];
      }

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
        replyTo: switchedUserName ? null : (effectiveReply ?? null),
        audio: payload.audio ?? null,
        attachment: payload.attachment ?? null,
      });
    },
    [
      customerWhatsapp,
      isSending,
      leadSaved,
      messages,
      onSyncLeadChat,
      persistStorageKey,
      replyingTo,
      sendMessageToAi,
      settings.tradeName,
      targetVehicle,
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

  return {
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
    customerName,
    setCustomerName,
    customerWhatsapp,
    setCustomerWhatsapp,
    needsInitialIdentification,
    isIdentifying,
    completeInitialIdentification,
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
