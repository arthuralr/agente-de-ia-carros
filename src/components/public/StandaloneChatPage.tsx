import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BellRing,
  CalendarClock,
  Camera,
  Car,
  Check,
  CheckCheck,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Filter,
  GitCompareArrows,
  Headset,
  Image as ImageIcon,
  Loader2,
  MapPin,
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
  RefreshCw,
  Reply,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import {
  ChatAttachment,
  ChatMessage,
  ChatReplyContext,
  DealershipSettings,
  Lead,
  Vehicle,
  VehicleCardData,
} from '../../types';
import { formatBrazilianPhone } from '../../utils/chatTags';
import {
  buildWhatsAppHandoffUrl,
  detectHumanHandoffIntent,
  HandoffPurpose,
} from '../../utils/whatsappHandoff';
import {
  AUDIO_CAPTURE_CONSTRAINTS,
  AUDIO_RECORDING_BITRATE,
  blobToDataUrl,
  formatBytesCompact,
  formatDurationSeconds,
  MAX_AUDIO_DURATION_SEC,
  MAX_AUDIO_RAW_BYTES,
  pickSupportedAudioMimeType,
  prepareChatAttachment,
  stripMarkdownForPreview,
} from '../../utils/chatMedia';
import {
  analyzeVehicleDataQuality,
  buildDealershipMapsUrl,
  checkVehicleAgainstFilters,
  formatBrlCurrency,
  formatDealershipAddress,
  formatDealershipHours,
  formatKmBr,
  getVehicleDisplayTitle,
  resolvePublicStorefrontLinks,
} from '../../utils/vehicleDomain';
import { ApiVehicleRow, mapDbVehicleToFrontend } from '../../db/mappers';
import { useVirtualConsultant } from '../../hooks/useVirtualConsultant';
import { useWebPush } from '../../hooks/useWebPush';
import { ChatMarkdown } from './ChatMarkdown';
import {
  ChatComparisonBlock,
  ChatFinancingBlock,
  ChatVehicleCards,
} from './ChatVehicleCards';
import { PWAInstallBanner } from './PWAInstallBanner';
import { WhatsAppHandoffModal } from './WhatsAppHandoffModal';

interface StandaloneChatPageProps {
  vehicles: Vehicle[];
  settings: DealershipSettings;
  storeWhatsappNumber?: string;
  showBackToCatalog?: boolean;
  initialVehicle?: Vehicle | null;
  onCaptureLead: (lead: Lead) => Promise<Lead>;
  onSyncLeadChat?: (leadId: string, chatHistory: ChatMessage[]) => Promise<void>;
  onOpenCatalog: () => void;
  onOpenVehicleSheet?: (vehicleId: string) => void;
  onOpenPrivacy?: () => void;
  onOpenStaffArea?: () => void;
}

export const StandaloneChatPage: React.FC<StandaloneChatPageProps> = ({
  vehicles,
  settings,
  storeWhatsappNumber,
  showBackToCatalog = true,
  initialVehicle = null,
  onCaptureLead,
  onSyncLeadChat,
  onOpenCatalog,
  onOpenVehicleSheet,
  onOpenPrivacy,
  onOpenStaffArea,
}) => {
  // Permite personalização leve via query string (ex.: ?loja=Parceiro) para uso B2B em links externos
  const effectiveSettings = useMemo(() => {
    if (typeof window === 'undefined') return settings;
    const params = new URLSearchParams(window.location.search);
    const partnerStore = params.get('loja')?.trim();
    if (!partnerStore) return settings;
    return {
      ...settings,
      tradeName: partnerStore,
    };
  }, [settings]);

  const urlSearchMeta = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        vehicleId: null as string | null,
        origem: '/chat',
        isEmbedded: false,
      };
    }
    const params = new URLSearchParams(window.location.search);
    const vehicleId = params.get('veiculo')?.trim() || null;
    const rawOrigem = params.get('origem')?.trim() || '';
    const isEmbedded = params.get('embed') === '1';
    const origem = rawOrigem ? `/chat (${rawOrigem})` : isEmbedded ? '/chat (widget)' : '/chat';
    return { vehicleId, origem, isEmbedded };
  }, []);

  const storefront = useMemo(
    () => resolvePublicStorefrontLinks(effectiveSettings),
    [effectiveSettings]
  );

  const [fetchedExternalVehicle, setFetchedExternalVehicle] = useState<Vehicle | null>(null);

  useEffect(() => {
    const id = urlSearchMeta.vehicleId;
    if (!id || initialVehicle) return;
    if (vehicles.some((v) => String(v.id) === String(id))) return;
    let active = true;
    void fetch(`/api/public/vehicles/${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((row: ApiVehicleRow | null) => {
        if (active && row && row.id) {
          setFetchedExternalVehicle(mapDbVehicleToFrontend(row));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [initialVehicle, urlSearchMeta.vehicleId, vehicles]);

  const resolvedInitialVehicle = useMemo(() => {
    if (initialVehicle) return initialVehicle;
    if (!urlSearchMeta.vehicleId) return null;
    return (
      vehicles.find((v) => String(v.id) === String(urlSearchMeta.vehicleId)) ||
      fetchedExternalVehicle ||
      null
    );
  }, [initialVehicle, urlSearchMeta.vehicleId, vehicles, fetchedExternalVehicle]);

  const persistStorageKey = useMemo(() => {
    if (typeof window === 'undefined') return 'armazem_chat_v1_default';
    const partnerStore = new URLSearchParams(window.location.search)
      .get('loja')
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return partnerStore
      ? `armazem_chat_v1_loja_${partnerStore}`
      : 'armazem_chat_v1_default';
  }, []);

  const [leadPanelOpen, setLeadPanelOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [handoffTrackedRef, setHandoffTrackedRef] = useState<string | null>(
    null
  );
  const [handoffModalState, setHandoffModalState] = useState<{
    isOpen: boolean;
    purpose: HandoffPurpose;
    focusedVehicle?: Vehicle | null;
    vehicleLabel?: string | null;
    contextSummary?: string | null;
  }>({
    isOpen: false,
    purpose: 'sales',
    focusedVehicle: undefined,
    vehicleLabel: null,
    contextSummary: null,
  });
  const [isPwaBannerVisible, setIsPwaBannerVisible] = useState(false);
  const [pushBannerDismissed, setPushBannerDismissed] = useState<boolean>(() => {
    try {
      return (
        window.sessionStorage.getItem('armazem_visitor_push_dismissed_v1') ===
        '1'
      );
    } catch {
      return false;
    }
  });

  // Attachment state
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [pendingAttachment, setPendingAttachment] =
    useState<ChatAttachment | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{
    url: string;
    name: string;
  } | null>(null);

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizingAudio, setIsFinalizingAudio] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioMimeRef = useRef<string>('audio/webm');
  const recordingTimerRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number>(0);
  const discardAudioRef = useRef<boolean>(false);
  const finalizedAudioRef = useRef<boolean>(false);

  // Refs for inputs, handoff card & swipe-to-reply
  const textInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const handoffCardRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; msgId: string } | null>(
    null
  );

  const {
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
    canRetry,
    retryLastMessage,
    activeFilters,
    recentVehicleIds,
    focusedVehicleId,
    clearActiveFilters,
    compareVehicleIds,
    toggleCompareVehicle,
    clearCompareVehicles,
    compareSelectedVehicles,
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
    handleSaveContactToCrm,
    resetConversation,
  } = useVirtualConsultant({
    active: true,
    targetVehicle: resolvedInitialVehicle,
    vehicles,
    settings: effectiveSettings,
    originLabel: urlSearchMeta.origem,
    leadSourceLabel: 'Chat IA do Site',
    leadNote: `Lead capturado pela página dedicada (${urlSearchMeta.origem}) estilo WhatsApp.`,
    persistStorageKey,
    onCaptureLead,
    onSyncLeadChat,
  });

  const isTriageComplete = triageStage === 'complete';
  const userMessageCount = useMemo(
    () => messages.filter((m) => m.sender === 'cliente').length,
    [messages]
  );

  const visitorPush = useWebPush({
    role: 'visitor',
    sessionId,
  });

  const handleActivateVisitorPush = async () => {
    const ok = await visitorPush.subscribe();
    if (ok) {
      setPushBannerDismissed(true);
    }
  };

  const handleDismissPushBanner = () => {
    setPushBannerDismissed(true);
    try {
      window.sessionStorage.setItem('armazem_visitor_push_dismissed_v1', '1');
    } catch {
      // Ignore storage errors
    }
  };

  const effectiveStoreWhatsapp =
    effectiveSettings.salesWhatsapp?.trim() ||
    storeWhatsappNumber?.trim() ||
    effectiveSettings.whatsapp;

  const focusedVehicle = useMemo(() => {
    if (!focusedVehicleId) return null;
    return (
      vehicles.find((v) => String(v.id) === String(focusedVehicleId)) || null
    );
  }, [focusedVehicleId, vehicles]);

  const recentVehicles = useMemo(() => {
    if (!recentVehicleIds || recentVehicleIds.length === 0) return [];
    return recentVehicleIds
      .map((id) => vehicles.find((v) => String(v.id) === String(id)) || null)
      .filter((v): v is Vehicle => Boolean(v));
  }, [recentVehicleIds, vehicles]);

  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  // Assemble direct wa.me handoff preview purely from captured session state (ZERO AI tokens)
  const handoffData = useMemo(
    () =>
      buildWhatsAppHandoffUrl({
        storeWhatsappNumber: effectiveStoreWhatsapp,
        storeName: effectiveSettings.tradeName,
        dealership: effectiveSettings,
        leadName: customerName,
        leadPhone: customerWhatsapp,
        includeContactData: false,
        sessionId,
        focusedVehicle,
        baseUrl: appOrigin,
        messages,
        vehicles,
      }),
    [
      appOrigin,
      customerName,
      customerWhatsapp,
      effectiveSettings,
      effectiveStoreWhatsapp,
      focusedVehicle,
      messages,
      sessionId,
      vehicles,
    ]
  );

  // Detect when visitor explicitly requests a consultant, financing, or visit (never for non-scheduling inquiries)
  const lastAiMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === 'ia') return messages[i];
    }
    return null;
  }, [messages]);

  const autoHandoffDetected = useMemo(() => {
    if (!isTriageComplete) return false;
    if (lastAiMessage?.suppressHandoff || lastAiMessage?.isVisitInquiryOnly) {
      return false;
    }
    const lastClientMsg = [...messages]
      .reverse()
      .find((m) => m.sender === 'cliente');
    if (!lastClientMsg) return false;
    return detectHumanHandoffIntent(
      lastClientMsg.text || lastClientMsg.audio?.transcription || ''
    );
  }, [isTriageComplete, lastAiMessage, messages]);

  const openHandoffPreview = (
    purpose: HandoffPurpose = 'sales',
    vehicleLabel?: string | null,
    contextSummary?: string | null,
    explicitVehicle?: Vehicle | null
  ) => {
    setHandoffModalState({
      isOpen: true,
      purpose,
      focusedVehicle: explicitVehicle,
      vehicleLabel: vehicleLabel ?? null,
      contextSummary: contextSummary ?? null,
    });
  };

  // Register handoff in Neon PostgreSQL only when the user confirms inside the preview modal
  const handleTrackWhatsAppHandoff = (payload?: {
    purpose: HandoffPurpose;
    text: string;
    destinationPhone: string;
    includeContactData: boolean;
  }) => {
    setHandoffTrackedRef(handoffData.shortRef);
    void fetch('/api/chat/whatsapp-handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        sessionId,
        leadName:
          payload?.includeContactData && customerName.trim()
            ? customerName.trim()
            : undefined,
        leadPhone:
          payload?.includeContactData && customerWhatsapp.trim()
            ? customerWhatsapp.trim()
            : undefined,
        contextSummary:
          handoffModalState.contextSummary || handoffData.contextSummary,
        origem: '/chat',
        storeName: effectiveSettings.tradeName,
      }),
    }).catch(() => {
      // Non-blocking: WhatsApp link always opens cleanly even if offline
    });
  };

  const handleOpenVehicleCardSheet = (card: VehicleCardData) => {
    if (onOpenVehicleSheet) {
      onOpenVehicleSheet(card.id);
      return;
    }
    window.history.pushState({}, '', `/veiculo/${encodeURIComponent(card.id)}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleInternalLinkNavigate = (href: string) => {
    const match = href.match(/\/veiculo\/([^/?#]+)/i);
    if (match && match[1]) {
      if (onOpenVehicleSheet) {
        onOpenVehicleSheet(decodeURIComponent(match[1]));
      } else {
        window.history.pushState({}, '', href);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    }
  };

  const handleTriggerPhotoAttach = () => {
    setAttachMenuOpen(false);
    setMediaError(null);
    imageInputRef.current?.click();
  };

  const activeFilterChips = useMemo(() => {
    const chips: string[] = [];
    if (activeFilters.transmission) {
      chips.push(
        activeFilters.transmission === 'automatico' ? 'Automático' : 'Manual'
      );
    }
    if (activeFilters.maxPrice) {
      chips.push(`Até ${formatBrlCurrency(activeFilters.maxPrice)}`);
    }
    if (activeFilters.minPrice) {
      chips.push(`A partir de ${formatBrlCurrency(activeFilters.minPrice)}`);
    }
    if (activeFilters.maxKm) {
      chips.push(`Até ${formatKmBr(activeFilters.maxKm)}`);
    }
    if (activeFilters.minYear) {
      chips.push(`Ano ${activeFilters.minYear}+`);
    }
    if (activeFilters.brand) {
      chips.push(activeFilters.brand);
    }
    if (activeFilters.model) {
      chips.push(activeFilters.model);
    }
    if (activeFilters.belowFipeOnly) {
      chips.push('Abaixo da FIPE');
    }
    return chips;
  }, [activeFilters]);

  const focusFilterCheck = useMemo(() => {
    if (!focusedVehicle || activeFilterChips.length === 0) return null;
    return checkVehicleAgainstFilters(focusedVehicle, activeFilters);
  }, [activeFilterChips.length, activeFilters, focusedVehicle]);

  const handleReturnToActiveSearch = () => {
    const parts: string[] = [];
    if (activeFilters.transmission === 'automatico') parts.push('automático');
    if (activeFilters.transmission === 'manual') parts.push('manual');
    if (activeFilters.maxPrice) parts.push(`até ${formatBrlCurrency(activeFilters.maxPrice)}`);
    if (activeFilters.minPrice) parts.push(`a partir de ${formatBrlCurrency(activeFilters.minPrice)}`);
    if (activeFilters.maxKm) parts.push(`até ${formatKmBr(activeFilters.maxKm)}`);
    if (activeFilters.minYear) parts.push(`ano ${activeFilters.minYear} em diante`);
    if (activeFilters.brand) parts.push(activeFilters.brand);
    if (activeFilters.model) parts.push(activeFilters.model);
    if (activeFilters.belowFipeOnly) parts.push('abaixo da FIPE');
    const prompt =
      parts.length > 0
        ? `Quero voltar à busca anterior: ${parts.join(', ')}`
        : 'Quais veículos estão disponíveis no estoque hoje?';
    sendQuickPrompt(prompt);
  };

  const sendRichMessageRef = useRef(sendRichMessage);
  useEffect(() => {
    sendRichMessageRef.current = sendRichMessage;
  }, [sendRichMessage]);

  // Clean up audio streams and timers on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleConfirmClearConversation = () => {
    if (isRecording) {
      cancelAudioRecording();
    }
    setPendingAttachment(null);
    setAttachMenuOpen(false);
    setMediaError(null);
    setLightboxImage(null);
    setHeaderMenuOpen(false);
    setConfirmClearOpen(false);
    setHandoffTrackedRef(null);
    resetConversation();
  };

  const buildReplyPreviewForMessage = (msg: ChatMessage): string => {
    if (msg.text?.trim()) {
      return stripMarkdownForPreview(msg.text, 110);
    }
    if (msg.audio) {
      return msg.audio.transcription
        ? `Áudio: ${stripMarkdownForPreview(msg.audio.transcription, 95)}`
        : `Mensagem de áudio (${formatDurationSeconds(msg.audio.durationSec || 0)})`;
    }
    if (msg.attachment) {
      return msg.attachment.mimeType === 'application/pdf'
        ? `Documento PDF: ${msg.attachment.name}`
        : `Foto: ${msg.attachment.name}`;
    }
    return 'Mensagem';
  };

  const handleSelectReply = (msg: ChatMessage) => {
    const ctx: ChatReplyContext = {
      id: msg.id,
      sender: msg.sender,
      preview: buildReplyPreviewForMessage(msg),
    };
    setReplyingTo(ctx);
    textInputRef.current?.focus();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setAttachMenuOpen(false);
    if (!file) return;

    setMediaError(null);
    setIsProcessingFile(true);
    try {
      const prepared = await prepareChatAttachment(file);
      setPendingAttachment(prepared);
      textInputRef.current?.focus();
    } catch (err: unknown) {
      setMediaError(
        err instanceof Error
          ? err.message
          : 'Não foi possível preparar o arquivo selecionado.'
      );
    } finally {
      setIsProcessingFile(false);
    }
  };

  const stopRecordingHardware = () => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const startAudioRecording = async () => {
    if (isSending || isRecording) return;
    setMediaError(null);
    setAttachMenuOpen(false);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setMediaError(
        'Seu navegador não suporta gravação de áudio direta. Digite sua mensagem normalmente.'
      );
      return;
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: AUDIO_CAPTURE_CONSTRAINTS,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      mediaStreamRef.current = stream;

      const mimeType = pickSupportedAudioMimeType();
      const recorderOptions: MediaRecorderOptions = {
        audioBitsPerSecond: AUDIO_RECORDING_BITRATE,
        ...(mimeType ? { mimeType } : {}),
      };

      const recorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      audioMimeRef.current = recorder.mimeType || mimeType || 'audio/webm';
      discardAudioRef.current = false;
      finalizedAudioRef.current = false;
      recordingStartRef.current = Date.now();
      setIsFinalizingAudio(false);
      setRecordingSec(0);
      setIsRecording(true);

      const finalizeAndDispatchAudio = async (resolvedMime: string) => {
        if (finalizedAudioRef.current) return;
        finalizedAudioRef.current = true;

        const shouldDiscard = discardAudioRef.current;
        const durationSec = Math.max(
          1,
          Math.round((Date.now() - recordingStartRef.current) / 1000)
        );
        const chunks = [...audioChunksRef.current];
        audioChunksRef.current = [];
        mediaRecorderRef.current = null;

        stopRecordingHardware();
        setIsRecording(false);
        setIsFinalizingAudio(false);
        setRecordingSec(0);

        if (shouldDiscard || chunks.length === 0) return;

        const blob = new Blob(chunks, { type: resolvedMime });
        if (blob.size < 100) {
          setMediaError(
            'Áudio muito curto. Fale por pelo menos 1 segundo antes de enviar.'
          );
          return;
        }
        if (blob.size > MAX_AUDIO_RAW_BYTES) {
          setMediaError(
            'O áudio ficou grande demais para envio rápido. Tente gravar uma mensagem mais objetiva.'
          );
          return;
        }

        try {
          const dataUrl = await blobToDataUrl(blob);
          sendRichMessageRef.current({
            text: '',
            audio: {
              url: dataUrl,
              mimeType: resolvedMime.split(';')[0] || 'audio/webm',
              durationSec,
            },
          });
        } catch (err: unknown) {
          setMediaError(
            err instanceof Error
              ? err.message
              : 'Erro ao preparar o áudio gravado.'
          );
        }
      };

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const resolvedMime =
          recorder.mimeType || audioMimeRef.current || 'audio/webm';
        void finalizeAndDispatchAudio(resolvedMime);
      };

      recorder.start(250);
      recordingTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor(
          (Date.now() - recordingStartRef.current) / 1000
        );
        setRecordingSec(elapsed);
        if (elapsed >= MAX_AUDIO_DURATION_SEC) {
          if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop();
          }
        }
      }, 300);
    } catch {
      stopRecordingHardware();
      setIsRecording(false);
      setIsFinalizingAudio(false);
      setMediaError(
        'Não foi possível acessar o microfone. Verifique a permissão no navegador ou envie sua dúvida por texto.'
      );
    }
  };

  const cancelAudioRecording = () => {
    discardAudioRef.current = true;
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        stopRecordingHardware();
        setIsRecording(false);
        setIsFinalizingAudio(false);
        setRecordingSec(0);
      }
    } else {
      stopRecordingHardware();
      setIsRecording(false);
      setIsFinalizingAudio(false);
      setRecordingSec(0);
    }
  };

  const finishAndSendAudioRecording = () => {
    if (isFinalizingAudio) return;
    discardAudioRef.current = false;
    setIsFinalizingAudio(true);

    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        if (recorder.state === 'recording') {
          recorder.requestData();
        }
      } catch {
        // Some browsers flush data automatically on stop()
      }
      try {
        recorder.stop();
        return;
      } catch {
        // Fallback handled below
      }
    }

    // Fallback if recorder already became inactive so the user is never stuck
    const chunks = [...audioChunksRef.current];
    audioChunksRef.current = [];
    const durationSec = Math.max(
      1,
      Math.round((Date.now() - recordingStartRef.current) / 1000)
    );
    const resolvedMime = audioMimeRef.current || 'audio/webm';
    stopRecordingHardware();
    setIsRecording(false);
    setIsFinalizingAudio(false);
    setRecordingSec(0);

    if (chunks.length > 0 && !finalizedAudioRef.current) {
      finalizedAudioRef.current = true;
      const blob = new Blob(chunks, { type: resolvedMime });
      void blobToDataUrl(blob)
        .then((dataUrl) => {
          sendRichMessageRef.current({
            text: '',
            audio: {
              url: dataUrl,
              mimeType: resolvedMime.split(';')[0] || 'audio/webm',
              durationSec,
            },
          });
        })
        .catch(() => {
          setMediaError('Erro ao finalizar o áudio gravado. Tente novamente.');
        });
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSending || isProcessingFile) return;

    const trimmed = input.trim();
    if (!trimmed && !pendingAttachment) return;

    const attachmentToSend = pendingAttachment;
    setPendingAttachment(null);
    setAttachMenuOpen(false);
    setMediaError(null);

    sendRichMessage({
      text: trimmed,
      attachment: attachmentToSend,
    });
  };

  const interactiveWelcomeOptions = [
    {
      id: 'stock',
      icon: Car,
      title: 'Ver estoque disponível',
      subtitle: 'Consultar modelos disponíveis com preço, ano, km e ficha',
      prompt: 'Quais veículos vocês têm disponíveis no estoque hoje?',
    },
    {
      id: 'automatic',
      icon: Filter,
      title: 'Buscar carro automático',
      subtitle: 'Filtrar opções automáticas confirmadas no estoque real',
      prompt: 'Quero ver opções de carros automáticos disponíveis no estoque.',
    },
    {
      id: 'finance',
      icon: Wallet,
      title: 'Simular financiamento',
      subtitle: 'Calcular saldo a financiar com base na sua entrada e prazo',
      prompt: 'Quero simular financiamento. Quais dados você precisa?',
    },
    {
      id: 'tradein',
      icon: RefreshCw,
      title: 'Avaliar carro na troca',
      subtitle: 'Informar dados do usado e anexar fotos para pré-avaliação',
      prompt: 'Quero avaliar meu carro usado na troca.',
    },
    {
      id: 'visit',
      icon: CalendarClock,
      title: 'Horários e endereço da loja',
      subtitle: 'Ver showroom, funcionamento e como solicitar uma visita',
      prompt: 'Qual o endereço e os horários de funcionamento da loja?',
    },
  ];

  const canSendTextOrAttachment =
    Boolean(input.trim()) || Boolean(pendingAttachment);

  const renderLeadFormBody = () => (
    <div className="space-y-4">
      {leadSaved ? (
        <div className="p-4 rounded-xl bg-[#E7FCEB] border border-[#00A884]/30 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#00A884] text-white flex items-center justify-center shrink-0">
            <Check className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#111B21]">
              Contato confirmado!
            </p>
            <p className="text-xs text-[#3B4A54] mt-1 leading-relaxed">
              Registramos seu WhatsApp{' '}
              <strong className="font-mono text-[#111B21]">
                {customerWhatsapp}
              </strong>
              . Nossa equipe comercial continuará seu atendimento com todo o
              histórico desta conversa.
            </p>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSaveContactToCrm} className="space-y-3">
          <div className="space-y-1">
            <h3 className="font-display text-sm font-semibold text-[#111B21]">
              Receber Simulação & Laudo Cautelar
            </h3>
            <p className="text-xs text-[#54656F] leading-relaxed">
              Informe apenas seu nome e WhatsApp para receber atendimento
              prioritário do nosso time comercial.
            </p>
          </div>

          {leadSaveError && (
            <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{leadSaveError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#3B4A54] mb-1">
              Seu nome *
            </label>
            <input
              type="text"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Nome completo"
              disabled={isSavingLead}
              className="w-full min-h-[44px] px-3.5 py-2 bg-white border border-[#D1D7DB] focus:border-[#00A884] rounded-xl text-sm text-[#111B21] placeholder:text-[#8696A0] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#3B4A54] mb-1">
              WhatsApp *
            </label>
            <input
              type="tel"
              required
              value={customerWhatsapp}
              onChange={(e) =>
                setCustomerWhatsapp(formatBrazilianPhone(e.target.value))
              }
              placeholder="(11) 99999-9999"
              disabled={isSavingLead}
              maxLength={15}
              className="w-full min-h-[44px] px-3.5 py-2 bg-white border border-[#D1D7DB] focus:border-[#00A884] rounded-xl text-sm text-[#111B21] font-mono placeholder:text-[#8696A0] focus:outline-none"
            />
          </div>

          <label className="flex items-start gap-2.5 pt-1 text-xs text-[#54656F] leading-relaxed cursor-pointer select-none">
            <input
              type="checkbox"
              checked={lgpdConsent}
              onChange={(e) => setLgpdConsent(e.target.checked)}
              disabled={isSavingLead}
              className="mt-0.5 h-4 w-4 rounded border-[#8696A0] text-[#00A884] focus:ring-[#00A884] shrink-0 accent-[#00A884]"
            />
            <span>
              Autorizo o uso do meu{' '}
              <strong className="text-[#111B21]">nome</strong> e{' '}
              <strong className="text-[#111B21]">WhatsApp</strong> para
              atendimento comercial e envio de ofertas de veículos, conforme a{' '}
              {onOpenPrivacy ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenPrivacy();
                  }}
                  className="text-[#008069] hover:underline font-medium"
                >
                  Política de Privacidade (LGPD)
                </button>
              ) : (
                <span>Política de Privacidade (LGPD)</span>
              )}
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={
              isSavingLead ||
              !customerName.trim() ||
              !customerWhatsapp.trim() ||
              !lgpdConsent
            }
            className="w-full min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-[#00A884] hover:bg-[#008F72] disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
          >
            {isSavingLead ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Salvando contato...</span>
              </>
            ) : (
              <span>Confirmar WhatsApp para Atendimento</span>
            )}
          </button>
        </form>
      )}

      {/* WhatsApp Handoff Preview CTA inside Side Panel / Sheet */}
      <div className="p-3.5 rounded-xl bg-[#E7FCEB] border border-[#00A884]/35 space-y-2.5">
        <div>
          <p className="text-xs font-semibold text-[#075E54]">
            Falar com consultor no WhatsApp
          </p>
          <p className="text-[11px] text-[#3B4A54] mt-0.5 leading-snug">
            Você revisa o texto e escolhe se deseja incluir seus dados antes de
            abrir o WhatsApp ·{' '}
            <span className="font-mono text-[#075E54]">
              Ref #{handoffData.shortRef}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLeadPanelOpen(false);
            openHandoffPreview('sales');
          }}
          className="w-full min-h-[44px] py-2 px-3.5 rounded-xl text-xs font-semibold text-white bg-[#00A884] hover:bg-[#008F72] shadow-xs transition-colors inline-flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#00A884]"
        >
          <MessageCircle className="w-4 h-4 shrink-0" />
          <span>Revisar mensagem e abrir WhatsApp</span>
        </button>
      </div>

      {/* Dealership Assurance Info */}
      <div className="pt-4 border-t border-[#E9EDEF] space-y-3 text-xs text-[#54656F]">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-[#008069] shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-[#111B21]">
              Laudo Cautelar 100% Aprovado
            </p>
            <p className="text-[11px] text-[#667781] mt-0.5">
              Seminovos selecionados com garantia legal de{' '}
              {effectiveSettings.warrantyDays} dias (CDC).
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <MapPin className="w-4 h-4 text-[#008069] shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-[#111B21]">Showroom & Horários</p>
            {(() => {
              const formattedAddress = formatDealershipAddress(effectiveSettings);
              const mapsUrl = buildDealershipMapsUrl(effectiveSettings);
              const formattedHours = formatDealershipHours(effectiveSettings);
              return (
                <>
                  {formattedAddress ? (
                    <p className="text-[11px] text-[#667781] mt-0.5">
                      {formattedAddress}
                      {mapsUrl && (
                        <>
                          {' · '}
                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#008069] hover:underline font-medium"
                          >
                            Ver no mapa
                          </a>
                        </>
                      )}
                    </p>
                  ) : (
                    <p className="text-[11px] text-[#667781] mt-0.5">
                      Confirme o endereço com nosso consultor.
                    </p>
                  )}
                  <p className="text-[11px] text-[#667781] mt-0.5">
                    {formattedHours.hasAny
                      ? formattedHours.summaryLine
                      : 'Confirme os horários de atendimento com nosso consultor.'}
                  </p>
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={`h-dvh w-full bg-[#DADBD3] text-[#111B21] relative flex flex-col items-center justify-center overflow-hidden ${
        urlSearchMeta.isEmbedded ? '' : 'lg:py-5 lg:px-6'
      }`}
    >
      {/* Classic WhatsApp Web Top Green Strip on Desktop */}
      {!urlSearchMeta.isEmbedded && (
        <div
          aria-hidden="true"
          className="hidden lg:block fixed top-0 inset-x-0 h-[128px] bg-[#00A884] z-0"
        />
      )}

      {/* Hidden File Inputs for Images & PDF */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => void handleFileChange(e)}
        className="hidden"
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={(e) => void handleFileChange(e)}
        className="hidden"
      />

      {/* Main WhatsApp App Container */}
      <div
        className={`relative z-10 w-full h-full flex overflow-hidden bg-[#EFEAE2] ${
          urlSearchMeta.isEmbedded
            ? ''
            : 'lg:max-w-[1100px] lg:max-h-[920px] lg:rounded-lg lg:shadow-[0_12px_32px_rgba(11,20,26,0.18)]'
        }`}
      >
        {/* Primary WhatsApp Conversation Column */}
        <div className="flex-1 min-w-0 h-full flex flex-col">
          {/* Official WhatsApp Dark Green Fixed Header (#075E54) */}
          <header className="h-[60px] shrink-0 bg-[#075E54] text-white px-2.5 sm:px-4 flex items-center justify-between gap-2 shadow-xs z-20">
            <div className="flex items-center gap-2 min-w-0">
              {!urlSearchMeta.isEmbedded && showBackToCatalog && (
                storefront.isExternal ? (
                  <a
                    href={storefront.catalogUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Ver vitrine oficial da revenda"
                    title="Ver vitrine oficial da revenda"
                    className="min-h-[40px] px-2.5 flex items-center justify-center gap-1.5 rounded-full text-xs font-medium text-white/95 hover:text-white bg-white/10 hover:bg-white/15 transition-colors shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Vitrine oficial</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={onOpenCatalog}
                    aria-label="Voltar à vitrine"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-white/90 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )
              )}

              {/* Round Store Avatar + Green Online Dot */}
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-full bg-[#111B21] border border-white/25 flex items-center justify-center text-white shadow-xs">
                  <svg
                    viewBox="0 0 24 24"
                    className="w-5 h-5 text-white"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 16h18" />
                    <path d="M5 16l2.2-6.5A2 2 0 0 1 9.1 8h5.8a2 2 0 0 1 1.9 1.5L19 16" />
                    <circle cx="7.5" cy="16" r="1.5" fill="currentColor" />
                    <circle cx="16.5" cy="16" r="1.5" fill="currentColor" />
                  </svg>
                </div>
                <span
                  aria-label="Status online"
                  className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#25D366] ring-2 ring-[#075E54]"
                />
              </div>

              <div className="min-w-0 ml-1">
                <h1 className="font-display text-[15px] font-semibold leading-tight text-white truncate">
                  {effectiveSettings.tradeName}
                </h1>
                <p className="text-[12px] leading-tight text-[#D9FDD3] truncate">
                  {isProcessingAudio && !hasStreamFirstToken
                    ? 'ouvindo e analisando áudio...'
                    : isSending
                      ? 'digitando...'
                      : isRecording
                        ? 'gravando áudio...'
                        : 'online'}
                </p>
              </div>
            </div>

            {/* Header Right Actions: Single Primary Consultant CTA + Compact Overflow Menu */}
            <div className="flex items-center gap-1.5 shrink-0">
              {urlSearchMeta.isEmbedded && (
                <a
                  href="/chat"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Abrir atendimento em tela cheia"
                  title="Abrir em tela cheia"
                  className="w-9 h-9 rounded-full text-white/90 hover:text-white hover:bg-white/10 transition-colors inline-flex items-center justify-center"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              <button
                type="button"
                onClick={() => openHandoffPreview('sales')}
                aria-label="Falar com consultor no WhatsApp"
                className="min-h-[40px] px-3 sm:px-3.5 rounded-full bg-[#25D366] hover:bg-[#1EBE5D] text-[#052E16] text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-white"
              >
                <MessageCircle className="w-4 h-4 shrink-0" />
                <span className="hidden xs:inline sm:inline">Falar com consultor</span>
                <span className="xs:hidden sm:hidden">Consultor</span>
              </button>

              {/* Compact Overflow Menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setHeaderMenuOpen((prev) => !prev)}
                  aria-label="Mais opções da conversa"
                  aria-expanded={headerMenuOpen}
                  className="w-10 h-10 rounded-full text-white/90 hover:text-white hover:bg-white/10 transition-colors inline-flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-white"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {headerMenuOpen && (
                  <div className="absolute right-0 top-[48px] z-40 w-64 bg-white text-[#111B21] rounded-xl shadow-xl border border-[#D1D7DB] py-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        setLeadPanelOpen(true);
                      }}
                      className="w-full min-h-[42px] px-3.5 py-2 text-left text-xs font-medium text-[#111B21] hover:bg-[#F0F2F5] flex items-center gap-2.5 transition-colors border-b border-[#E9EDEF]"
                    >
                      <UserPlus className="w-4 h-4 text-[#008069] shrink-0" />
                      <span>
                        {leadSaved
                          ? 'Ver dados informados'
                          : 'Deixar contato para retorno'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        void handleCopyShareLink();
                      }}
                      className="w-full min-h-[42px] px-3.5 py-2 text-left text-xs font-medium text-[#111B21] hover:bg-[#F0F2F5] flex items-center gap-2.5 transition-colors border-b border-[#E9EDEF]"
                    >
                      {copiedLink ? (
                        <Check className="w-4 h-4 text-[#00A884] shrink-0" />
                      ) : (
                        <Copy className="w-4 h-4 text-[#54656F] shrink-0" />
                      )}
                      <span>
                        {copiedLink
                          ? 'Link copiado!'
                          : 'Copiar link do atendimento'}
                      </span>
                    </button>

                    {visitorPush.isSupported &&
                      visitorPush.permission !== 'denied' &&
                      visitorPush.vapidConfigured !== false && (
                        <button
                          type="button"
                          disabled={visitorPush.isSubscribing}
                          onClick={() => {
                            setHeaderMenuOpen(false);
                            void handleActivateVisitorPush();
                          }}
                          className="w-full min-h-[42px] px-3.5 py-2 text-left text-xs font-medium text-[#075E54] hover:bg-[#E7FCEB] flex items-center gap-2.5 transition-colors border-b border-[#E9EDEF] disabled:opacity-50"
                        >
                          {visitorPush.isSubscribed ? (
                            <BellRing className="w-4 h-4 text-[#00A884] shrink-0" />
                          ) : (
                            <Bell className="w-4 h-4 text-[#00A884] shrink-0" />
                          )}
                          <span>
                            {visitorPush.isSubscribed
                              ? 'Alertas push ativos'
                              : 'Ativar alertas de respostas'}
                          </span>
                        </button>
                      )}

                    <button
                      type="button"
                      onClick={() => {
                        setHeaderMenuOpen(false);
                        setConfirmClearOpen(true);
                      }}
                      className="w-full min-h-[42px] px-3.5 py-2 text-left text-xs font-medium text-[#111B21] hover:bg-[#F0F2F5] flex items-center gap-2.5 transition-colors border-b border-[#E9EDEF]"
                    >
                      <RotateCcw className="w-4 h-4 text-[#54656F] shrink-0" />
                      <span>Nova conversa / Limpar histórico</span>
                    </button>

                    {onOpenStaffArea && (
                      <button
                        type="button"
                        onClick={() => {
                          setHeaderMenuOpen(false);
                          onOpenStaffArea();
                        }}
                        className="w-full min-h-[40px] px-3.5 py-2 text-left text-[11px] font-medium text-[#54656F] hover:text-[#111B21] hover:bg-[#F0F2F5] flex items-center gap-2.5 transition-colors"
                      >
                        <Headset className="w-3.5 h-3.5 text-[#667781] shrink-0" />
                        <span>Acesso da equipe</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Deferred Installable PWA Banner (never shown on initial empty open or inside external widget iframe) */}
          <PWAInstallBanner
            variant="whatsapp"
            appName={effectiveSettings.tradeName}
            suppressed={urlSearchMeta.isEmbedded || userMessageCount === 0}
            onVisibilityChange={setIsPwaBannerVisible}
          />

          {/* Subtle Visitor Web Push Opt-In Banner (deferred until user engages deeply AND never simultaneous with PWA install banner) */}
          {userMessageCount >= 3 &&
            !isPwaBannerVisible &&
            !visitorPush.isSubscribed &&
            !pushBannerDismissed &&
            visitorPush.isSupported &&
            visitorPush.permission !== 'denied' &&
            visitorPush.vapidConfigured !== false && (
              <div className="shrink-0 bg-[#F0F2F5] border-b border-[#D1D7DB] px-3.5 py-2 flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-7 h-7 rounded-full bg-[#00A884]/15 text-[#075E54] flex items-center justify-center shrink-0">
                    <Bell className="w-3.5 h-3.5" />
                  </span>
                  <p className="text-[11.5px] text-[#3B4A54] leading-snug truncate">
                    Quer ser avisado se um consultor responder por aqui?
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={visitorPush.isSubscribing}
                    onClick={() => void handleActivateVisitorPush()}
                    className="px-2.5 py-1.5 rounded-full bg-[#00A884] hover:bg-[#008F72] text-white text-[11px] font-semibold transition-colors whitespace-nowrap disabled:opacity-60"
                  >
                    {visitorPush.isSubscribing ? 'Ativando...' : 'Ativar'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDismissPushBanner}
                    aria-label="Dispensar convite de alertas"
                    className="w-7 h-7 rounded-full hover:bg-black/5 text-[#667781] flex items-center justify-center"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

          {visitorPush.statusMessage && (
            <div className="shrink-0 bg-[#FFF5C4] border-b border-amber-300/60 px-3.5 py-2 flex items-center justify-between gap-2 text-[11.5px] text-[#54656F]">
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <AlertCircle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span className="truncate">{visitorPush.statusMessage}</span>
              </span>
              <button
                type="button"
                onClick={visitorPush.clearStatusMessage}
                aria-label="Fechar aviso"
                className="text-[#54656F] hover:text-[#111B21] shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Live Notification Toast from Human Consultant or Store Broadcast */}
          {incomingNotification && (
            <div className="shrink-0 bg-[#111B21] text-white border-b border-[#00A884]/40 px-3.5 py-2.5 flex items-center justify-between gap-3 shadow-md">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-7 h-7 rounded-full bg-[#00A884] text-white flex items-center justify-center shrink-0">
                  <Bell className="w-3.5 h-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11.5px] font-semibold text-[#D9FDD3] truncate">
                    {incomingNotification.title}
                  </p>
                  <p className="text-xs text-white/90 truncate">
                    {incomingNotification.body}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={dismissIncomingNotification}
                aria-label="Fechar notificação"
                className="w-7 h-7 rounded-full hover:bg-white/10 text-white/80 flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Lead Confirmed / WhatsApp Handoff Subtle Bar */}
          {(leadSaved || handoffTrackedRef) && (
            <div className="shrink-0 bg-[#E7FCEB] border-b border-[#00A884]/20 px-4 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#075E54]">
              <span className="inline-flex items-center gap-1.5 truncate">
                <Check className="w-3.5 h-3.5 text-[#00A884] shrink-0" />
                <span className="truncate">
                  {handoffTrackedRef ? (
                    <>
                      Encaminhado ao WhatsApp da loja ·{' '}
                      <strong className="font-mono">
                        Ref #{handoffTrackedRef}
                      </strong>
                    </>
                  ) : (
                    <>
                      Atendimento vinculado ao WhatsApp{' '}
                      <strong className="font-mono">{customerWhatsapp}</strong>
                    </>
                  )}
                </span>
              </span>
            </div>
          )}

          {/* Scrollable Messages Area (#EFEAE2 Wallpaper) */}
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden wa-chat-wallpaper px-2.5 sm:px-6 lg:px-10 py-4 space-y-2.5"
            onClick={() => {
              if (attachMenuOpen) setAttachMenuOpen(false);
              if (headerMenuOpen) setHeaderMenuOpen(false);
            }}
          >
            {/* Official Channel Notice */}
            <div className="flex justify-center pb-1.5">
              <p className="max-w-md text-center px-3.5 py-1.5 rounded-lg bg-[#FFF5C4]/95 shadow-[0_1px_1px_rgba(11,20,26,0.08)] text-[11.5px] text-[#54656F] leading-snug">
                Atendimento online da{' '}
                <strong className="text-[#111B21]">
                  {effectiveSettings.tradeName}
                </strong>
                . Consulte o estoque real, fichas, financiamento ou envie fotos
                do seu usado.
              </p>
            </div>

            {(() => {
              let activeMenuBubbleIdx = -1;
              if (isTriageComplete && userMessageCount === 0) {
                for (let i = messages.length - 1; i >= 0; i--) {
                  const candidate = messages[i];
                  if (candidate.sender === 'ia') {
                    activeMenuBubbleIdx = i;
                    break;
                  }
                }
              }
              return messages.map((msg, index) => {
                const isAi = msg.sender === 'ia';
                const isWelcomeBubble =
                  isTriageComplete &&
                  userMessageCount === 0 &&
                  index === activeMenuBubbleIdx;
                const isLatestAiMessage =
                  isAi &&
                  index ===
                    messages.reduce(
                      (acc, item, idx) => (item.sender === 'ia' ? idx : acc),
                      -1
                    );
                const isImageAttachment =
                  msg.attachment?.mimeType.startsWith('image/');
                const isPdfAttachment =
                  msg.attachment?.mimeType === 'application/pdf';

              return (
                <div key={msg.id} className="space-y-2">
                  <div
                    className={`group flex w-full items-center gap-1.5 ${
                      isAi ? 'justify-start' : 'justify-end'
                    }`}
                    onTouchStart={(e) => {
                      const t = e.touches[0];
                      if (t) {
                        touchStartRef.current = {
                          x: t.clientX,
                          y: t.clientY,
                          msgId: msg.id,
                        };
                      }
                    }}
                    onTouchEnd={(e) => {
                      const start = touchStartRef.current;
                      const t = e.changedTouches[0];
                      touchStartRef.current = null;
                      if (!start || !t || start.msgId !== msg.id) return;
                      const dx = t.clientX - start.x;
                      const dy = Math.abs(t.clientY - start.y);
                      if (dx >= 48 && dy < 40) {
                        handleSelectReply(msg);
                      }
                    }}
                  >
                    {/* Reply Button on Left for User Messages */}
                    {!isAi && (
                      <button
                        type="button"
                        onClick={() => handleSelectReply(msg)}
                        title="Responder mensagem"
                        aria-label="Responder mensagem"
                        className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 w-8 h-8 rounded-full bg-white/85 hover:bg-white text-[#54656F] hover:text-[#075E54] shadow-xs flex items-center justify-center transition-all shrink-0"
                      >
                        <Reply className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <div
                      className={`relative min-w-0 break-words max-w-[92%] sm:max-w-[82%] lg:max-w-[76%] px-3 pt-2 pb-1.5 shadow-[0_1px_1px_rgba(11,20,26,0.13)] ${
                        isAi
                          ? 'bg-white text-[#111B21] rounded-lg rounded-tl-none ml-2'
                          : 'bg-[#D9FDD3] text-[#111B21] rounded-lg rounded-tr-none mr-2'
                      }`}
                    >
                      {/* Top Corner WhatsApp Bubble Tail */}
                      {isAi ? (
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 8 13"
                          width="8"
                          height="13"
                          className="absolute top-0 -left-[8px] text-white fill-current"
                        >
                          <path d="M1.533 3.568L8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z" />
                        </svg>
                      ) : (
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 8 13"
                          width="8"
                          height="13"
                          className="absolute top-0 -right-[8px] text-[#D9FDD3] fill-current"
                        >
                          <path d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" />
                        </svg>
                      )}

                      {/* Human Consultant / Store Notice Header Tag */}
                      {isAi && msg.isHumanConsultant && (
                        <div className="mb-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#E7FCEB] border border-[#00A884]/30 text-[11px] font-semibold text-[#075E54]">
                          <Headset className="w-3 h-3 text-[#00A884]" />
                          <span>{msg.senderLabel || 'Consultor da Loja'}</span>
                        </div>
                      )}

                      {/* Quoted Reply Block inside Bubble */}
                      {msg.replyTo && (
                        <div
                          className={`mb-2 rounded-md px-2.5 py-1.5 border-l-[3.5px] text-xs ${
                            msg.replyTo.sender === 'ia'
                              ? 'bg-black/[0.05] border-[#00A884]'
                              : 'bg-black/[0.06] border-[#075E54]'
                          }`}
                        >
                          <p
                            className={`text-[11px] font-semibold leading-tight ${
                              msg.replyTo.sender === 'ia'
                                ? 'text-[#008069]'
                                : 'text-[#075E54]'
                            }`}
                          >
                            {msg.replyTo.sender === 'ia'
                              ? effectiveSettings.tradeName
                              : 'Você'}
                          </p>
                          <p className="text-[12px] text-[#54656F] line-clamp-2 mt-0.5 leading-snug">
                            {msg.replyTo.preview}
                          </p>
                        </div>
                      )}

                      {/* Image Attachment Thumbnail */}
                      {isImageAttachment && msg.attachment && (
                        <div className="mb-2">
                          {msg.attachment.url ? (
                            <button
                              type="button"
                              onClick={() =>
                                setLightboxImage({
                                  url: msg.attachment!.url,
                                  name: msg.attachment!.name,
                                })
                              }
                              className="block rounded-md overflow-hidden border border-black/10 hover:opacity-95 transition-opacity max-w-[260px]"
                            >
                              <img
                                src={msg.attachment.url}
                                alt={msg.attachment.name}
                                className="w-full max-h-[240px] object-cover block"
                              />
                            </button>
                          ) : (
                            <div className="flex items-center gap-2.5 p-2.5 rounded-md bg-black/[0.05] border border-black/10 max-w-[290px]">
                              <div className="w-9 h-9 rounded-md bg-[#00A884]/15 text-[#075E54] flex items-center justify-center shrink-0">
                                <ImageIcon className="w-5 h-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-[#111B21] truncate">
                                  {msg.attachment.name}
                                </p>
                                <p className="text-[11px] text-[#54656F]">
                                  Foto enviada nesta conversa
                                  {msg.attachment.sizeBytes
                                    ? ` · ${formatBytesCompact(msg.attachment.sizeBytes)}`
                                    : ''}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* PDF Attachment Card */}
                      {isPdfAttachment && msg.attachment &&
                        (msg.attachment.url ? (
                          <a
                            href={msg.attachment.url}
                            download={msg.attachment.name}
                            className="mb-2 flex items-center gap-2.5 p-2.5 rounded-md bg-black/[0.05] hover:bg-black/[0.08] border border-black/10 transition-colors max-w-[290px]"
                          >
                            <div className="w-9 h-9 rounded-md bg-[#E53935] text-white flex items-center justify-center shrink-0">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-[#111B21] truncate">
                                {msg.attachment.name}
                              </p>
                              <p className="text-[11px] text-[#54656F]">
                                PDF
                                {msg.attachment.sizeBytes
                                  ? ` · ${formatBytesCompact(msg.attachment.sizeBytes)}`
                                  : ''}
                              </p>
                            </div>
                            <Download className="w-4 h-4 text-[#54656F] shrink-0" />
                          </a>
                        ) : (
                          <div className="mb-2 flex items-center gap-2.5 p-2.5 rounded-md bg-black/[0.05] border border-black/10 max-w-[290px]">
                            <div className="w-9 h-9 rounded-md bg-[#E53935] text-white flex items-center justify-center shrink-0">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-[#111B21] truncate">
                                {msg.attachment.name}
                              </p>
                              <p className="text-[11px] text-[#54656F]">
                                PDF enviado nesta conversa
                                {msg.attachment.sizeBytes
                                  ? ` · ${formatBytesCompact(msg.attachment.sizeBytes)}`
                                  : ''}
                              </p>
                            </div>
                          </div>
                        ))}

                      {/* Audio Voice Note Player + Live Transcription */}
                      {msg.audio && (
                        <div className="mb-1.5 space-y-1.5 min-w-[220px] sm:min-w-[260px]">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-[#00A884] text-white flex items-center justify-center shrink-0">
                              <Mic className="w-4 h-4" />
                            </div>
                            {msg.audio.url ? (
                              <audio
                                controls
                                src={msg.audio.url}
                                className="h-8 w-full max-w-[230px]"
                              />
                            ) : (
                              <span className="text-xs font-medium text-[#3B4A54]">
                                Mensagem de áudio
                                {msg.audio.durationSec
                                  ? ` (${formatDurationSeconds(msg.audio.durationSec)})`
                                  : ''}
                              </span>
                            )}
                          </div>
                          {msg.audio.transcription ? (
                            <p className="text-[12px] text-[#3B4A54] bg-black/[0.04] rounded px-2 py-1 leading-snug italic">
                              “{msg.audio.transcription}”
                            </p>
                          ) : isProcessingAudio &&
                            activeAudioMessageId === msg.id ? (
                            <p className="text-[11px] text-[#54656F] inline-flex items-center gap-1.5">
                              <Loader2 className="w-3 h-3 animate-spin text-[#008069]" />
                              <span>Transcrevendo e analisando áudio...</span>
                            </p>
                          ) : null}
                        </div>
                      )}

                      {/* Text Content */}
                      {msg.text && (
                        <div className="pr-1">
                          <ChatMarkdown
                            content={msg.text}
                            variant={isAi ? 'ai' : 'user'}
                            theme="whatsapp"
                            onNavigateInternal={handleInternalLinkNavigate}
                          />
                        </div>
                      )}

                      {/* Rich Vehicle Cards (up to 3 per response) */}
                      {isAi && msg.vehicleCards && msg.vehicleCards.length > 0 && (
                        <ChatVehicleCards
                          cards={msg.vehicleCards}
                          selectedCompareIds={compareVehicleIds}
                          onOpenSheet={handleOpenVehicleCardSheet}
                          onToggleCompare={(card) => toggleCompareVehicle(card.id)}
                          onSimulate={(card) =>
                            sendQuickPrompt(
                              `Quero simular financiamento do ${card.brand} ${card.model} ${card.year}`
                            )
                          }
                          onConsult={(card) => {
                            const matchedVehicle =
                              vehicles.find(
                                (v) => String(v.id) === String(card.id)
                              ) || null;
                            const cardTitle = getVehicleDisplayTitle(card);
                            openHandoffPreview(
                              'sales',
                              matchedVehicle
                                ? null
                                : `${cardTitle} ${card.year} (Ref. #${card.id})`,
                              `Tenho interesse no ${cardTitle} ${card.year}`,
                              matchedVehicle
                            );
                          }}
                        />
                      )}

                      {/* Side-by-Side Vehicle Comparison */}
                      {isAi && msg.comparison && (
                        <ChatComparisonBlock
                          comparison={msg.comparison}
                          onOpenSheet={handleOpenVehicleCardSheet}
                        />
                      )}

                      {/* Deterministic Financing Balance Summary */}
                      {isAi && msg.financingSummary && (
                        <ChatFinancingBlock summary={msg.financingSummary} />
                      )}

                      {/* Direct Photo Attachment CTA for Trade-In */}
                      {isAi && msg.promptAttachPhotos && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={isSending || isProcessingFile}
                            onClick={handleTriggerPhotoAttach}
                            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 min-h-[42px] rounded-xl bg-[#00A884] hover:bg-[#008F72] text-white text-xs font-semibold shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#00A884] disabled:opacity-50"
                          >
                            <Camera className="w-4 h-4 shrink-0" />
                            <span>Anexar fotos do meu carro</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openHandoffPreview('tradein', null, 'Avaliação de troca')
                            }
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[42px] rounded-xl border border-[#D1D7DB] bg-[#F8F9FA] hover:bg-[#EFEAE2] text-[#111B21] text-xs font-medium transition-colors"
                          >
                            <MessageCircle className="w-3.5 h-3.5 text-[#008069]" />
                            <span>Falar com consultor</span>
                          </button>
                        </div>
                      )}

                      {/* Recoverable Stock Query Error Retry */}
                      {isAi && msg.stockQueryError && canRetry && (
                        <div className="mt-2.5">
                          <button
                            type="button"
                            disabled={isSending}
                            onClick={() => retryLastMessage()}
                            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-lg bg-[#075E54] hover:bg-[#064E46] text-white text-xs font-semibold transition-colors disabled:opacity-50"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Tentar novamente</span>
                          </button>
                        </div>
                      )}

                      {/* Timestamp + Blue Double Check */}
                      <div className="mt-1 flex items-center justify-end gap-1 select-none">
                        <span className="text-[11px] leading-none text-[#667781] font-mono tabular-nums">
                          {msg.timestamp}
                        </span>
                        {!isAi && (
                          <CheckCheck
                            aria-label="Visualizada"
                            className="w-3.5 h-3.5 text-[#53BDEB] shrink-0"
                          />
                        )}
                      </div>
                    </div>

                    {/* Reply Button on Right for AI Messages */}
                    {isAi && (
                      <button
                        type="button"
                        onClick={() => handleSelectReply(msg)}
                        title="Responder mensagem"
                        aria-label="Responder mensagem"
                        className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 w-8 h-8 rounded-full bg-white/85 hover:bg-white text-[#54656F] hover:text-[#075E54] shadow-xs flex items-center justify-center transition-all shrink-0"
                      >
                        <Reply className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Opening Shortcuts Menu (shown ONLY before first user message) */}
                  {isWelcomeBubble && (
                    <div className="flex justify-start pl-2">
                      <div className="w-full max-w-[92%] sm:max-w-[78%] lg:max-w-[460px] bg-white rounded-xl shadow-[0_1px_2px_rgba(11,20,26,0.14)] overflow-hidden border border-black/[0.05]">
                        <div className="px-3.5 py-2 bg-[#F0F2F5] border-b border-[#E9EDEF] flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#075E54]">
                            Como posso ajudar?
                          </span>
                          <span className="text-[11px] text-[#667781]">
                            Toque ou digite livremente
                          </span>
                        </div>
                        <div className="divide-y divide-[#E9EDEF]">
                          {interactiveWelcomeOptions.map((opt) => {
                            const IconComp = opt.icon;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                disabled={isSending}
                                onClick={() => sendQuickPrompt(opt.prompt)}
                                className="w-full min-h-[48px] text-left px-3.5 py-2.5 hover:bg-[#F5F6F6] active:bg-[#E7FCEB] transition-colors flex items-center justify-between gap-3 disabled:opacity-50 focus:outline-none focus:bg-[#E7FCEB]"
                              >
                                <div className="flex items-start gap-2.5 min-w-0">
                                  <IconComp className="w-4 h-4 text-[#008069] shrink-0 mt-0.5" />
                                  <div className="min-w-0">
                                    <p className="text-[13.5px] font-semibold text-[#111B21] leading-snug">
                                      {opt.title}
                                    </p>
                                    <p className="text-[11.5px] text-[#667781] leading-snug mt-0.5">
                                      {opt.subtitle}
                                    </p>
                                  </div>
                                </div>
                                <ChevronRight className="w-4 h-4 text-[#00A884] shrink-0" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Contextual Suggested Actions right below the latest assistant reply (after first turn) */}
                  {isLatestAiMessage &&
                    userMessageCount > 0 &&
                    !isSending &&
                    msg.suggestedActions &&
                    msg.suggestedActions.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pl-2 pt-0.5">
                        {msg.suggestedActions.slice(0, 3).map((action) => {
                          if (
                            action.kind === 'open_sheet' &&
                            action.sheetPath &&
                            /^https?:\/\//i.test(action.sheetPath)
                          ) {
                            return (
                              <a
                                key={action.id || action.label}
                                href={action.sheetPath}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-full text-xs font-medium text-[#075E54] bg-white hover:bg-[#E7FCEB] border border-[#00A884]/35 shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#00A884]"
                              >
                                <span>{action.label}</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            );
                          }
                          return (
                            <button
                              key={action.id || action.label}
                              type="button"
                              onClick={() => {
                                if (action.kind === 'attach_photos') {
                                  handleTriggerPhotoAttach();
                                } else if (action.kind === 'handoff') {
                                  const actionVehicle = action.vehicleId
                                    ? vehicles.find(
                                        (v) => String(v.id) === String(action.vehicleId)
                                      ) || null
                                    : msg.financingSummary?.vehicleId
                                      ? vehicles.find(
                                          (v) =>
                                            String(v.id) ===
                                            String(msg.financingSummary?.vehicleId)
                                        ) || null
                                      : undefined;
                                  openHandoffPreview(
                                    msg.financingSummary ? 'financing' : 'sales',
                                    null,
                                    null,
                                    actionVehicle
                                  );
                                } else if (
                                  action.kind === 'open_sheet' &&
                                  action.vehicleId
                                ) {
                                  handleInternalLinkNavigate(
                                    action.sheetPath || `/veiculo/${action.vehicleId}`
                                  );
                                } else if (action.promptText) {
                                  sendQuickPrompt(action.promptText);
                                }
                              }}
                              className="min-h-[38px] px-3 py-1.5 rounded-full text-xs font-medium text-[#075E54] bg-white hover:bg-[#E7FCEB] border border-[#00A884]/35 shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[#00A884]"
                            >
                              {action.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                </div>
              );
            });
            })()}

            {isSending && !hasStreamFirstToken && (
              <div className="flex justify-start">
                <div className="relative bg-white text-[#54656F] rounded-lg rounded-tl-none ml-2 px-3.5 py-2.5 shadow-[0_1px_1px_rgba(11,20,26,0.13)] inline-flex items-center gap-2 text-xs">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 8 13"
                    width="8"
                    height="13"
                    className="absolute top-0 -left-[8px] text-white fill-current"
                  >
                    <path d="M1.533 3.568L8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z" />
                  </svg>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00A884]" />
                  <span>
                    {isProcessingAudio
                      ? 'Transcrevendo e analisando áudio...'
                      : 'Consultando estoque e respondendo...'}
                  </span>
                </div>
              </div>
            )}

            {/* Contextual Consultant Handoff Card (only when visitor asks for consultant/visit/negotiation, NEVER on non-scheduling inquiries) */}
            {autoHandoffDetected && !isSending && (
              <div ref={handoffCardRef} className="flex justify-start pl-2 pt-1">
                <div className="w-full max-w-[92%] sm:max-w-[78%] lg:max-w-[460px] bg-white rounded-xl shadow-[0_2px_6px_rgba(11,20,26,0.14)] border border-[#00A884]/40 overflow-hidden">
                  <div className="px-3.5 py-2.5 bg-[#E7FCEB] border-b border-[#00A884]/25 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[#075E54]">
                      <MessageCircle className="w-4 h-4 text-[#00A884] shrink-0" />
                      <span>Falar com consultor no WhatsApp</span>
                    </span>
                    <span className="text-[10.5px] font-mono text-[#075E54]/80 shrink-0">
                      Ref #{handoffData.shortRef}
                    </span>
                  </div>

                  <div className="p-3.5 space-y-3">
                    <p className="text-xs text-[#3B4A54] leading-relaxed">
                      Se preferir continuar com um consultor humano, você pode
                      revisar a mensagem com o resumo do assunto antes de abrir
                      o WhatsApp.
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          openHandoffPreview(
                            lastAiMessage?.financingSummary
                              ? 'financing'
                              : 'sales'
                          )
                        }
                        className="flex-1 min-w-[200px] min-h-[44px] px-4 py-2.5 rounded-xl bg-[#00A884] hover:bg-[#008F72] text-white text-xs font-semibold shadow-xs transition-colors inline-flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#00A884]"
                      >
                        <MessageCircle className="w-4 h-4 shrink-0" />
                        <span>Revisar e abrir WhatsApp</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {(errorMsg || mediaError) && (
              <div className="flex justify-center">
                <div className="max-w-md w-full p-3 rounded-lg bg-white border border-red-200 shadow-xs flex items-start gap-2.5 text-xs text-red-700">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="space-y-2 flex-1 min-w-0">
                    <p className="leading-relaxed">{mediaError || errorMsg}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {errorMsg && canRetry && (
                        <button
                          type="button"
                          onClick={() => retryLastMessage()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Tentar novamente</span>
                        </button>
                      )}
                      {mediaError && (
                        <button
                          type="button"
                          onClick={handleTriggerPhotoAttach}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#075E54] hover:bg-[#064E46] text-white text-xs font-semibold"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Selecionar outra foto</span>
                        </button>
                      )}
                      {errorMsg && (
                        <button
                          type="button"
                          onClick={() => openHandoffPreview('sales')}
                          className="inline-flex items-center gap-1.5 text-[#008069] hover:underline font-semibold"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          <span>Falar com consultor</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMediaError(null);
                      setErrorMsg(null);
                    }}
                    aria-label="Fechar aviso"
                    className="text-red-500 hover:text-red-700 shrink-0 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Composer Dock (#F0F2F5) */}
          <div className="shrink-0 bg-[#F0F2F5] border-t border-[#D1D7DB]/70 pb-[env(safe-area-inset-bottom)] relative">
            {/* Compact Reply Preview Strip (WhatsApp Style) */}
            {replyingTo && (
              <div className="px-3 sm:px-4 pt-2">
                <div className="bg-white rounded-lg border-l-4 border-[#00A884] px-3 py-2 flex items-center justify-between gap-2 shadow-[0_1px_1px_rgba(11,20,26,0.08)]">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-[#008069] leading-tight">
                      Respondendo a{' '}
                      {replyingTo.sender === 'ia'
                        ? effectiveSettings.tradeName
                        : 'Você'}
                    </p>
                    <p className="text-xs text-[#54656F] truncate mt-0.5">
                      {replyingTo.preview}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearReply}
                    aria-label="Cancelar resposta citada"
                    className="w-7 h-7 rounded-full hover:bg-black/5 text-[#54656F] flex items-center justify-center shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Pending Attachment Preview Strip */}
            {pendingAttachment && (
              <div className="px-3 sm:px-4 pt-2">
                <div className="bg-white rounded-lg border border-[#D1D7DB] px-3 py-2 flex items-center justify-between gap-3 shadow-[0_1px_1px_rgba(11,20,26,0.08)]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {pendingAttachment.mimeType.startsWith('image/') ? (
                      <img
                        src={pendingAttachment.url}
                        alt={pendingAttachment.name}
                        className="w-11 h-11 rounded-md object-cover border border-black/10 shrink-0"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-md bg-[#E53935]/10 text-[#E53935] flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#111B21] truncate">
                        {pendingAttachment.name}
                      </p>
                      <p className="text-[11px] text-[#54656F]">
                        {pendingAttachment.mimeType === 'application/pdf'
                          ? 'Documento PDF pronto para envio'
                          : 'Foto otimizada pronta para envio'}
                        {pendingAttachment.sizeBytes
                          ? ` · ${formatBytesCompact(pendingAttachment.sizeBytes)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingAttachment(null)}
                    aria-label="Remover anexo"
                    className="w-7 h-7 rounded-full hover:bg-black/5 text-[#54656F] flex items-center justify-center shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Active Filters & Focused Vehicle Status Bar (clearly distinguishes out-of-filter focus) */}
            {!isRecording && activeFilterChips.length > 0 && (
              <div className="px-3 sm:px-4 pt-2 space-y-1 text-xs">
                {focusFilterCheck && !focusFilterCheck.matches && focusedVehicle ? (
                  <div className="rounded-lg bg-[#FFF7E6] border border-amber-300/70 px-2.5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                    <div className="min-w-0 text-[11.5px] text-[#5C3D00] leading-snug">
                      <span className="font-semibold">
                        Em foco: {getVehicleDisplayTitle(focusedVehicle)} (
                        {analyzeVehicleDataQuality(focusedVehicle).displayTransmission})
                      </span>{' '}
                      <span className="text-[#7A5200]">
                        — fora da busca ({activeFilterChips.join(' · ')})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isSending}
                        onClick={handleReturnToActiveSearch}
                        className="text-[11.5px] font-semibold text-[#075E54] hover:underline whitespace-nowrap disabled:opacity-50"
                      >
                        Voltar à busca
                      </button>
                      <span aria-hidden="true" className="text-amber-400">·</span>
                      <button
                        type="button"
                        onClick={clearActiveFilters}
                        className="text-[11.5px] font-medium text-[#54656F] hover:underline whitespace-nowrap"
                      >
                        Limpar filtros
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 overflow-x-auto min-w-0">
                      <span className="text-[11px] font-semibold text-[#54656F] shrink-0">
                        Filtros:
                      </span>
                      <span className="text-[11.5px] text-[#111B21] truncate">
                        {activeFilterChips.join(' · ')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={clearActiveFilters}
                      className="text-[11.5px] font-semibold text-[#075E54] hover:underline whitespace-nowrap shrink-0 px-1.5 py-1"
                    >
                      Limpar filtros
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Selected Vehicles Comparison Tray */}
            {!isRecording && compareVehicleIds.length > 0 && (
              <div className="px-3 sm:px-4 pt-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <GitCompareArrows className="w-4 h-4 text-[#075E54] shrink-0" />
                  <span className="text-xs text-[#111B21] truncate">
                    {compareVehicleIds.length === 1
                      ? '1 veículo selecionado para comparar (escolha mais 1)'
                      : `${compareVehicleIds.length} veículos selecionados para comparar`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {compareVehicleIds.length >= 2 && (
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={() => compareSelectedVehicles()}
                      className="min-h-[34px] px-3 py-1 rounded-lg bg-[#075E54] hover:bg-[#064E46] text-white text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      Comparar ({compareVehicleIds.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={clearCompareVehicles}
                    aria-label="Limpar seleção de comparação"
                    className="min-h-[34px] px-2 py-1 rounded-lg text-xs text-[#54656F] hover:bg-black/5"
                  >
                    Limpar
                  </button>
                </div>
              </div>
            )}

            {/* Attachment Popover Menu */}
            {attachMenuOpen && !isRecording && (
              <div className="absolute bottom-[68px] left-3 sm:left-4 z-30 bg-white rounded-2xl shadow-xl border border-[#D1D7DB] p-2 w-60 space-y-1">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="w-full px-3 py-2.5 rounded-xl hover:bg-[#F0F2F5] flex items-center gap-3 text-left transition-colors"
                >
                  <span className="w-9 h-9 rounded-full bg-[#007BFC]/12 text-[#007BFC] flex items-center justify-center shrink-0">
                    <Camera className="w-4 h-4" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-[#111B21]">
                      Foto / Imagem
                    </p>
                    <p className="text-[11px] text-[#667781]">
                      JPG, PNG ou WEBP (ex.: carro na troca)
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => pdfInputRef.current?.click()}
                  className="w-full px-3 py-2.5 rounded-xl hover:bg-[#F0F2F5] flex items-center gap-3 text-left transition-colors"
                >
                  <span className="w-9 h-9 rounded-full bg-[#7F66FF]/12 text-[#5E4AE3] flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-[#111B21]">
                      Documento PDF
                    </p>
                    <p className="text-[11px] text-[#667781]">
                      CRLV, ficha técnica ou proposta (até 2,4 MB)
                    </p>
                  </div>
                </button>
              </div>
            )}

            {/* Composer Bar: Recording State vs Normal Input State */}
            {isRecording ? (
              <div className="relative z-20 w-full max-w-full box-border px-2.5 sm:px-4 py-2.5 flex flex-nowrap items-center gap-2 overflow-hidden">
                <button
                  type="button"
                  onClick={cancelAudioRecording}
                  disabled={isFinalizingAudio}
                  aria-label="Cancelar e excluir gravação de áudio"
                  title="Cancelar áudio"
                  className="w-[44px] h-[44px] rounded-full bg-white hover:bg-red-50 text-red-600 border border-red-200 shadow-xs transition-colors shrink-0 inline-flex items-center justify-center active:scale-95 cursor-pointer touch-manipulation disabled:opacity-50"
                >
                  <Trash2 className="w-5 h-5" />
                </button>

                <div className="flex-1 min-w-0 overflow-hidden h-[44px] px-3 sm:px-4 bg-white rounded-full shadow-[0_1px_1px_rgba(11,20,26,0.08)] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse shrink-0" />
                    <span className="font-mono text-sm font-semibold tabular-nums text-[#111B21] shrink-0">
                      {formatDurationSeconds(recordingSec)}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-[#8696A0] shrink-0">
                      / {formatDurationSeconds(MAX_AUDIO_DURATION_SEC)}
                    </span>
                    <span className="hidden md:inline text-xs text-[#54656F] truncate ml-1">
                      Gravando áudio... clique em Enviar ao terminar
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={finishAndSendAudioRecording}
                  disabled={isFinalizingAudio}
                  aria-label="Parar e enviar áudio gravado"
                  title="Parar e enviar áudio agora"
                  className="h-[44px] px-3.5 sm:px-4 rounded-full bg-[#00A884] hover:bg-[#008F72] text-white text-xs sm:text-sm font-semibold shadow-md transition-colors shrink-0 inline-flex items-center justify-center gap-1.5 whitespace-nowrap active:scale-95 cursor-pointer touch-manipulation disabled:opacity-70"
                >
                  {isFinalizingAudio ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <Send className="w-4 h-4 shrink-0" />
                  )}
                  <span>Enviar</span>
                </button>
              </div>
            ) : (
              <form
                onSubmit={handleFormSubmit}
                className="px-3 sm:px-4 py-2.5 flex items-center gap-2"
              >
                {/* Attachment Clip Button (active once triage is complete) */}
                {isTriageComplete && (
                  <button
                    type="button"
                    disabled={isSending || isProcessingFile}
                    onClick={() => setAttachMenuOpen((prev) => !prev)}
                    aria-label="Anexar foto ou documento PDF"
                    title="Anexar foto ou PDF"
                    className={`w-[42px] h-[42px] rounded-full transition-colors shrink-0 inline-flex items-center justify-center ${
                      attachMenuOpen || pendingAttachment
                        ? 'bg-[#00A884]/15 text-[#075E54]'
                        : 'text-[#54656F] hover:bg-black/[0.06]'
                    } disabled:opacity-50`}
                  >
                    {isProcessingFile ? (
                      <Loader2 className="w-5 h-5 animate-spin text-[#00A884]" />
                    ) : (
                      <Paperclip className="w-5 h-5" />
                    )}
                  </button>
                )}

                <input
                  ref={textInputRef}
                  type="text"
                  inputMode="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    pendingAttachment
                      ? 'Adicione uma legenda opcional ou envie...'
                      : 'Digite sua mensagem...'
                  }
                  className="flex-1 min-h-[44px] px-4 py-2 bg-white border border-transparent focus:border-[#00A884]/50 rounded-full text-[15px] text-[#111B21] placeholder:text-[#667781] shadow-[0_1px_1px_rgba(11,20,26,0.08)] focus:outline-none"
                />

                {canSendTextOrAttachment || !isTriageComplete ? (
                  <button
                    type="submit"
                    disabled={
                      isSending ||
                      isProcessingFile ||
                      !canSendTextOrAttachment
                    }
                    aria-label="Enviar mensagem"
                    className="w-[44px] h-[44px] rounded-full bg-[#00A884] hover:bg-[#008F72] disabled:bg-[#8696A0] text-white shadow-xs transition-colors shrink-0 inline-flex items-center justify-center active:scale-95"
                  >
                    <Send className="w-4 h-4 translate-x-[1px]" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isSending || isProcessingFile}
                    onClick={() => void startAudioRecording()}
                    aria-label="Gravar mensagem de áudio"
                    title="Gravar áudio"
                    className="w-[44px] h-[44px] rounded-full bg-[#00A884] hover:bg-[#008F72] disabled:bg-[#8696A0] text-white shadow-xs transition-colors shrink-0 inline-flex items-center justify-center active:scale-95"
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                )}
              </form>
            )}
          </div>
        </div>

        {/* Desktop Collapsible Side Panel for LGPD Lead Capture */}
        {leadPanelOpen && (
          <aside className="hidden lg:flex w-[340px] shrink-0 h-full bg-[#F8F9FA] border-l border-[#D1D7DB] flex-col">
            <div className="h-[60px] shrink-0 px-4 bg-[#075E54] text-white flex items-center justify-between gap-2 border-l border-white/10">
              <span className="text-sm font-semibold">Dados do Atendimento</span>
              <button
                type="button"
                onClick={() => setLeadPanelOpen(false)}
                aria-label="Fechar painel de contato"
                className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center text-white/90"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">{renderLeadFormBody()}</div>
          </aside>
        )}
      </div>

      {/* Mobile Compact Bottom Sheet Modal for LGPD Lead Capture */}
      {leadPanelOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/55 flex items-end justify-center"
          onClick={() => setLeadPanelOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-[#F8F9FA] rounded-t-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-h-[88dvh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 rounded-full bg-[#D1D7DB] mx-auto mb-3" />
            <div className="flex items-center justify-between mb-3">
              <span className="font-display text-sm font-semibold text-[#111B21]">
                Atendimento & Simulação
              </span>
              <button
                type="button"
                onClick={() => setLeadPanelOpen(false)}
                aria-label="Fechar formulário"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-[#54656F] hover:bg-black/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderLeadFormBody()}
          </div>
        </div>
      )}

      {/* Fullscreen Image Lightbox */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="max-w-3xl w-full flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full flex items-center justify-between text-white px-1">
              <span className="text-xs font-medium truncate inline-flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-[#25D366]" />
                {lightboxImage.name}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={lightboxImage.url}
                  download={lightboxImage.name}
                  className="px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar</span>
                </a>
                <button
                  type="button"
                  onClick={() => setLightboxImage(null)}
                  aria-label="Fechar imagem"
                  className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.name}
              className="max-h-[80dvh] max-w-full rounded-lg object-contain shadow-2xl"
            />
          </div>
        </div>
      )}
      {/* Confirm Clear Conversation Modal */}
      {confirmClearOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4"
          onClick={() => setConfirmClearOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-[#D1D7DB] p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1.5">
              <h2 className="font-display text-base font-semibold text-[#111B21]">
                Nova conversa / Trocar usuário?
              </h2>
              <p className="text-xs text-[#54656F] leading-relaxed">
                O histórico e a identificação salvos neste navegador serão
                removidos e uma nova sessão limpa será iniciada.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(false)}
                className="min-h-[40px] px-4 rounded-xl text-xs font-medium text-[#54656F] hover:bg-[#F0F2F5] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmClearConversation}
                className="min-h-[40px] px-4 rounded-xl text-xs font-semibold text-white bg-[#00A884] hover:bg-[#008F72] transition-colors"
              >
                Iniciar nova conversa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Handoff Preview Modal (user reviews message & opt-in before opening WhatsApp) */}
      <WhatsAppHandoffModal
        isOpen={handoffModalState.isOpen}
        onClose={() =>
          setHandoffModalState((prev) => ({
            ...prev,
            isOpen: false,
            focusedVehicle: undefined,
          }))
        }
        settings={effectiveSettings}
        fallbackWhatsapp={storeWhatsappNumber}
        purpose={handoffModalState.purpose}
        focusedVehicle={
          handoffModalState.focusedVehicle !== undefined
            ? handoffModalState.focusedVehicle
            : focusedVehicle
        }
        recentVehicles={recentVehicles}
        baseUrl={appOrigin}
        vehicleLabel={handoffModalState.vehicleLabel}
        contextSummary={handoffModalState.contextSummary}
        sessionId={sessionId}
        leadName={customerName}
        leadPhone={customerWhatsapp}
        messages={messages}
        vehicles={vehicles}
        onBeforeOpenWhatsApp={handleTrackWhatsAppHandoff}
      />
    </div>
  );
};
