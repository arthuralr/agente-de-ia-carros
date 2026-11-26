import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Clock,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  RotateCcw,
  Users,
} from 'lucide-react';
import type { ManagementMetrics } from '../../types';
import { adminFetch } from '../../utils/authSession';

interface GestaoModuleProps {
  onUnauthorized: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenVehicleEdit: (vehicleId: string) => void;
}

export const GestaoModule: React.FC<GestaoModuleProps> = ({
  onUnauthorized,
  onOpenSession,
  onOpenVehicleEdit,
}) => {
  const [metrics, setMetrics] = useState<ManagementMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await adminFetch('/api/admin/management/metrics');
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (res.status === 403) {
        setErrorMsg('Acesso restrito a Gestor Comercial e Administrador.');
        return;
      }
      if (!res.ok) {
        throw new Error('Não foi possível carregar os indicadores gerenciais.');
      }
      const data = (await res.json()) as ManagementMetrics;
      setMetrics(data);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Erro ao carregar indicadores.'
      );
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const handleCopyDraft = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  if (loading && !metrics) {
    return (
      <div className="py-16 flex flex-col items-center justify-center gap-3 text-zinc-400 text-xs">
        <Loader2 className="w-5 h-5 animate-spin text-red-500" />
        <span>Calculando indicadores a partir dos registros reais...</span>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="p-5 rounded-xl bg-red-950/40 border border-red-600/35 text-xs text-red-200 flex items-center gap-2.5">
        <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
        <span>{errorMsg}</span>
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-white">
            Indicadores Operacionais & Fila da Equipe
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Todos os números abaixo são calculados em tempo real sobre atendimentos, propostas e visitas persistidos no banco.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMetrics()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-[#111114] hover:bg-white/[0.06] border border-white/[0.08]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Recalcular</span>
        </button>
      </div>

      {/* Top KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-4">
          <p className="text-xs text-zinc-400 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-zinc-500" />
            <span>1ª resposta humana</span>
          </p>
          {metrics.avgFirstHumanReplyMinutes !== null ? (
            <>
              <p className="font-mono text-2xl font-semibold text-white tabular-nums mt-2">
                {metrics.avgFirstHumanReplyMinutes} min
              </p>
              <p className="text-[11px] text-zinc-500 mt-1 tabular-nums">
                Amostra: {metrics.humanReplySampleSize} atendimento(s)
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-zinc-300 mt-2">
                Dados insuficientes
              </p>
              <p className="text-[11px] text-zinc-500 mt-1">
                Nenhuma resposta humana registrada ainda.
              </p>
            </>
          )}
        </div>

        <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-4">
          <p className="text-xs text-zinc-400">Interesse / Conversas</p>
          <p className="font-mono text-2xl font-semibold text-white tabular-nums mt-2">
            {metrics.funnel.interesse}
          </p>
          <p className="text-[11px] text-zinc-500 mt-1">Sessões registradas</p>
        </div>

        <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-4">
          <p className="text-xs text-zinc-400">Propostas emitidas</p>
          <p className="font-mono text-2xl font-semibold text-white tabular-nums mt-2">
            {metrics.funnel.proposta}
          </p>
          <p className="text-[11px] text-zinc-500 mt-1">
            Documentos comerciais
          </p>
        </div>

        <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-4">
          <p className="text-xs text-zinc-400">Visitas confirmadas</p>
          <p className="font-mono text-2xl font-semibold text-white tabular-nums mt-2">
            {metrics.funnel.visita}
          </p>
          <p className="text-[11px] text-zinc-500 mt-1">
            Confirmadas ou realizadas
          </p>
        </div>

        <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-4">
          <p className="text-xs text-zinc-400">Vendas fechadas</p>
          <p className="font-mono text-2xl font-semibold text-emerald-400 tabular-nums mt-2">
            {metrics.funnel.venda}
          </p>
          <p className="text-[11px] text-zinc-500 mt-1">
            Atendimentos concluídos
          </p>
        </div>
      </div>

      {/* Middle Grid: Queue by Assignee + Loss Reasons */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-zinc-400" />
              <span>Fila por Responsável</span>
            </h3>
            <span className="text-xs text-zinc-500">Clique para abrir atendimento</span>
          </div>

          {metrics.queueByAssignee.length === 0 ? (
            <p className="text-xs text-zinc-500 py-6 text-center">
              Nenhum atendimento em aberto no momento.
            </p>
          ) : (
            <div className="space-y-3">
              {metrics.queueByAssignee.map((group) => (
                <div
                  key={group.assigneeName}
                  className="p-3.5 rounded-lg bg-[#09090B] border border-white/[0.06] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-white">
                      {group.assigneeName}
                    </span>
                    <span className="font-mono tabular-nums text-zinc-400">
                      {group.total} total ·{' '}
                      <strong className="text-amber-400">
                        {group.awaitingReply} aguardando
                      </strong>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.sessions.slice(0, 6).map((s) => (
                      <button
                        key={s.sessionId}
                        type="button"
                        onClick={() => onOpenSession(s.sessionId)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] text-zinc-300 bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.07]"
                      >
                        <span className="truncate max-w-[140px]">
                          {s.leadName || `Sessão ${s.sessionId.slice(-5)}`}
                        </span>
                        <ArrowRight className="w-3 h-3 text-zinc-500" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-zinc-400" />
            <span>Motivos de Perda Registrados</span>
          </h3>

          {metrics.lossReasons.length === 0 ? (
            <p className="text-xs text-zinc-500 py-6 text-center">
              Nenhum atendimento marcado como perdido com motivo registrado.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {metrics.lossReasons.map((item) => (
                <div
                  key={item.reason}
                  className="py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <span className="text-zinc-200">{item.reason}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono tabular-nums text-white font-semibold">
                      {item.count}
                    </span>
                    {item.sessionIds[0] && (
                      <button
                        type="button"
                        onClick={() => onOpenSession(item.sessionIds[0])}
                        className="text-[11px] text-zinc-400 hover:text-white underline"
                      >
                        Abrir
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Vehicles with Demand Without Progress */}
      <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white">
          Veículos com Procura sem Avanço (Proposta / Visita)
        </h3>
        {metrics.demandWithoutProgress.length === 0 ? (
          <p className="text-xs text-zinc-500 py-4">
            Nenhum veículo disponível com múltiplas consultas paradas sem proposta ou visita.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] text-zinc-400">
                  <th className="py-2.5 pr-4">Veículo</th>
                  <th className="py-2.5 px-3 text-right">Consultas</th>
                  <th className="py-2.5 px-3 text-right">Propostas</th>
                  <th className="py-2.5 px-3 text-right">Visitas</th>
                  <th className="py-2.5 pl-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {metrics.demandWithoutProgress.map((item) => (
                  <tr key={item.vehicleId} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 pr-4 font-medium text-white">
                      #{item.vehicleId} · {item.title}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-200">
                      {item.inquiries}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-400">
                      {item.proposals}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-400">
                      {item.visits}
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenVehicleEdit(item.vehicleId)}
                        className="text-red-400 hover:text-red-300 font-medium"
                      >
                        Revisar ficha
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reactivation Queue (Human Review Required — Zero Auto-Send) */}
      <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-zinc-400" />
            <span>Fila de Reativação Sugerida (Revisão Humana)</span>
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Rascunhos preparados para revisão da equipe antes de qualquer envio manual. Nenhum disparo automático é feito.
          </p>
        </div>

        {metrics.reactivationQueue.length === 0 ? (
          <p className="text-xs text-zinc-500 py-4">
            Nenhum atendimento elegível na fila de reativação no momento.
          </p>
        ) : (
          <div className="space-y-3">
            {metrics.reactivationQueue.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-lg bg-[#09090B] border border-white/[0.08] space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-white">
                      {item.customerName}{' '}
                      {item.customerPhone ? `· ${item.customerPhone}` : ''}
                    </p>
                    <p className="text-[11px] text-amber-300 mt-0.5">
                      {item.reason} · {item.vehicleTitle}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void handleCopyDraft(item.id, item.draftMessage)
                      }
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08]"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {copiedId === item.id ? 'Copiado' : 'Copiar rascunho'}
                      </span>
                    </button>
                    {item.sessionId && (
                      <button
                        type="button"
                        onClick={() => onOpenSession(item.sessionId!)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500"
                      >
                        <span>Abrir conversa</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-zinc-300 bg-[#111114] border border-white/[0.06] rounded-md p-2.5 leading-relaxed">
                  {item.draftMessage}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
