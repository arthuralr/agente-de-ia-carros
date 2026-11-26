import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FileText,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Repeat,
  Search,
  Sparkles,
} from 'lucide-react';
import type {
  AdminUser,
  CopilotQueryResult,
  NavModule,
  TodayActionSummary,
} from '../../types';
import { adminFetch } from '../../utils/authSession';
import { formatBRL } from '../../utils/formatters';
import { hasPermission } from '../../utils/rbac';

interface TodayModuleProps {
  currentUser: AdminUser;
  onUnauthorized: () => void;
  onNavigate: (module: NavModule) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenVehicleEdit: (vehicleId: string) => void;
  onOpenDocumentId: (documentId: number) => void;
}

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '';
  const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin} min`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export const TodayModule: React.FC<TodayModuleProps> = ({
  currentUser,
  onUnauthorized,
  onNavigate,
  onOpenSession,
  onOpenVehicleEdit,
  onOpenDocumentId,
}) => {
  const [summary, setSummary] = useState<TodayActionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Internal Copilot quick query state
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotResult, setCopilotResult] = useState<CopilotQueryResult | null>(null);
  const [copilotError, setCopilotError] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await adminFetch('/api/admin/today');
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || 'Não foi possível carregar o painel Hoje.');
      }
      const data = (await res.json()) as TodayActionSummary;
      setSummary(data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao carregar resumo operacional.');
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  const runCopilotQuery = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    setCopilotInput(q);
    setCopilotLoading(true);
    setCopilotError(null);
    try {
      const res = await adminFetch('/api/admin/copilot/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as CopilotQueryResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao consultar assistente interno.');
      }
      setCopilotResult(data);
    } catch (err: unknown) {
      setCopilotError(err instanceof Error ? err.message : 'Erro na consulta.');
    } finally {
      setCopilotLoading(false);
    }
  };

  const handleCompleteTask = async (taskId: number) => {
    try {
      const res = await adminFetch(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'concluida' }),
      });
      if (res.ok) {
        setSummary((prev) =>
          prev
            ? { ...prev, pendingTasks: prev.pendingTasks.filter((t) => t.id !== taskId) }
            : prev
        );
      }
    } catch {
      // Ignore transient error
    }
  };

  const canViewSessions = hasPermission(currentUser.roleCode, 'sessions:view_own');

  return (
    <div className="space-y-6">
      {/* Operational Header Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">
            Fila operacional de hoje
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {currentUser.name} · {currentUser.role} · Cada item abre diretamente o registro de origem
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadToday()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors whitespace-nowrap self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Atualizar fila</span>
        </button>
      </div>

      {/* Internal Copilot Bar (Authorized Live DB Queries — Zero Hallucination) */}
      <section className="bg-[#111114] border border-white/[0.08] rounded-xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-red-500 shrink-0" />
            <h3 className="text-sm font-semibold text-white">
              Consulta rápida da equipe
            </h3>
          </div>
          <span className="text-[11px] text-zinc-500">
            Consultas autorizadas sobre estoque e atendimentos reais
          </span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runCopilotQuery(copilotInput);
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={copilotInput}
              onChange={(e) => setCopilotInput(e.target.value)}
              placeholder="Ex.: Quais carros têm divergência de câmbio? Ou quais clientes pediram simulação?"
              className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-600"
            />
          </div>
          <button
            type="submit"
            disabled={copilotLoading || !copilotInput.trim()}
            className="px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0"
          >
            {copilotLoading ? 'Consultando...' : 'Consultar'}
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {canViewSessions && (
            <button
              type="button"
              onClick={() =>
                void runCopilotQuery(
                  'Quais clientes pediram simulação e ainda precisam de retorno?'
                )
              }
              className="px-3 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-zinc-300 transition-colors"
            >
              Clientes com simulação sem retorno
            </button>
          )}
          <button
            type="button"
            onClick={() => void runCopilotQuery('Quais carros têm divergência de câmbio?')}
            className="px-3 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-zinc-300 transition-colors"
          >
            Carros com divergência de câmbio
          </button>
          <button
            type="button"
            onClick={() => void runCopilotQuery('Quais veículos estão com FIPE incompleta?')}
            className="px-3 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-zinc-300 transition-colors"
          >
            Pendências de FIPE
          </button>
        </div>

        {copilotError && (
          <p className="text-xs text-red-400">{copilotError}</p>
        )}

        {copilotResult && (
          <div className="pt-3 border-t border-white/[0.08] space-y-2.5">
            <p className="text-xs text-zinc-200 whitespace-pre-line">{copilotResult.answer}</p>
            {copilotResult.records.length > 0 && (
              <div className="divide-y divide-white/[0.06] border border-white/[0.08] rounded-lg bg-[#09090B]">
                {copilotResult.records.map((rec) => (
                  <div
                    key={`${rec.type}-${rec.id}`}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{rec.title}</p>
                      <p className="text-[11px] text-zinc-400 truncate">{rec.subtitle}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (rec.type === 'session') onOpenSession(rec.id);
                        else if (rec.type === 'vehicle') onOpenVehicleEdit(rec.id);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-red-400 hover:bg-red-600/15 whitespace-nowrap shrink-0"
                    >
                      <span>{rec.actionLabel}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-600/10 border border-red-600/30 text-xs text-red-200">
          {errorMsg}
        </div>
      )}

      {loading && !summary ? (
        <div className="py-12 flex items-center justify-center gap-2 text-xs text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin text-red-500" />
          <span>Carregando pendências reais do banco...</span>
        </div>
      ) : summary ? (
        <>
          {/* Summary Numeric Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {canViewSessions && (
              <button
                type="button"
                onClick={() => onNavigate('atendimentos')}
                className="text-left p-4 rounded-xl bg-[#111114] border border-white/[0.08] hover:border-white/[0.16] transition-colors"
              >
                <p className="text-xs text-zinc-400">Aguardando retorno</p>
                <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-white">
                  {summary.awaitingReply.length}
                </p>
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('documentos')}
              className="text-left p-4 rounded-xl bg-[#111114] border border-white/[0.08] hover:border-white/[0.16] transition-colors"
            >
              <p className="text-xs text-zinc-400">Propostas recentes</p>
              <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-white">
                {summary.proposalsToFollowUp.length}
              </p>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('agenda_trocas')}
              className="text-left p-4 rounded-xl bg-[#111114] border border-white/[0.08] hover:border-white/[0.16] transition-colors"
            >
              <p className="text-xs text-zinc-400">Visitas ativas</p>
              <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-white">
                {summary.visitsToday.length}
              </p>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('agenda_trocas')}
              className="text-left p-4 rounded-xl bg-[#111114] border border-white/[0.08] hover:border-white/[0.16] transition-colors"
            >
              <p className="text-xs text-zinc-400">Trocas pendentes</p>
              <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-white">
                {summary.pendingTradeIns.length}
              </p>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('estoque')}
              className="text-left p-4 rounded-xl bg-[#111114] border border-white/[0.08] hover:border-white/[0.16] transition-colors"
            >
              <p className="text-xs text-zinc-400">Anúncios incompletos</p>
              <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-amber-400">
                {summary.incompleteVehicles.length}
              </p>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 1. Clientes aguardando retorno */}
            {canViewSessions && (
              <section className="bg-[#111114] border border-white/[0.08] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquareText className="w-4 h-4 text-red-500" />
                    <h3 className="text-sm font-semibold text-white">
                      Clientes aguardando retorno
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate('atendimentos')}
                    className="text-xs text-zinc-400 hover:text-white"
                  >
                    Ver fila
                  </button>
                </div>
                <div className="divide-y divide-white/[0.06]">
                  {summary.awaitingReply.length === 0 ? (
                    <p className="px-5 py-6 text-xs text-zinc-500">
                      Nenhum cliente aguardando retorno neste momento.
                    </p>
                  ) : (
                    summary.awaitingReply.slice(0, 6).map((s) => (
                      <button
                        key={s.sessionId}
                        type="button"
                        onClick={() => onOpenSession(s.sessionId)}
                        className="w-full text-left px-5 py-3 hover:bg-white/[0.03] transition-colors flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">
                            {s.leadName || `Visitante ${s.sessionId.slice(0, 8)}`}
                          </p>
                          <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                            {s.lastMessage || 'Conversa iniciada'}
                          </p>
                          <p className="text-[11px] text-zinc-500 mt-1">
                            {s.stage || 'Novo Lead'} · {s.assignedUserName || 'Sem responsável'} ·{' '}
                            {s.origem}
                          </p>
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-zinc-500 shrink-0">
                          {formatRelativeTime(s.updatedAt)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </section>
            )}

            {/* 2. Anúncios incompletos / divergências cadastrais */}
            <section className="bg-[#111114] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-white">
                    Pendências de estoque e anúncios
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('estoque')}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Abrir estoque
                </button>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {summary.incompleteVehicles.length === 0 ? (
                  <p className="px-5 py-6 text-xs text-zinc-500">
                    Todos os veículos do estoque estão com cadastro completo.
                  </p>
                ) : (
                  summary.incompleteVehicles.slice(0, 6).map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => onOpenVehicleEdit(v.id)}
                      className="w-full text-left px-5 py-3 hover:bg-white/[0.03] transition-colors flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{v.title}</p>
                        <p className="text-[11px] text-amber-300/90 mt-0.5">
                          {v.issues.join(' · ')}
                        </p>
                      </div>
                      <span className="text-xs text-red-400 whitespace-nowrap shrink-0">
                        Revisar
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>

            {/* 3. Propostas a retomar */}
            <section className="bg-[#111114] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-red-500" />
                  <h3 className="text-sm font-semibold text-white">Propostas a retomar</h3>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('documentos')}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Documentos
                </button>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {summary.proposalsToFollowUp.length === 0 ? (
                  <p className="px-5 py-6 text-xs text-zinc-500">
                    Nenhuma proposta emitida ainda. Gere uma proposta a partir de um atendimento ou veículo.
                  </p>
                ) : (
                  summary.proposalsToFollowUp.slice(0, 5).map((p) => (
                    <button
                      key={p.documentId}
                      type="button"
                      onClick={() => {
                        if (p.sessionId && canViewSessions) onOpenSession(p.sessionId);
                        else onOpenDocumentId(p.documentId);
                      }}
                      className="w-full text-left px-5 py-3 hover:bg-white/[0.03] transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">
                          {p.customerName} · {p.vehicleTitle}
                        </p>
                        <p className="text-[11px] text-zinc-400 mt-0.5 font-mono tabular-nums">
                          Saldo: {formatBRL(p.principalBalance)} · Proposta #{String(p.documentId).padStart(5, '0')}
                        </p>
                      </div>
                      <span className="text-[11px] font-mono text-zinc-500 shrink-0">
                        {formatRelativeTime(p.createdAt)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>

            {/* 4. Visitas, Trocas & Lembretes */}
            <section className="bg-[#111114] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">
                    Visitas, trocas e lembretes
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('agenda_trocas')}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Abrir agenda
                </button>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {summary.visitsToday.slice(0, 3).map((v) => (
                  <button
                    key={`visit-${v.id}`}
                    type="button"
                    onClick={() => onNavigate('agenda_trocas')}
                    className="w-full text-left px-5 py-3 hover:bg-white/[0.03] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">
                        Visita ({v.status}): {v.customerName || 'Cliente'}
                      </p>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {v.vehicleLabel || 'Showroom'} · {v.scheduledDate || 'Data a confirmar'}{' '}
                        {v.scheduledTime || ''}
                      </p>
                    </div>
                  </button>
                ))}
                {summary.pendingTradeIns.slice(0, 3).map((t) => (
                  <button
                    key={`trade-${t.id}`}
                    type="button"
                    onClick={() => onNavigate('agenda_trocas')}
                    className="w-full text-left px-5 py-3 hover:bg-white/[0.03] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                        <Repeat className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        <span>Troca: {t.brandModel}</span>
                      </p>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {t.customerName || 'Cliente'} · Estado: {t.status.replace(/_/g, ' ')}
                      </p>
                    </div>
                  </button>
                ))}
                {summary.pendingTasks.slice(0, 4).map((task) => (
                  <div
                    key={`task-${task.id}`}
                    className="px-5 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-100 truncate">{task.title}</p>
                      <p className="text-[11px] text-zinc-500">
                        Lembrete · {task.assignedUserName || 'Equipe'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCompleteTask(task.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-emerald-400 hover:bg-emerald-500/10 whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Concluir</span>
                    </button>
                  </div>
                ))}
                {summary.visitsToday.length === 0 &&
                  summary.pendingTradeIns.length === 0 &&
                  summary.pendingTasks.length === 0 && (
                    <p className="px-5 py-6 text-xs text-zinc-500">
                      Nenhuma visita, troca ou tarefa pendente registrada hoje.
                    </p>
                  )}
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
};
