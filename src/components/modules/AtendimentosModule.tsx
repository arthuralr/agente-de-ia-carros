import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CalendarPlus,
  CarFront,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Kanban,
  Loader2,
  MessageCircle,
  MessageSquareText,
  PauseCircle,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import type {
  AdminUser,
  ChatAuditMessage,
  ChatSessionSummary,
  CopilotQueryResult,
  DealershipSettings,
  Lead,
  SessionAutomationMode,
  SessionCommercialStage,
  StaffTaskRecord,
  Vehicle,
} from '../../types';
import { adminFetch } from '../../utils/authSession';
import { formatBRL, formatKm } from '../../utils/formatters';
import { hasPermission } from '../../utils/rbac';
import { CrmModule } from './CrmModule';

interface AtendimentosModuleProps {
  currentUser: AdminUser;
  vehicles: Vehicle[];
  leads: Lead[];
  settings: DealershipSettings;
  preselectedSessionId?: string | null;
  onClearPreselectedSession?: () => void;
  preselectedLeadId?: string | null;
  onClearPreselectedLead?: () => void;
  onUnauthorized: () => void;
  onOpenDocumentForSession: (params: {
    sessionId: string;
    vehicleId: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    downPayment?: number | null;
    installments?: number | null;
  }) => void;
  onOpenMarketingForVehicle: (vehicleId: string) => void;
  onOpenVehicleSheet: (vehicleId: string) => void;
  onOpenVehicleEdit: (vehicleId: string) => void;
  // Legacy CRM props preserved when switching to Kanban sub-view
  onUpdateLead: (lead: Lead) => Promise<void>;
  onAddLead: (lead: Lead) => Promise<Lead>;
  onDeleteLead: (id: string) => Promise<void>;
  onRefreshLeads: () => Promise<void>;
}

const STAGES: SessionCommercialStage[] = [
  'Novo Lead',
  'Em Atendimento',
  'Proposta',
  'Visita',
  'Fechado',
  'Perdido',
];

const LOSS_REASONS = [
  'Preço / orçamento',
  'Crédito não aprovado',
  'Comprou em outra loja',
  'Valor da troca',
  'Desistiu da compra',
  'Sem retorno',
];

function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export const AtendimentosModule: React.FC<AtendimentosModuleProps> = ({
  currentUser,
  vehicles,
  leads,
  settings,
  preselectedSessionId,
  onClearPreselectedSession,
  preselectedLeadId,
  onClearPreselectedLead,
  onUnauthorized,
  onOpenDocumentForSession,
  onOpenMarketingForVehicle,
  onOpenVehicleSheet,
  onOpenVehicleEdit,
  onUpdateLead,
  onAddLead,
  onDeleteLead,
  onRefreshLeads,
}) => {
  const [viewTab, setViewTab] = useState<'inbox' | 'crm'>('inbox');
  const [mobilePane, setMobilePane] = useState<'queue' | 'chat' | 'summary'>('queue');

  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    preselectedSessionId || null
  );
  const [activeSession, setActiveSession] = useState<ChatSessionSummary | null>(null);
  const [messages, setMessages] = useState<ChatAuditMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [queueFilter, setQueueFilter] = useState<'todos' | 'aguardando' | 'minhas' | 'sem_resp'>('todos');
  const [stageFilter, setStageFilter] = useState<string>('Todas');
  const [searchQuery, setSearchQuery] = useState('');

  const [staffDirectory, setStaffDirectory] = useState<
    Array<{ id: number; name: string; roleCode: string; roleLabel: string }>
  >([]);
  const [tasks, setTasks] = useState<StaffTaskRecord[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [savingTask, setSavingTask] = useState(false);

  const [replyText, setReplyText] = useState('');
  const [isSuggestedDraft, setIsSuggestedDraft] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotOutput, setCopilotOutput] = useState<CopilotQueryResult | null>(null);

  const canAssignOthers = hasPermission(currentUser.roleCode, 'sessions:assign_others');
  const canReply = hasPermission(currentUser.roleCode, 'sessions:reply');

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await adminFetch('/api/admin/chat-sessions');
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) return;
      const list = (await res.json()) as ChatSessionSummary[];
      setSessions(list);
      if (!selectedSessionId && list.length > 0) {
        setSelectedSessionId(list[0].sessionId);
      }
    } finally {
      setLoadingSessions(false);
    }
  }, [onUnauthorized, selectedSessionId]);

  const fetchSessionDetails = useCallback(
    async (sid: string) => {
      setLoadingMessages(true);
      setActionError(null);
      try {
        const [msgRes, taskRes] = await Promise.all([
          adminFetch(`/api/admin/chat-sessions/${encodeURIComponent(sid)}/messages`),
          adminFetch(`/api/admin/tasks?sessionId=${encodeURIComponent(sid)}`),
        ]);
        if (msgRes.status === 401) {
          onUnauthorized();
          return;
        }
        if (msgRes.ok) {
          const data = (await msgRes.json()) as {
            session: ChatSessionSummary;
            messages: ChatAuditMessage[];
          };
          setActiveSession(data.session);
          setMessages(data.messages);
        }
        if (taskRes.ok) {
          setTasks((await taskRes.json()) as StaffTaskRecord[]);
        }
      } finally {
        setLoadingMessages(false);
      }
    },
    [onUnauthorized]
  );

  useEffect(() => {
    void fetchSessions();
    void (async () => {
      const res = await adminFetch('/api/admin/team/directory');
      if (res.ok) {
        setStaffDirectory(
          (await res.json()) as Array<{
            id: number;
            name: string;
            roleCode: string;
            roleLabel: string;
          }>
        );
      }
    })();
  }, [fetchSessions]);

  useEffect(() => {
    if (preselectedSessionId) {
      setViewTab('inbox');
      setSelectedSessionId(preselectedSessionId);
      setMobilePane('chat');
      onClearPreselectedSession?.();
    }
  }, [preselectedSessionId, onClearPreselectedSession]);

  useEffect(() => {
    if (preselectedLeadId) {
      setViewTab('crm');
    }
  }, [preselectedLeadId]);

  useEffect(() => {
    if (selectedSessionId) {
      setCopilotOutput(null);
      void fetchSessionDetails(selectedSessionId);
    }
  }, [selectedSessionId, fetchSessionDetails]);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (queueFilter === 'aguardando' && s.lastSender !== 'user') return false;
      if (queueFilter === 'minhas' && s.assignedUserId !== currentUser.id) return false;
      if (queueFilter === 'sem_resp' && s.assignedUserId) return false;
      if (stageFilter !== 'Todas' && (s.stage || 'Novo Lead') !== stageFilter) return false;
      if (q) {
        const hay = `${s.leadName || ''} ${s.leadPhone || ''} ${s.lastMessage || ''} ${s.origem || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sessions, queueFilter, stageFilter, searchQuery, currentUser.id]);

  const focusedVehicle = useMemo(() => {
    const vid =
      activeSession?.focusedVehicleId ||
      (activeSession?.context?.focusedVehicleId
        ? Number(activeSession.context.focusedVehicleId)
        : null);
    if (!vid) return null;
    return vehicles.find((v) => Number(v.id) === vid) || null;
  }, [activeSession, vehicles]);

  const handleClaim = async (force = false) => {
    if (!activeSession) return;
    setActionError(null);
    setActionNotice(null);
    const res = await adminFetch(
      `/api/admin/chat-sessions/${encodeURIComponent(activeSession.sessionId)}/claim`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: activeSession.version ?? 1, force }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      assignedUserId?: number;
      assignedUserName?: string;
      automationMode?: SessionAutomationMode;
      stage?: SessionCommercialStage;
      version?: number;
    };
    if (!res.ok) {
      setActionError(data.error || 'Não foi possível assumir o atendimento.');
      void fetchSessions();
      return;
    }
    setActionNotice(
      'Atendimento assumido por você. A IA automática foi pausada nesta conversa para evitar respostas concorrentes.'
    );
    await fetchSessionDetails(activeSession.sessionId);
    void fetchSessions();
  };

  const handleUpdateWorkflow = async (patch: {
    assignedUserId?: number | null;
    automationMode?: SessionAutomationMode;
    stage?: SessionCommercialStage;
    lossReason?: string | null;
    nextAction?: string;
  }) => {
    if (!activeSession) return;
    setActionError(null);
    const res = await adminFetch(
      `/api/admin/chat-sessions/${encodeURIComponent(activeSession.sessionId)}/workflow`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }
    );
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setActionError(data.error || 'Falha ao atualizar status.');
      return;
    }
    await fetchSessionDetails(activeSession.sessionId);
    void fetchSessions();
  };

  const handleSendReply = async (channel: 'human_chat' | 'whatsapp_manual_log') => {
    if (!activeSession || !replyText.trim() || !canReply) return;
    setSendingReply(true);
    setActionError(null);
    try {
      const res = await adminFetch(
        `/api/admin/chat-sessions/${encodeURIComponent(activeSession.sessionId)}/consultant-message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: replyText.trim(),
            deliveryChannel: channel,
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as ChatAuditMessage & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao registrar resposta.');
      }
      setMessages((prev) => [...prev, data]);
      setReplyText('');
      setIsSuggestedDraft(false);
      setActionNotice(
        channel === 'whatsapp_manual_log'
          ? 'Retorno via WhatsApp registrado manualmente no histórico (envio externo confirmado pelo operador).'
          : 'Mensagem enviada no chat do cliente com sua autoria.'
      );
      await fetchSessionDetails(activeSession.sessionId);
      void fetchSessions();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Erro ao enviar.');
    } finally {
      setSendingReply(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession || !newTaskTitle.trim()) return;
    setSavingTask(true);
    try {
      const res = await adminFetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSession.sessionId,
          vehicleId: focusedVehicle ? Number(focusedVehicle.id) : null,
          title: newTaskTitle.trim(),
        }),
      });
      if (res.ok) {
        const created = (await res.json()) as StaffTaskRecord;
        setTasks((prev) => [created, ...prev]);
        setNewTaskTitle('');
      }
    } finally {
      setSavingTask(false);
    }
  };

  const handleToggleTask = async (task: StaffTaskRecord) => {
    const nextStatus = task.status === 'concluida' ? 'pendente' : 'concluida';
    const res = await adminFetch(`/api/admin/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) {
      const updated = (await res.json()) as StaffTaskRecord;
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    }
  };

  const runSessionCopilot = async (mode: 'summary' | 'draft_reply' | 'alternatives') => {
    if (!activeSession) return;
    setCopilotLoading(true);
    setActionError(null);
    try {
      const res = await adminFetch('/api/admin/copilot/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          sessionId: activeSession.sessionId,
          vehicleId: focusedVehicle ? Number(focusedVehicle.id) : null,
          query: mode,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as CopilotQueryResult & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Erro ao consultar copiloto.');
      setCopilotOutput(data);
      if (mode === 'draft_reply' && data.draftText) {
        setReplyText(data.draftText);
        setIsSuggestedDraft(true);
        setMobilePane('chat');
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Erro no copiloto.');
    } finally {
      setCopilotLoading(false);
    }
  };

  const handleRegisterVisitFromSession = async () => {
    if (!activeSession) return;
    const res = await adminFetch('/api/admin/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: activeSession.sessionId,
        vehicleId: focusedVehicle ? Number(focusedVehicle.id) : null,
        vehicleLabel: focusedVehicle
          ? `${focusedVehicle.brand} ${focusedVehicle.model} (${focusedVehicle.year})`
          : 'Visita ao showroom',
        customerName: activeSession.leadName || 'Cliente do Chat',
        customerPhone: activeSession.leadPhone || null,
        status: 'solicitada',
      }),
    });
    if (res.ok) {
      setActionNotice('Solicitação de visita registrada na aba Agenda e Trocas.');
      void handleUpdateWorkflow({ stage: 'Visita' });
    }
  };

  if (viewTab === 'crm') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-1 p-1 bg-[#111114] border border-white/[0.08] rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setViewTab('inbox')}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-zinc-400 hover:text-white"
          >
            Caixa de Atendimentos
          </button>
          <button
            type="button"
            onClick={() => setViewTab('crm')}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-red-600 text-white"
          >
            Funil CRM (Kanban)
          </button>
        </div>
        <CrmModule
          leads={leads}
          vehicles={vehicles}
          aiAssistantName={settings.aiAssistantName}
          onUpdateLead={onUpdateLead}
          onAddLead={onAddLead}
          onDeleteLead={onDeleteLead}
          onRefreshLeads={onRefreshLeads}
          onGenerateContractForLead={(_leadId, vehicleId) => {
            onOpenDocumentForSession({
              sessionId: '',
              vehicleId: vehicleId || null,
            });
          }}
          preselectedLeadId={preselectedLeadId ?? null}
          onClearPreselectedLead={() => onClearPreselectedLead?.()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Sub-bar: Inbox vs Kanban + Mobile Pane Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-[#111114] border border-white/[0.08] rounded-lg">
          <button
            type="button"
            onClick={() => setViewTab('inbox')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-red-600 text-white whitespace-nowrap"
          >
            <MessageSquareText className="w-3.5 h-3.5" />
            <span>Caixa de Atendimentos</span>
          </button>
          <button
            type="button"
            onClick={() => setViewTab('crm')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-zinc-400 hover:text-white whitespace-nowrap"
          >
            <Kanban className="w-3.5 h-3.5" />
            <span>Funil CRM</span>
          </button>
        </div>

        {/* Mobile pane switcher (< lg) */}
        <div className="flex lg:hidden items-center gap-1 p-1 bg-[#111114] border border-white/[0.08] rounded-lg">
          {(
            [
              { id: 'queue', label: `Fila (${filteredSessions.length})` },
              { id: 'chat', label: 'Conversa' },
              { id: 'summary', label: 'Resumo' },
            ] as const
          ).map((pane) => (
            <button
              key={pane.id}
              type="button"
              onClick={() => setMobilePane(pane.id)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
                mobilePane === pane.id
                  ? 'bg-white/10 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {pane.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3-Column Desktop Workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[680px]">
        {/* COLUMN 1: QUEUE & FILTERS */}
        <section
          className={`lg:col-span-3 bg-[#111114] border border-white/[0.08] rounded-xl flex flex-col overflow-hidden ${
            mobilePane === 'queue' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          <div className="p-3.5 border-b border-white/[0.08] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">
                Fila ({filteredSessions.length})
              </span>
              <button
                type="button"
                onClick={() => void fetchSessions()}
                aria-label="Atualizar fila"
                className="p-1.5 text-zinc-400 hover:text-white rounded-md"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingSessions ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar cliente, telefone ou texto..."
              className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-600"
            />

            <div className="grid grid-cols-2 gap-1 p-1 bg-[#09090B] rounded-lg">
              {(
                [
                  { id: 'todos', label: 'Todos' },
                  { id: 'aguardando', label: 'Aguardando' },
                  { id: 'minhas', label: 'Minhas' },
                  { id: 'sem_resp', label: 'Sem resp.' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setQueueFilter(f.id)}
                  className={`py-1.5 px-2 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                    queueFilter === f.id
                      ? 'bg-white/10 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-zinc-200"
            >
              <option value="Todas">Todas as etapas</option>
              {STAGES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.06] max-h-[560px]">
            {loadingSessions && sessions.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500">Carregando fila...</div>
            ) : filteredSessions.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500">
                Nenhuma conversa corresponde aos filtros selecionados.
              </div>
            ) : (
              filteredSessions.map((s) => {
                const isSelected = s.sessionId === selectedSessionId;
                const veh = s.focusedVehicleId
                  ? vehicles.find((v) => Number(v.id) === s.focusedVehicleId)
                  : null;
                return (
                  <button
                    key={s.sessionId}
                    type="button"
                    onClick={() => {
                      setSelectedSessionId(s.sessionId);
                      setMobilePane('chat');
                    }}
                    className={`w-full text-left px-3.5 py-3 transition-colors ${
                      isSelected ? 'bg-red-600/12' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-white truncate">
                        {s.leadName || `Sessão ${s.sessionId.slice(0, 8)}`}
                      </p>
                      <span className="text-[10.5px] font-mono tabular-nums text-zinc-500 shrink-0">
                        {formatTimeShort(s.updatedAt)}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                      {s.lastMessage || 'Sem mensagens'}
                    </p>
                    <p className="text-[10.5px] text-zinc-500 mt-1 truncate">
                      {s.stage || 'Novo Lead'} · {s.assignedUserName || 'Livre'}
                      {veh ? ` · ${veh.brand} ${veh.model}` : ''}
                    </p>
                    {s.lastSender === 'user' && (
                      <p className="text-[10.5px] text-amber-400 font-medium mt-0.5">
                        Aguardando resposta
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* COLUMN 2: CONVERSATION & AUTOMATION CONTROL */}
        <section
          className={`lg:col-span-5 bg-[#111114] border border-white/[0.08] rounded-xl flex flex-col overflow-hidden ${
            mobilePane === 'chat' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {!activeSession ? (
            <div className="flex-1 flex items-center justify-center p-8 text-xs text-zinc-500">
              Selecione uma conversa na fila para acompanhar ou assumir o atendimento.
            </div>
          ) : (
            <>
              {/* Conversation Header */}
              <div className="px-4 py-3 border-b border-white/[0.08] bg-[#0D0D10] space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate">
                      {activeSession.leadName || `Visitante ${activeSession.sessionId.slice(0, 8)}`}
                    </h3>
                    <p className="text-[11px] text-zinc-400 truncate">
                      {activeSession.leadPhone || 'Telefone não informado'} · Origem:{' '}
                      {activeSession.origem} · Ref. {activeSession.sessionId.slice(0, 8)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!activeSession.assignedUserId ||
                    activeSession.assignedUserId !== currentUser.id ? (
                      <button
                        type="button"
                        onClick={() => void handleClaim(false)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white whitespace-nowrap"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Assumir atendimento</span>
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-emerald-400">
                        Em atendimento por você
                      </span>
                    )}
                  </div>
                </div>

                {/* Automation state bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/[0.06] text-[11px]">
                  <span className="text-zinc-300 flex items-center gap-1.5">
                    {activeSession.automationMode === 'human_active' ? (
                      <>
                        <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>
                          Atendimento humano ativo ({activeSession.assignedUserName || 'Equipe'}) · IA pausada
                        </span>
                      </>
                    ) : activeSession.automationMode === 'paused' ? (
                      <>
                        <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                        <span>Automação pausada manualmente</span>
                      </>
                    ) : (
                      <>
                        <Bot className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Agente IA ativo respondendo automaticamente</span>
                      </>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {activeSession.automationMode !== 'ai_active' ? (
                      <button
                        type="button"
                        onClick={() => void handleUpdateWorkflow({ automationMode: 'ai_active' })}
                        className="text-zinc-400 hover:text-white underline underline-offset-2"
                      >
                        Retomar IA
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleUpdateWorkflow({ automationMode: 'human_active' })}
                        className="text-amber-300 hover:text-amber-200 underline underline-offset-2"
                      >
                        Pausar IA
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {actionError && (
                <div className="px-4 py-2 bg-red-600/10 border-b border-red-600/30 text-xs text-red-200 flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}
              {actionNotice && (
                <div className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/25 text-xs text-emerald-200 flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>{actionNotice}</span>
                </div>
              )}

              {/* Messages Thread */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[430px] bg-[#0B0B0E]">
                {loadingMessages ? (
                  <div className="py-10 flex items-center justify-center gap-2 text-xs text-zinc-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Carregando histórico...</span>
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-8">
                    Nenhuma mensagem gravada nesta sessão.
                  </p>
                ) : (
                  messages.map((m) => {
                    const isClient = m.sender === 'user';
                    const channelLabel = isClient
                      ? activeSession.leadName || 'Cliente'
                      : m.deliveryChannel === 'whatsapp_manual_log'
                        ? `${m.senderLabel || 'Equipe'} · Registro manual WhatsApp`
                        : m.isHumanConsultant
                          ? `${m.senderLabel || 'Consultor'} · Enviada no chat`
                          : 'Agente IA · Automática';

                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isClient ? 'items-start' : 'items-end'}`}
                      >
                        <span className="text-[10.5px] text-zinc-500 mb-1">
                          {channelLabel} · {formatTimeShort(m.createdAt)}
                        </span>
                        <div
                          className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap border ${
                            isClient
                              ? 'bg-[#15151A] border-white/[0.08] text-zinc-100'
                              : m.deliveryChannel === 'whatsapp_manual_log'
                                ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-100'
                                : m.isHumanConsultant
                                  ? 'bg-red-950/35 border-red-500/30 text-zinc-100'
                                  : 'bg-[#111114] border-white/[0.08] text-zinc-200'
                          }`}
                        >
                          {m.content}
                          {m.audioUrl && (
                            <div className="mt-2 pt-2 border-t border-white/[0.08]">
                              <audio controls src={m.audioUrl} className="w-full h-8" />
                              {m.transcription && (
                                <p className="text-[11px] text-zinc-400 mt-1">
                                  Transcrição: {m.transcription}
                                </p>
                              )}
                            </div>
                          )}
                          {m.attachmentUrl && (
                            <div className="mt-2 pt-2 border-t border-white/[0.08] flex items-center justify-between gap-2">
                              <span className="text-[11px] text-zinc-300 truncate">
                                Anexo: {m.attachmentName || 'arquivo'}
                              </span>
                              <a
                                href={m.attachmentDownloadUrl || m.attachmentUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 shrink-0"
                              >
                                <Download className="w-3 h-3" />
                                <span>Baixar</span>
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Composer */}
              {canReply && (
                <div className="p-3.5 border-t border-white/[0.08] bg-[#0D0D10] space-y-2">
                  {isSuggestedDraft && (
                    <p className="text-[11px] text-amber-300">
                      Rascunho sugerido — revise o texto antes de enviar (nenhuma mensagem foi disparada ainda).
                    </p>
                  )}
                  <textarea
                    rows={3}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Escreva a resposta humana para enviar no chat ou registrar retorno feito no WhatsApp..."
                    className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-600 resize-none"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={sendingReply || !replyText.trim()}
                      onClick={() => void handleSendReply('whatsapp_manual_log')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 disabled:opacity-50 whitespace-nowrap"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>Registrar envio WhatsApp</span>
                    </button>

                    <button
                      type="button"
                      disabled={sendingReply || !replyText.trim()}
                      onClick={() => void handleSendReply('human_chat')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 whitespace-nowrap"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{sendingReply ? 'Enviando...' : 'Enviar no chat'}</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* COLUMN 3: NEGOTIATION SUMMARY, CONTEXTUAL ACTIONS & TASKS */}
        <section
          className={`lg:col-span-4 bg-[#111114] border border-white/[0.08] rounded-xl flex flex-col overflow-hidden ${
            mobilePane === 'summary' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {!activeSession ? (
            <div className="p-6 text-xs text-zinc-500">
              O resumo comercial da negociação aparece aqui.
            </div>
          ) : (
            <div className="p-4 space-y-4 overflow-y-auto max-h-[680px]">
              {/* Workflow Controls: Stage + Assignee */}
              <div className="space-y-2.5 pb-3.5 border-b border-white/[0.08]">
                <h4 className="text-xs font-semibold text-white">Resumo da negociação</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Etapa</label>
                    <select
                      value={activeSession.stage || 'Novo Lead'}
                      onChange={(e) =>
                        void handleUpdateWorkflow({
                          stage: e.target.value as SessionCommercialStage,
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
                    >
                      {STAGES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Responsável</label>
                    {canAssignOthers ? (
                      <select
                        value={activeSession.assignedUserId ?? ''}
                        onChange={(e) =>
                          void handleUpdateWorkflow({
                            assignedUserId: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
                      >
                        <option value="">Sem responsável</option>
                        {staffDirectory.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="px-2.5 py-1.5 rounded-lg bg-[#09090B] border border-white/[0.08] text-xs text-zinc-300 truncate">
                        {activeSession.assignedUserName || 'Livre'}
                      </p>
                    )}
                  </div>
                </div>

                {activeSession.stage === 'Perdido' && (
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Motivo da perda</label>
                    <select
                      value={activeSession.lossReason || ''}
                      onChange={(e) =>
                        void handleUpdateWorkflow({
                          stage: 'Perdido',
                          lossReason: e.target.value || null,
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
                    >
                      <option value="">Selecione o motivo...</option>
                      {LOSS_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Structured Context Fields */}
              <dl className="space-y-2 text-xs pb-3.5 border-b border-white/[0.08]">
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400">Veículo de interesse</dt>
                  <dd className="text-white font-medium text-right">
                    {focusedVehicle
                      ? `${focusedVehicle.brand} ${focusedVehicle.model} (${focusedVehicle.year})`
                      : 'Pendente'}
                  </dd>
                </div>
                {focusedVehicle && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-zinc-400">Preço / Status</dt>
                    <dd className="font-mono tabular-nums text-zinc-200 text-right">
                      {formatBRL(focusedVehicle.price)} · {focusedVehicle.status}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400">Saldo financiamento</dt>
                  <dd className="font-mono tabular-nums text-zinc-200 text-right">
                    {activeSession.context?.financingSummary
                      ? `${formatBRL(activeSession.context.financingSummary.principalBalance)} (entrada ${formatBRL(activeSession.context.financingSummary.downPayment)})`
                      : 'Pendente'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400">Usado na troca</dt>
                  <dd className="text-zinc-200 text-right">
                    {activeSession.context?.tradeInSummary?.brandModel || 'Pendente'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-zinc-400">Visita</dt>
                  <dd className="text-zinc-200 text-right">
                    {activeSession.context?.visitStatus || 'Pendente'}
                  </dd>
                </div>
              </dl>

              {/* Contextual Commercial Actions */}
              <div className="space-y-2 pb-3.5 border-b border-white/[0.08]">
                <h4 className="text-xs font-semibold text-white">Ações contextuais</h4>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onOpenDocumentForSession({
                        sessionId: activeSession.sessionId,
                        vehicleId: focusedVehicle ? focusedVehicle.id : null,
                        customerName: activeSession.leadName,
                        customerPhone: activeSession.leadPhone,
                        downPayment: activeSession.context?.financingSummary?.downPayment ?? null,
                        installments: activeSession.context?.financingSummary?.months ?? null,
                      })
                    }
                    className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white whitespace-nowrap"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Gerar documento</span>
                  </button>

                  <button
                    type="button"
                    disabled={copilotLoading}
                    onClick={() => void runSessionCopilot('draft_reply')}
                    className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-100 whitespace-nowrap"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-red-400" />
                    <span>Preparar resposta</span>
                  </button>

                  <button
                    type="button"
                    disabled={copilotLoading}
                    onClick={() => void runSessionCopilot('summary')}
                    className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-200 whitespace-nowrap"
                  >
                    <span>Resumir conversa</span>
                  </button>

                  <button
                    type="button"
                    disabled={copilotLoading}
                    onClick={() => void runSessionCopilot('alternatives')}
                    className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-200 whitespace-nowrap"
                  >
                    <CarFront className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Buscar alternativas</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleRegisterVisitFromSession()}
                    className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-200 whitespace-nowrap"
                  >
                    <CalendarPlus className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Registrar visita</span>
                  </button>

                  {focusedVehicle && (
                    <button
                      type="button"
                      onClick={() => onOpenMarketingForVehicle(focusedVehicle.id)}
                      className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-200 whitespace-nowrap"
                    >
                      <span>Gerar divulgação</span>
                    </button>
                  )}

                  {focusedVehicle && (
                    <button
                      type="button"
                      onClick={() => onOpenVehicleSheet(focusedVehicle.id)}
                      className="col-span-2 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300 whitespace-nowrap"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Ver ficha pública ({focusedVehicle.brand} {focusedVehicle.model})</span>
                    </button>
                  )}
                </div>

                {copilotOutput && (
                  <div className="p-3 rounded-lg bg-[#09090B] border border-white/[0.08] space-y-2 text-xs">
                    <p className="text-zinc-200 whitespace-pre-line">{copilotOutput.answer}</p>
                    {copilotOutput.records.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {copilotOutput.records.map((r) => (
                          <div
                            key={r.id}
                            className="flex items-center justify-between gap-2 pt-1.5 border-t border-white/[0.06]"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-white truncate">{r.title}</p>
                              <p className="text-[11px] text-zinc-400 truncate">{r.subtitle}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => onOpenVehicleEdit(r.id)}
                              className="text-[11px] text-red-400 hover:text-red-300 shrink-0"
                            >
                              Abrir
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Tasks / Follow-up Reminders */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold text-white">Lembretes e tarefas</h4>
                <form onSubmit={handleCreateTask} className="flex gap-1.5">
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="Ex.: Retornar com taxa aprovada amanhã..."
                    className="flex-1 px-2.5 py-1.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white placeholder:text-zinc-500"
                  />
                  <button
                    type="submit"
                    disabled={savingTask || !newTaskTitle.trim()}
                    aria-label="Adicionar lembrete"
                    className="px-2.5 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-white disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </form>

                <div className="space-y-1.5">
                  {tasks.length === 0 ? (
                    <p className="text-[11px] text-zinc-500">Nenhum lembrete para esta conversa.</p>
                  ) : (
                    tasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => void handleToggleTask(task)}
                        className="w-full text-left px-2.5 py-2 rounded-lg bg-[#09090B] border border-white/[0.06] hover:border-white/[0.14] flex items-center gap-2 text-xs"
                      >
                        <CheckCircle2
                          className={`w-3.5 h-3.5 shrink-0 ${
                            task.status === 'concluida' ? 'text-emerald-400' : 'text-zinc-600'
                          }`}
                        />
                        <span
                          className={`flex-1 truncate ${
                            task.status === 'concluida'
                              ? 'line-through text-zinc-500'
                              : 'text-zinc-200'
                          }`}
                        >
                          {task.title}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
