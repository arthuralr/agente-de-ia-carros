import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChatMessage,
  DealershipSettings,
  Lead,
  Vehicle,
} from '../types';
import { formatBRL, formatKm } from '../utils/formatters';

interface UseVirtualConsultantParams {
  active: boolean;
  targetVehicle: Vehicle | null;
  vehicles: Vehicle[];
  settings: DealershipSettings;
  leadSourceLabel?: Lead['source'];
  leadNote?: string;
  onCaptureLead: (lead: Lead) => Promise<Lead>;
  onSyncLeadChat?: (leadId: string, chatHistory: ChatMessage[]) => Promise<void>;
}

export function useVirtualConsultant({
  active,
  targetVehicle,
  vehicles,
  settings,
  leadSourceLabel = 'Chat IA do Site',
  leadNote = 'Lead capturado pelo Consultor Virtual de IA.',
  onCaptureLead,
  onSyncLeadChat,
}: UseVirtualConsultantParams) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [hasStreamFirstToken, setHasStreamFirstToken] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState('');
  const [customerWhatsapp, setCustomerWhatsapp] = useState('');
  const [isSavingLead, setIsSavingLead] = useState(false);
  const [leadSaveError, setLeadSaveError] = useState<string | null>(null);
  const [leadSaved, setLeadSaved] = useState(false);
  const [persistedLeadId, setPersistedLeadId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastTriggerRef = useRef<string | null>(null);
  const persistedLeadIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    persistedLeadIdRef.current = persistedLeadId;
  }, [persistedLeadId]);

  useEffect(() => {
    if (!active) {
      abortControllerRef.current?.abort();
    }
  }, [active]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const sendMessageToAi = useCallback(
    async (nextMessages: ChatMessage[], vehicleContext: Vehicle | null) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsSending(true);
      setHasStreamFirstToken(false);
      setErrorMsg(null);

      try {
        const inventorySummary = vehicles
          .filter((v) => v.status !== 'Vendido')
          .map(
            (v) =>
              `${v.brand} ${v.model} ${v.version} (${v.year}, ${formatKm(v.km)}, ${formatBRL(v.price)})`
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
            messages: nextMessages.map((m) => ({
              sender: m.sender,
              text: m.text,
            })),
            vehicle: vehicleContext
              ? {
                  brand: vehicleContext.brand,
                  model: vehicleContext.model,
                  version: vehicleContext.version,
                  year: vehicleContext.year,
                  km: vehicleContext.km,
                  price: vehicleContext.price,
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

        if (!contentType.includes('text/event-stream') || !response.body) {
          const data = (await response.json()) as { reply: string };
          const aiMsg: ChatMessage = {
            id: aiMsgId,
            sender: 'ia',
            text: data.reply,
            timestamp: aiTimestamp,
          };
          const updatedTranscript = [...nextMessages, aiMsg];
          setMessages(updatedTranscript);
          if (persistedLeadIdRef.current && onSyncLeadChat) {
            void onSyncLeadChat(persistedLeadIdRef.current, updatedTranscript);
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
            setMessages([...nextMessages, streamingMsg]);
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
                type: 'chunk' | 'done' | 'error';
                text?: string;
                reply?: string;
                error?: string;
              };

              if (parsed.type === 'chunk' && parsed.text) {
                accumulatedText += parsed.text;
                upsertStreamingMessage(accumulatedText);
              } else if (parsed.type === 'done') {
                const finalText = (parsed.reply || accumulatedText).trim();
                if (finalText) {
                  upsertStreamingMessage(finalText);
                  const updatedTranscript: ChatMessage[] = [
                    ...nextMessages,
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
                      updatedTranscript
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
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Não foi possível conectar ao assistente de IA.'
        );
      } finally {
        setIsSending(false);
        setHasStreamFirstToken(false);
      }
    },
    [onSyncLeadChat, settings, vehicles]
  );

  // Initialize greeting or auto-inquiry when opened
  useEffect(() => {
    if (!active) return;

    const triggerKey = targetVehicle ? targetVehicle.id : 'general';
    if (lastTriggerRef.current === triggerKey && messages.length > 0) {
      return;
    }

    lastTriggerRef.current = triggerKey;
    setLeadSaved(false);
    setLeadSaveError(null);
    setPersistedLeadId(null);
    persistedLeadIdRef.current = null;
    setErrorMsg(null);

    const now = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    if (targetVehicle) {
      const autoUserMsg: ChatMessage = {
        id: `msg-cli-${Date.now()}`,
        sender: 'cliente',
        text: `Olá! Tenho interesse no **${targetVehicle.brand} ${targetVehicle.model} ${targetVehicle.version}** (**${targetVehicle.year}** · **${formatBRL(targetVehicle.price)}**). Ele está disponível para visita e financiamento?`,
        timestamp: now,
      };
      setMessages([autoUserMsg]);
      void sendMessageToAi([autoUserMsg], targetVehicle);
    } else {
      setMessages([
        {
          id: `msg-ia-welcome-${Date.now()}`,
          sender: 'ia',
          text: `Olá! Sou o **Consultor Oficial** da **${settings.tradeName}**. Todos os nossos seminovos contam com **laudo cautelar 100% aprovado** e **garantia de 90 dias (CDC)**.

Como posso ajudar na sua escolha hoje?
- Consultar disponibilidade, detalhes e preços reais do estoque
- Simular **financiamento bancário** ou carta de crédito
- Avaliar seu **usado na troca** ou agendar visita no showroom

Qual modelo você procura ou gostaria de receber uma simulação pelo WhatsApp?`,
          timestamp: now,
        },
      ]);
    }
  }, [active, messages.length, sendMessageToAi, settings.tradeName, targetVehicle]);

  const sendQuickPrompt = useCallback(
    (promptText: string) => {
      if (isSending) return;
      const userMsg: ChatMessage = {
        id: `msg-cli-${Date.now()}`,
        sender: 'cliente',
        text: promptText,
        timestamp: new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      if (persistedLeadIdRef.current && onSyncLeadChat) {
        void onSyncLeadChat(persistedLeadIdRef.current, nextMessages);
      }
      void sendMessageToAi(nextMessages, targetVehicle);
    },
    [isSending, messages, onSyncLeadChat, sendMessageToAi, targetVehicle]
  );

  const handleSend = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isSending) return;

      const userMsg: ChatMessage = {
        id: `msg-cli-${Date.now()}`,
        sender: 'cliente',
        text: trimmed,
        timestamp: new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };

      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setInput('');
      if (persistedLeadIdRef.current && onSyncLeadChat) {
        void onSyncLeadChat(persistedLeadIdRef.current, nextMessages);
      }
      void sendMessageToAi(nextMessages, targetVehicle);
    },
    [input, isSending, messages, onSyncLeadChat, sendMessageToAi, targetVehicle]
  );

  const handleSaveContactToCrm = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!customerName.trim() || !customerWhatsapp.trim() || isSavingLead) return;

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
        chatHistory: messages,
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
    isSending,
    hasStreamFirstToken,
    errorMsg,
    customerName,
    setCustomerName,
    customerWhatsapp,
    setCustomerWhatsapp,
    isSavingLead,
    leadSaveError,
    leadSaved,
    messagesEndRef,
    sendQuickPrompt,
    handleSend,
    handleSaveContactToCrm,
  };
}
