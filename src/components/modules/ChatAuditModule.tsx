import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Image as ImageIcon,
  Kanban,
  Loader2,
  MessageCircle,
  MessageSquareText,
  Mic,
  Paperclip,
  Phone,
  RefreshCw,
  Reply,
  Search,
  Sparkles,
  Tag,
  User,
  X,
} from 'lucide-react';
import {
  ChatAuditMessage,
  ChatSessionSummary,
  DealershipSettings,
  Lead,
} from '../../types';
import { ApiLeadRow, mapDbLeadToFrontend } from '../../db/mappers';
import { adminFetch } from '../../utils/authSession';
import {
  CHAT_LEAD_TAGS,
  ChatLeadTagId,
  getChatTagConfig,
} from '../../utils/chatTags';
import { formatWhatsAppLink } from '../../utils/formatters';
import { ChatMarkdown } from '../public/ChatMarkdown';

interface ChatAuditModuleProps {
  settings: DealershipSettings;
  onUnauthorized: () => void;
  onLeadSyncedFromChat?: (lead: Lead, action: 'created' | 'updated') => void;
  onOpenCrm?: (leadId?: string) => void;
}

interface AttachmentPreviewModalState {
  type: 'pdf' | 'image' | 'other';
  blobUrl: string;
  name: string;
  mimeType: string;
}

function formatDateTimePt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatTimePt(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function detectAttachmentKind(
  msg: ChatAuditMessage
): 'image' | 'pdf' | 'other' | null {
  if (!msg.attachmentUrl && !msg.attachmentDownloadUrl) return null;
  const mime = (msg.attachmentMime || '').toLowerCase();
  const name = (msg.attachmentName || '').toLowerCase();
  const url = msg.attachmentUrl || '';

  if (
    mime.startsWith('image/') ||
    url.startsWith('data:image/') ||
    /\.(jpe?g|png|webp|gif)$/i.test(name)
  ) {
    return 'image';
  }
  if (
    mime === 'application/pdf' ||
    url.startsWith('data:application/pdf') ||
    name.endsWith('.pdf')
  ) {
    return 'pdf';
  }
  return 'other';
}

function dataUrlToBlob(dataUrl: string, fallbackMime?: string): Blob | null {
  if (!dataUrl.startsWith('data:')) return null;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return null;
  const header = dataUrl.slice(5, commaIdx);
  const base64 = dataUrl.slice(commaIdx + 1).replace(/\s+/g, '');
  const mime =
    header.split(';')[0]?.trim() || fallbackMime || 'application/octet-stream';

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

export const ChatAuditModule: React.FC<ChatAuditModuleProps> = ({
  settings,
  onUnauthorized,
  onLeadSyncedFromChat,
  onOpenCrm,
}) => {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [messages, setMessages] = useState<ChatAuditMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [originFilter, setOriginFilter] = useState<'Todos' | '/chat' | 'Vitrine'>(
    'Todos'
  );
  const [collapsedTranscriptions, setCollapsedTranscriptions] = useState<
    Record<number, boolean>
  >({});
  const [previewModal, setPreviewModal] =
    useState<AttachmentPreviewModalState | null>(null);
  const [busyAttachmentId, setBusyAttachmentId] = useState<number | null>(null);
  const [attachmentActionError, setAttachmentActionError] = useState<
    string | null
  >(null);
  const [savingTagSessionId, setSavingTagSessionId] = useState<string | null>(
    null
  );
  const [generatingSummarySessionId, setGeneratingSummarySessionId] = useState<
    string | null
  >(null);
  const [copiedSummarySessionId, setCopiedSummarySessionId] = useState<
    string | null
  >(null);
  const [tagFeedback, setTagFeedback] = useState<{
    sessionId: string;
    type: 'success' | 'error';
    message: string;
    leadId?: string;
  } | null>(null);

  const createdBlobUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      createdBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      createdBlobUrlsRef.current = [];
    };
  }, []);

  const registerBlobUrl = (blob: Blob): string => {
    const blobUrl = URL.createObjectURL(blob);
    createdBlobUrlsRef.current.push(blobUrl);
    return blobUrl;
  };

  const resolveMessageAttachmentBlob = useCallback(
    async (
      msg: ChatAuditMessage
    ): Promise<{ blobUrl: string; name: string; mimeType: string }> => {
      const kind = detectAttachmentKind(msg);
      const defaultName =
        msg.attachmentName?.trim() ||
        (kind === 'pdf'
          ? `documento-${msg.id}.pdf`
          : kind === 'image'
            ? `foto-${msg.id}.jpg`
            : `anexo-${msg.id}`);
      const defaultMime =
        msg.attachmentMime ||
        (kind === 'pdf'
          ? 'application/pdf'
          : kind === 'image'
            ? 'image/jpeg'
            : 'application/octet-stream');

      if (msg.attachmentUrl?.startsWith('data:')) {
        const blob = dataUrlToBlob(msg.attachmentUrl, defaultMime);
        if (blob) {
          return {
            blobUrl: registerBlobUrl(blob),
            name: defaultName,
            mimeType: blob.type || defaultMime,
          };
        }
      }

      const fetchUrl =
        msg.attachmentDownloadUrl ||
        `/api/admin/chat-messages/${msg.id}/attachment`;
      const res = await adminFetch(fetchUrl);
      if (res.status === 401) {
        onUnauthorized();
        throw new Error('Sessão administrativa expirada.');
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          err.error || 'Não foi possível carregar o anexo no servidor.'
        );
      }
      const blob = await res.blob();
      return {
        blobUrl: registerBlobUrl(blob),
        name: defaultName,
        mimeType: blob.type || defaultMime,
      };
    },
    [onUnauthorized]
  );

  const handleViewAttachment = async (msg: ChatAuditMessage) => {
    setAttachmentActionError(null);
    setBusyAttachmentId(msg.id);
    try {
      const kind = detectAttachmentKind(msg) || 'other';
      const resolved = await resolveMessageAttachmentBlob(msg);
      setPreviewModal({
        type: kind,
        blobUrl: resolved.blobUrl,
        name: resolved.name,
        mimeType: resolved.mimeType,
      });
    } catch (err: unknown) {
      setAttachmentActionError(
        err instanceof Error
          ? err.message
          : 'Erro ao abrir visualização do anexo.'
      );
    } finally {
      setBusyAttachmentId(null);
    }
  };

  const handleDownloadAttachment = async (msg: ChatAuditMessage) => {
    setAttachmentActionError(null);
    setBusyAttachmentId(msg.id);
    try {
      const resolved = await resolveMessageAttachmentBlob(msg);
      const link = document.createElement('a');
      link.href = resolved.blobUrl;
      link.download = resolved.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: unknown) {
      setAttachmentActionError(
        err instanceof Error ? err.message : 'Erro ao baixar anexo.'
      );
    } finally {
      setBusyAttachmentId(null);
    }
  };

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    setSessionsError(null);
    try {
      const res = await adminFetch('/api/admin/chat-sessions');
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          err.error || 'Falha ao carregar sessões de atendimento da IA.'
        );
      }
      const data = (await res.json()) as ChatSessionSummary[];
      setSessions(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length > 0) {
        setSelectedSessionId((prev) =>
          prev && data.some((s) => s.sessionId === prev)
            ? prev
            : data[0].sessionId
        );
      }
    } catch (err: unknown) {
      setSessionsError(
        err instanceof Error
          ? err.message
          : 'Erro ao carregar histórico de conversas.'
      );
    } finally {
      setLoadingSessions(false);
    }
  }, [onUnauthorized]);

  const fetchSessionMessages = useCallback(
    async (sessionId: string) => {
      setLoadingMessages(true);
      setMessagesError(null);
      setAttachmentActionError(null);
      try {
        const res = await adminFetch(
          `/api/admin/chat-sessions/${encodeURIComponent(sessionId)}/messages`
        );
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || 'Erro ao carregar mensagens da sessão.');
        }
        const data = (await res.json()) as {
          messages?: ChatAuditMessage[];
        };
        setMessages(Array.isArray(data.messages) ? data.messages : []);
      } catch (err: unknown) {
        setMessagesError(
          err instanceof Error
            ? err.message
            : 'Erro ao abrir histórico de diálogo.'
        );
        setMessages([]);
      } finally {
        setLoadingMessages(false);
      }
    },
    [onUnauthorized]
  );

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    if (selectedSessionId) {
      void fetchSessionMessages(selectedSessionId);
    } else {
      setMessages([]);
    }
  }, [selectedSessionId, fetchSessionMessages]);

  const filteredSessions = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return sessions.filter((s) => {
      const matchesOrigin =
        originFilter === 'Todos' ||
        (originFilter === '/chat'
          ? s.origem.toLowerCase().includes('/chat')
          : s.origem.toLowerCase().includes('vitrine'));
      if (!matchesOrigin) return false;
      if (!q) return true;
      return (
        (s.leadName || '').toLowerCase().includes(q) ||
        (s.leadPhone || '').toLowerCase().includes(q) ||
        (s.tag || '').toLowerCase().includes(q) ||
        s.sessionId.toLowerCase().includes(q) ||
        String(s.id).includes(q) ||
        (s.lastMessage || '').toLowerCase().includes(q)
      );
    });
  }, [originFilter, searchTerm, sessions]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.sessionId === selectedSessionId) || null,
    [selectedSessionId, sessions]
  );

  const handleSelectSessionTag = async (
    sessionId: string,
    nextTag: ChatLeadTagId | null
  ) => {
    if (savingTagSessionId === sessionId) return;
    setSavingTagSessionId(sessionId);
    setTagFeedback(null);
    try {
      const res = await adminFetch(
        `/api/admin/chat-sessions/${encodeURIComponent(sessionId)}/tag`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag: nextTag }),
        }
      );
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          err.error || 'Não foi possível salvar a etiqueta da conversa.'
        );
      }

      const data = (await res.json()) as {
        sessionId: string;
        tag: string | null;
        crmAction: 'created' | 'updated' | 'none';
        lead: ApiLeadRow | null;
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.sessionId === sessionId ? { ...s, tag: data.tag } : s
        )
      );

      let syncedLeadId: string | undefined;
      if (data.lead && (data.crmAction === 'created' || data.crmAction === 'updated')) {
        const mappedLead = mapDbLeadToFrontend(data.lead);
        syncedLeadId = mappedLead.id;
        onLeadSyncedFromChat?.(mappedLead, data.crmAction);
      }

      if (data.crmAction === 'created') {
        setTagFeedback({
          sessionId,
          type: 'success',
          message: 'Etiqueta salva e card criado automaticamente no CRM!',
          leadId: syncedLeadId,
        });
      } else if (data.crmAction === 'updated') {
        setTagFeedback({
          sessionId,
          type: 'success',
          message: 'Etiqueta salva e card atualizado no CRM!',
          leadId: syncedLeadId,
        });
      } else {
        setTagFeedback({
          sessionId,
          type: 'success',
          message: 'Etiqueta removida desta conversa.',
        });
      }
    } catch (err: unknown) {
      setTagFeedback({
        sessionId,
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Falha ao salvar etiqueta no servidor.',
      });
    } finally {
      setSavingTagSessionId(null);
    }
  };

  const handleGenerateCrmSummary = async (sessionId: string) => {
    if (generatingSummarySessionId === sessionId) return;
    setGeneratingSummarySessionId(sessionId);
    setTagFeedback(null);
    try {
      const res = await adminFetch(
        `/api/admin/chat-sessions/${encodeURIComponent(sessionId)}/summary`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          err.error || 'Não foi possível gerar o resumo comercial desta conversa.'
        );
      }

      const data = (await res.json()) as {
        sessionId: string;
        aiSummary: string;
        aiSummaryUpdatedAt: string | null;
        crmAction: 'created' | 'updated';
        lead: ApiLeadRow | null;
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.sessionId === sessionId
            ? {
                ...s,
                aiSummary: data.aiSummary,
                aiSummaryUpdatedAt: data.aiSummaryUpdatedAt,
              }
            : s
        )
      );

      let syncedLeadId: string | undefined;
      if (data.lead) {
        const mappedLead = mapDbLeadToFrontend(data.lead);
        syncedLeadId = mappedLead.id;
        onLeadSyncedFromChat?.(mappedLead, data.crmAction);
      }

      setTagFeedback({
        sessionId,
        type: 'success',
        message:
          data.crmAction === 'created'
            ? 'Resumo gerado e novo card criado no CRM!'
            : 'Resumo gerado e anexado ao card existente no CRM!',
        leadId: syncedLeadId,
      });
    } catch (err: unknown) {
      setTagFeedback({
        sessionId,
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Falha ao gerar resumo comercial com a IA.',
      });
    } finally {
      setGeneratingSummarySessionId(null);
    }
  };

  const handleCopySummary = async (sessionId: string, summaryText: string) => {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopiedSummarySessionId(sessionId);
      window.setTimeout(() => {
        setCopiedSummarySessionId((prev) => (prev === sessionId ? null : prev));
      }, 2200);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const toggleTranscription = (msgId: number) => {
    setCollapsedTranscriptions((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[240px] max-w-sm">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar nome, telefone, ID ou trecho..."
              className="w-full pl-10 pr-4 py-2 bg-[#111114] border border-white/[0.08] focus:border-red-600/60 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#111114] border border-white/[0.08] rounded-lg">
            {(['Todos', '/chat', 'Vitrine'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setOriginFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  originFilter === tab
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab === '/chat' ? 'Rota /chat' : tab}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void fetchSessions()}
          disabled={loadingSessions}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-[#111114] hover:bg-white/[0.06] border border-white/[0.08] transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${loadingSessions ? 'animate-spin' : ''}`}
          />
          <span>Atualizar Conversas</span>
        </button>
      </div>

      {sessionsError && (
        <div className="p-3.5 rounded-lg bg-red-950/50 border border-red-600/40 flex items-center gap-2.5 text-xs text-red-200">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{sessionsError}</span>
        </div>
      )}

      {/* Master-Detail Audit Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[600px]">
        {/* Left List: Sessions */}
        <section className="lg:col-span-4 bg-[#111114] border border-white/[0.08] rounded-xl flex flex-col overflow-hidden max-h-[72vh]">
          <div className="px-4 py-3.5 border-b border-white/[0.08] flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-semibold text-white">
              Sessões Gravadas
            </h2>
            <span className="text-xs font-mono tabular-nums text-zinc-400">
              {filteredSessions.length} registro
              {filteredSessions.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.06]">
            {loadingSessions && sessions.length === 0 ? (
              <div className="p-6 flex items-center justify-center gap-2 text-xs text-zinc-400">
                <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                <span>Carregando sessões no Neon...</span>
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <MessageSquareText className="w-7 h-7 text-zinc-600 mx-auto" />
                <p className="text-sm font-medium text-zinc-200">
                  Nenhuma conversa encontrada
                </p>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Todas as interações realizadas na rota /chat ou no widget da
                  vitrine aparecerão automaticamente aqui.
                </p>
              </div>
            ) : (
              filteredSessions.map((session) => {
                const isSelected = session.sessionId === selectedSessionId;
                const displayName =
                  session.leadName?.trim() || `Visitante Anônimo #${session.id}`;
                const tagCfg = getChatTagConfig(session.tag);
                return (
                  <button
                    key={session.sessionId}
                    type="button"
                    onClick={() => {
                      setSelectedSessionId(session.sessionId);
                      if (tagFeedback && tagFeedback.sessionId !== session.sessionId) {
                        setTagFeedback(null);
                      }
                    }}
                    className={`w-full text-left px-4 py-3.5 transition-colors ${
                      isSelected ? 'bg-red-600/12' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-white truncate">
                        {displayName}
                      </p>
                      <span className="text-[11px] font-mono tabular-nums text-zinc-500 shrink-0">
                        {formatDateTimePt(session.updatedAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-zinc-400 mt-0.5 truncate">
                      {session.leadPhone ? (
                        <span className="font-mono text-emerald-400">
                          {session.leadPhone}
                        </span>
                      ) : (
                        <span className="font-mono text-zinc-500">
                          {session.sessionId.slice(0, 14)}
                        </span>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>{session.origem}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {session.messageCount} msg
                      </span>
                    </div>

                    {tagCfg && (
                      <div className="mt-1.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-medium ${tagCfg.badgeClass}`}
                        >
                          {tagCfg.label}
                        </span>
                      </div>
                    )}

                    {session.lastMessage && (
                      <p className="text-xs text-zinc-400 truncate mt-1.5">
                        <span className="text-zinc-500">
                          {session.lastSender === 'user' ? 'Cliente: ' : 'IA: '}
                        </span>
                        {session.lastMessage.replace(/\*\*/g, '')}
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right Detail: Full Transcript */}
        <section className="lg:col-span-8 bg-[#111114] border border-white/[0.08] rounded-xl flex flex-col overflow-hidden max-h-[72vh]">
          {!activeSession ? (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center space-y-2">
              <MessageSquareText className="w-8 h-8 text-zinc-600" />
              <p className="text-sm font-medium text-zinc-200">
                Selecione uma conversa para auditar
              </p>
              <p className="text-xs text-zinc-500 max-w-md">
                Acompanhe perguntas, áudios transcritos, fotos de troca, PDFs e
                assuma o atendimento pelo WhatsApp em um clique.
              </p>
            </div>
          ) : (
            <>
              {/* Conversation Header */}
              <div className="px-5 py-4 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-4 bg-[#0D0D10]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-base font-semibold text-white truncate">
                      {activeSession.leadName?.trim() ||
                        `Visitante Anônimo #${activeSession.id}`}
                    </h3>
                    {(() => {
                      const activeTagCfg = getChatTagConfig(activeSession.tag);
                      return activeTagCfg ? (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${activeTagCfg.badgeClass}`}
                        >
                          {activeTagCfg.label}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mt-1">
                    {activeSession.leadPhone ? (
                      <span className="inline-flex items-center gap-1 font-mono text-emerald-400">
                        <Phone className="w-3 h-3" />
                        {activeSession.leadPhone}
                      </span>
                    ) : (
                      <span className="text-zinc-500">
                        {activeSession.leadName?.trim()
                          ? 'Sem WhatsApp informado'
                          : 'Lead ainda não identificado'}
                      </span>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>Origem: {activeSession.origem}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums text-zinc-500">
                      <Clock className="w-3 h-3" />
                      {formatDateTimePt(activeSession.updatedAt)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={
                      generatingSummarySessionId === activeSession.sessionId ||
                      loadingMessages ||
                      messages.length === 0
                    }
                    onClick={() =>
                      void handleGenerateCrmSummary(activeSession.sessionId)
                    }
                    title="Chama a IA sob demanda para resumir esta conversa e anexar nas notas do CRM"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-100 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.12] hover:border-red-500/45 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {generatingSummarySessionId === activeSession.sessionId ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                        <span>Gerando resumo...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                        <span>
                          {activeSession.aiSummary
                            ? 'Atualizar Resumo CRM'
                            : 'Gerar Resumo para o CRM'}
                        </span>
                      </>
                    )}
                  </button>

                  {activeSession.leadPhone ? (
                    <a
                      href={formatWhatsAppLink(
                        activeSession.leadPhone,
                        `Olá${
                          activeSession.leadName
                            ? `, ${activeSession.leadName}`
                            : ''
                        }! Aqui é da equipe ${settings.tradeName}. Vi sua conversa com nosso Consultor Virtual e vou dar continuidade ao seu atendimento.`
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
                    >
                      <MessageCircle className="w-4 h-4" />
                      <span>Assumir no WhatsApp</span>
                    </a>
                  ) : (
                    <span className="text-xs text-zinc-500 font-mono">
                      ID {activeSession.sessionId.slice(0, 16)}
                    </span>
                  )}
                </div>
              </div>

              {/* Quick Classification & Automatic CRM Card Bar */}
              <div className="px-5 py-3 border-b border-white/[0.08] bg-[#101014] space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 mr-1">
                    <Tag className="w-3.5 h-3.5 text-red-400" />
                    <span>Classificar & Enviar ao CRM:</span>
                  </span>

                  {CHAT_LEAD_TAGS.map((tagOpt) => {
                    const isActive = activeSession.tag === tagOpt.id;
                    const isSavingThis =
                      savingTagSessionId === activeSession.sessionId;
                    return (
                      <button
                        key={tagOpt.id}
                        type="button"
                        disabled={isSavingThis}
                        onClick={() =>
                          void handleSelectSessionTag(
                            activeSession.sessionId,
                            isActive ? null : tagOpt.id
                          )
                        }
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all cursor-pointer disabled:opacity-60 inline-flex items-center gap-1.5 ${
                          isActive
                            ? tagOpt.activeButtonClass
                            : tagOpt.inactiveButtonClass
                        }`}
                      >
                        <span>{tagOpt.label}</span>
                      </button>
                    );
                  })}

                  {savingTagSessionId === activeSession.sessionId && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 ml-1">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                      <span>Sincronizando CRM...</span>
                    </span>
                  )}

                  {activeSession.tag &&
                    savingTagSessionId !== activeSession.sessionId && (
                      <button
                        type="button"
                        onClick={() =>
                          void handleSelectSessionTag(
                            activeSession.sessionId,
                            null
                          )
                        }
                        className="px-2 py-1 rounded-lg text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors inline-flex items-center gap-1"
                        title="Remover etiqueta desta conversa"
                      >
                        <X className="w-3 h-3" />
                        <span>Limpar</span>
                      </button>
                    )}
                </div>

                {tagFeedback &&
                  tagFeedback.sessionId === activeSession.sessionId && (
                    <div
                      className={`px-3 py-2 rounded-lg border flex flex-wrap items-center justify-between gap-2 text-xs ${
                        tagFeedback.type === 'success'
                          ? 'bg-emerald-950/50 border-emerald-500/35 text-emerald-200'
                          : 'bg-red-950/50 border-red-600/40 text-red-200'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        {tagFeedback.type === 'success' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                        )}
                        <span>{tagFeedback.message}</span>
                      </span>

                      <div className="flex items-center gap-2">
                        {tagFeedback.type === 'success' &&
                          tagFeedback.leadId &&
                          onOpenCrm && (
                            <button
                              type="button"
                              onClick={() => onOpenCrm(tagFeedback.leadId)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                            >
                              <Kanban className="w-3.5 h-3.5" />
                              <span>Abrir no CRM</span>
                            </button>
                          )}
                        <button
                          type="button"
                          onClick={() => setTagFeedback(null)}
                          aria-label="Fechar aviso"
                          className="text-zinc-400 hover:text-white"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                {/* Persisted On-Demand Commercial Summary for CRM */}
                {activeSession.aiSummary && (
                  <div className="p-3.5 rounded-xl bg-[#15151B] border border-amber-500/25 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="text-xs font-semibold text-amber-200">
                          Resumo Comercial para o CRM
                        </span>
                        {activeSession.aiSummaryUpdatedAt && (
                          <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                            · {formatDateTimePt(activeSession.aiSummaryUpdatedAt)}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopySummary(
                            activeSession.sessionId,
                            activeSession.aiSummary!
                          )
                        }
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors"
                      >
                        {copiedSummarySessionId === activeSession.sessionId ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="text-xs text-zinc-200 leading-relaxed">
                      <ChatMarkdown
                        content={activeSession.aiSummary}
                        variant="ai"
                      />
                    </div>
                  </div>
                )}
              </div>

              {attachmentActionError && (
                <div className="mx-5 mt-3 p-2.5 rounded-lg bg-red-950/50 border border-red-600/40 flex items-center justify-between gap-2 text-xs text-red-200">
                  <span className="inline-flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>{attachmentActionError}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachmentActionError(null)}
                    aria-label="Fechar erro"
                    className="text-red-300 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Transcript Feed */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#09090B]">
                {loadingMessages ? (
                  <div className="py-12 flex items-center justify-center gap-2 text-xs text-zinc-400">
                    <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                    <span>Carregando histórico completo...</span>
                  </div>
                ) : messagesError ? (
                  <div className="p-3.5 rounded-lg bg-red-950/50 border border-red-600/40 flex items-center gap-2 text-xs text-red-200">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>{messagesError}</span>
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-10">
                    Nenhuma mensagem registrada nesta sessão até o momento.
                  </p>
                ) : (
                  messages.map((msg) => {
                    const isAssistant = msg.sender === 'assistant';
                    const attachmentKind = detectAttachmentKind(msg);
                    const isBusy = busyAttachmentId === msg.id;
                    const isTranscriptionHidden = Boolean(
                      collapsedTranscriptions[msg.id]
                    );
                    const hideDuplicateAudioText =
                      Boolean(msg.audioUrl) &&
                      (!msg.content.trim() ||
                        msg.content.trim() === 'Mensagem de áudio' ||
                        msg.content.trim() === (msg.transcription || '').trim());
                    const hideDefaultAttachmentPlaceholder =
                      Boolean(attachmentKind) &&
                      msg.content.trim().startsWith('Anexo enviado:');

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${
                          isAssistant ? 'items-start' : 'items-end'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-1">
                          {isAssistant ? (
                            <>
                              <Bot className="w-3 h-3 text-red-500" />
                              <span>{settings.aiAssistantName}</span>
                            </>
                          ) : (
                            <>
                              <User className="w-3 h-3 text-zinc-400" />
                              <span>
                                {activeSession.leadName?.trim() || 'Visitante'}
                              </span>
                            </>
                          )}
                          <span>·</span>
                          <span className="font-mono tabular-nums">
                            {formatTimePt(msg.createdAt)}
                          </span>
                        </div>

                        <div
                          className={`max-w-[88%] rounded-xl px-4 py-3 space-y-2.5 ${
                            isAssistant
                              ? 'bg-[#18181C] text-zinc-200 border border-white/[0.08]'
                              : 'bg-emerald-950/50 text-zinc-100 border border-emerald-500/30'
                          }`}
                        >
                          {/* Quoted Reply Reference */}
                          {msg.replyToPreview && (
                            <div className="rounded-md bg-black/30 border-l-2 border-emerald-400 px-3 py-1.5 text-xs">
                              <p className="text-[11px] font-medium text-emerald-400 inline-flex items-center gap-1">
                                <Reply className="w-3 h-3" />
                                <span>
                                  Respondendo a{' '}
                                  {msg.replyToSender === 'assistant'
                                    ? settings.aiAssistantName
                                    : activeSession.leadName?.trim() ||
                                      'Visitante'}
                                </span>
                              </p>
                              <p className="text-zinc-400 line-clamp-2 mt-0.5">
                                {msg.replyToPreview}
                              </p>
                            </div>
                          )}

                          {/* Audio Player + Automatic Transcription */}
                          {msg.audioUrl && (
                            <div className="space-y-2 min-w-[240px]">
                              <div className="flex items-center gap-2.5">
                                <span className="w-8 h-8 rounded-full bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0">
                                  <Mic className="w-4 h-4" />
                                </span>
                                <audio
                                  controls
                                  src={msg.audioUrl}
                                  className="h-8 w-full max-w-[280px]"
                                />
                              </div>

                              {msg.transcription && (
                                <div className="rounded-lg bg-black/30 border border-white/[0.08] p-2.5 space-y-1.5">
                                  <button
                                    type="button"
                                    onClick={() => toggleTranscription(msg.id)}
                                    className="w-full flex items-center justify-between gap-2 text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
                                  >
                                    <span>Transcrição automática (IA)</span>
                                    {isTranscriptionHidden ? (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronUp className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  {!isTranscriptionHidden && (
                                    <p className="text-xs text-zinc-200 leading-relaxed">
                                      “{msg.transcription}”
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Image Attachment Block with Visualizar & Baixar */}
                          {attachmentKind === 'image' && (
                            <div className="rounded-lg bg-black/30 border border-white/[0.1] p-2.5 space-y-2.5 max-w-[320px]">
                              {msg.attachmentUrl && (
                                <button
                                  type="button"
                                  onClick={() => void handleViewAttachment(msg)}
                                  className="block w-full rounded-md overflow-hidden border border-white/10 hover:opacity-95 transition-opacity"
                                >
                                  <img
                                    src={msg.attachmentUrl}
                                    alt={msg.attachmentName || 'Foto enviada'}
                                    className="w-full max-h-[220px] object-cover block"
                                  />
                                </button>
                              )}
                              <div className="flex items-center gap-2 min-w-0">
                                <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium text-white truncate">
                                    {msg.attachmentName || 'imagem.jpg'}
                                  </p>
                                  <p className="text-[11px] text-zinc-400">
                                    Imagem anexada
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleViewAttachment(msg)}
                                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-zinc-800 hover:bg-zinc-700 border border-white/[0.1] transition-colors disabled:opacity-50"
                                >
                                  {isBusy ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Eye className="w-3.5 h-3.5" />
                                  )}
                                  <span>Visualizar</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleDownloadAttachment(msg)
                                  }
                                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors disabled:opacity-50"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Baixar</span>
                                </button>
                              </div>
                            </div>
                          )}

                          {/* PDF or Generic Document Attachment Block with Visualizar & Baixar */}
                          {(attachmentKind === 'pdf' ||
                            attachmentKind === 'other') && (
                            <div className="rounded-lg bg-black/35 border border-white/[0.12] p-3 space-y-3 min-w-[250px] max-w-[360px]">
                              <div className="flex items-center gap-3 min-w-0">
                                <div
                                  className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                                    attachmentKind === 'pdf'
                                      ? 'bg-red-600/20 border border-red-500/30 text-red-400'
                                      : 'bg-zinc-800 border border-white/10 text-zinc-300'
                                  }`}
                                >
                                  {attachmentKind === 'pdf' ? (
                                    <FileText className="w-5 h-5" />
                                  ) : (
                                    <Paperclip className="w-5 h-5" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-semibold text-white truncate">
                                    {msg.attachmentName ||
                                      (attachmentKind === 'pdf'
                                        ? 'documento.pdf'
                                        : 'arquivo-anexado')}
                                  </p>
                                  <p className="text-[11px] text-zinc-400 mt-0.5">
                                    {attachmentKind === 'pdf'
                                      ? 'Documento PDF'
                                      : msg.attachmentMime || 'Arquivo anexado'}
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleViewAttachment(msg)}
                                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-zinc-800 hover:bg-zinc-700 border border-white/[0.1] transition-colors disabled:opacity-50"
                                >
                                  {isBusy ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Eye className="w-3.5 h-3.5" />
                                  )}
                                  <span>Visualizar</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleDownloadAttachment(msg)
                                  }
                                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors disabled:opacity-50"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Baixar</span>
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Text Message Body */}
                          {msg.content &&
                            !hideDuplicateAudioText &&
                            !hideDefaultAttachmentPlaceholder && (
                              <ChatMarkdown
                                content={msg.content}
                                variant={isAssistant ? 'ai' : 'user'}
                              />
                            )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Admin Attachment Viewer Modal (Supports PDF inline iframe + Image Lightbox + New Tab + Direct Download) */}
      {previewModal && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setPreviewModal(null)}
        >
          <div
            className="max-w-4xl w-full bg-[#111114] border border-white/[0.12] rounded-xl overflow-hidden flex flex-col max-h-[90dvh] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-3 bg-[#0D0D10]">
              <span className="text-xs font-semibold text-white truncate inline-flex items-center gap-2 min-w-0">
                {previewModal.type === 'pdf' ? (
                  <FileText className="w-4 h-4 text-red-400 shrink-0" />
                ) : (
                  <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span className="truncate">{previewModal.name}</span>
              </span>

              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={previewModal.blobUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-white/[0.1] text-xs font-medium text-zinc-100 inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Abrir em nova aba</span>
                </a>
                <a
                  href={previewModal.blobUrl}
                  download={previewModal.name}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewModal(null)}
                  aria-label="Fechar visualização"
                  className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-[#09090B] p-3 flex items-center justify-center overflow-auto min-h-[420px]">
              {previewModal.type === 'image' ? (
                <img
                  src={previewModal.blobUrl}
                  alt={previewModal.name}
                  className="max-h-[75dvh] max-w-full rounded-lg object-contain"
                />
              ) : previewModal.type === 'pdf' ? (
                <iframe
                  src={previewModal.blobUrl}
                  title={previewModal.name}
                  className="w-full h-[74dvh] rounded-lg bg-white border border-white/10"
                />
              ) : (
                <div className="text-center space-y-3 py-12">
                  <Paperclip className="w-8 h-8 text-zinc-500 mx-auto" />
                  <p className="text-sm text-zinc-200">
                    Pré-visualização direta indisponível para este formato.
                  </p>
                  <a
                    href={previewModal.blobUrl}
                    download={previewModal.name}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
                  >
                    <Download className="w-4 h-4" />
                    <span>Baixar {previewModal.name}</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
