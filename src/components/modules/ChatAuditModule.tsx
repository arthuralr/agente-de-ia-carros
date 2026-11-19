import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Clock,
  Loader2,
  MessageCircle,
  MessageSquareText,
  Phone,
  RefreshCw,
  Search,
  User,
} from 'lucide-react';
import {
  ChatAuditMessage,
  ChatSessionSummary,
  DealershipSettings,
} from '../../types';
import { adminFetch } from '../../utils/authSession';
import { formatWhatsAppLink } from '../../utils/formatters';
import { ChatMarkdown } from '../public/ChatMarkdown';

interface ChatAuditModuleProps {
  settings: DealershipSettings;
  onUnauthorized: () => void;
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

export const ChatAuditModule: React.FC<ChatAuditModuleProps> = ({
  settings,
  onUnauthorized,
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
                return (
                  <button
                    key={session.sessionId}
                    type="button"
                    onClick={() => setSelectedSessionId(session.sessionId)}
                    className={`w-full text-left px-4 py-3.5 transition-colors ${
                      isSelected
                        ? 'bg-red-600/12'
                        : 'hover:bg-white/[0.03]'
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
                Acompanhe todas as perguntas dos clientes, argumentos da IA e
                assuma o atendimento pelo WhatsApp em um clique.
              </p>
            </div>
          ) : (
            <>
              {/* Conversation Header */}
              <div className="px-5 py-4 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-4 bg-[#0D0D10]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-base font-semibold text-white truncate">
                      {activeSession.leadName?.trim() ||
                        `Visitante Anônimo #${activeSession.id}`}
                    </h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mt-1">
                    {activeSession.leadPhone ? (
                      <span className="inline-flex items-center gap-1 font-mono text-emerald-400">
                        <Phone className="w-3 h-3" />
                        {activeSession.leadPhone}
                      </span>
                    ) : (
                      <span className="text-zinc-500">
                        Lead ainda não identificado
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
                          className={`max-w-[88%] rounded-xl px-4 py-3 ${
                            isAssistant
                              ? 'bg-[#18181C] text-zinc-200 border border-white/[0.08]'
                              : 'bg-emerald-950/50 text-zinc-100 border border-emerald-500/30'
                          }`}
                        >
                          <ChatMarkdown
                            content={msg.content}
                            variant={isAssistant ? 'ai' : 'user'}
                          />
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
    </div>
  );
};
