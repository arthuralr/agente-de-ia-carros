import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarClock,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  Repeat,
} from 'lucide-react';
import type {
  AdminUser,
  TradeInRecord,
  TradeInStatus,
  Vehicle,
  VisitRecord,
  VisitStatus,
} from '../../types';
import { adminFetch } from '../../utils/authSession';
import { formatBRL, formatKm } from '../../utils/formatters';
import { hasPermission } from '../../utils/rbac';

interface AgendaTrocasModuleProps {
  currentUser: AdminUser;
  vehicles: Vehicle[];
  onUnauthorized: () => void;
  onOpenSession?: (sessionId: string) => void;
}

const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  consultada: 'Consultada (sem agendamento)',
  solicitada: 'Solicitada',
  confirmada: 'Confirmada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
};

const TRADE_STATUS_LABELS: Record<TradeInStatus, string> = {
  aguardando_dados: 'Aguardando dados',
  aguardando_fotos: 'Aguardando fotos',
  em_avaliacao: 'Em pré-avaliação',
  aprovada: 'Pré-avaliação aprovada',
  recusada: 'Recusada',
};

export const AgendaTrocasModule: React.FC<AgendaTrocasModuleProps> = ({
  currentUser,
  vehicles,
  onUnauthorized,
  onOpenSession,
}) => {
  const [tab, setTab] = useState<'visitas' | 'trocas'>('visitas');
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [tradeIns, setTradeIns] = useState<TradeInRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Quick visit form
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [vCustomer, setVCustomer] = useState('');
  const [vPhone, setVPhone] = useState('');
  const [vVehicleId, setVVehicleId] = useState('');
  const [vDate, setVDate] = useState(new Date().toISOString().slice(0, 10));
  const [vTime, setVTime] = useState('10:00');
  const [vStatus, setVStatus] = useState<VisitStatus>('solicitada');

  // Quick trade-in form
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [tBrandModel, setTBrandModel] = useState('');
  const [tYear, setTYear] = useState('');
  const [tKm, setTKm] = useState('');
  const [tTransmission, setTTransmission] = useState('Manual');
  const [tCustomer, setTCustomer] = useState('');
  const [tNotes, setTNotes] = useState('');

  // Approved value inline input map
  const [approvedValueDrafts, setApprovedValueDrafts] = useState<Record<number, string>>({});

  const canApproveTradeValue = hasPermission(currentUser.roleCode, 'trade_ins:approve_value');
  const canOpenSession = hasPermission(currentUser.roleCode, 'sessions:view_own');

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [vRes, tRes] = await Promise.all([
        adminFetch('/api/admin/visits'),
        adminFetch('/api/admin/trade-ins'),
      ]);
      if (vRes.status === 401 || tRes.status === 401) {
        onUnauthorized();
        return;
      }
      if (vRes.ok) setVisits((await vRes.json()) as VisitRecord[]);
      if (tRes.ok) setTradeIns((await tRes.json()) as TradeInRecord[]);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao carregar agenda e trocas.');
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    const selVeh = vehicles.find((v) => v.id === vVehicleId);
    const res = await adminFetch('/api/admin/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: vCustomer.trim() || 'Visitante',
        customerPhone: vPhone.trim() || null,
        vehicleId: selVeh ? Number(selVeh.id) : null,
        vehicleLabel: selVeh ? `${selVeh.brand} ${selVeh.model} (${selVeh.year})` : 'Showroom',
        scheduledDate: vDate,
        scheduledTime: vTime,
        status: vStatus,
      }),
    });
    if (res.ok) {
      const created = (await res.json()) as VisitRecord;
      setVisits((prev) => [created, ...prev]);
      setShowVisitForm(false);
      setVCustomer('');
      setVPhone('');
    }
  };

  const handleUpdateVisitStatus = async (visitId: number, status: VisitStatus) => {
    const res = await adminFetch(`/api/admin/visits/${visitId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated = (await res.json()) as VisitRecord;
      setVisits((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    }
  };

  const handleCreateTradeIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tBrandModel.trim()) return;
    const res = await adminFetch('/api/admin/trade-ins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandModel: tBrandModel.trim(),
        yearText: tYear.trim() || null,
        km: tKm ? Number(tKm) : null,
        transmission: tTransmission,
        customerName: tCustomer.trim() || null,
        conditionNotes: tNotes.trim() || null,
        status: 'aguardando_fotos',
      }),
    });
    if (res.ok) {
      const created = (await res.json()) as TradeInRecord;
      setTradeIns((prev) => [created, ...prev]);
      setShowTradeForm(false);
      setTBrandModel('');
      setTYear('');
      setTKm('');
      setTCustomer('');
      setTNotes('');
    }
  };

  const handleUpdateTradeIn = async (
    id: number,
    patch: { status?: TradeInStatus; approvedValue?: number }
  ) => {
    setErrorMsg(null);
    const res = await adminFetch(`/api/admin/trade-ins/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = (await res.json().catch(() => ({}))) as TradeInRecord & { error?: string };
    if (!res.ok) {
      setErrorMsg(data.error || 'Falha ao atualizar troca.');
      return;
    }
    setTradeIns((prev) => prev.map((t) => (t.id === data.id ? data : t)));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-[#111114] border border-white/[0.08] rounded-lg">
          <button
            type="button"
            onClick={() => setTab('visitas')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold whitespace-nowrap ${
              tab === 'visitas' ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5" />
            <span>Agenda de Visitas ({visits.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('trocas')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold whitespace-nowrap ${
              tab === 'trocas' ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
            <span>Trocas e Pré-Avaliação ({tradeIns.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            className="p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300"
            aria-label="Atualizar"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() =>
              tab === 'visitas'
                ? setShowVisitForm((p) => !p)
                : setShowTradeForm((p) => !p)
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{tab === 'visitas' ? 'Nova visita' : 'Registrar troca'}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-red-600/10 border border-red-600/30 text-xs text-red-200">
          {errorMsg}
        </div>
      )}

      {tab === 'visitas' ? (
        <div className="space-y-4">
          {showVisitForm && (
            <form
              onSubmit={handleCreateVisit}
              className="p-5 rounded-xl bg-[#111114] border border-white/[0.08] grid grid-cols-1 sm:grid-cols-3 gap-3"
            >
              <input
                required
                value={vCustomer}
                onChange={(e) => setVCustomer(e.target.value)}
                placeholder="Nome do cliente"
                className="px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
              />
              <input
                value={vPhone}
                onChange={(e) => setVPhone(e.target.value)}
                placeholder="WhatsApp / Telefone"
                className="px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
              />
              <select
                value={vVehicleId}
                onChange={(e) => setVVehicleId(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
              >
                <option value="">Showroom geral</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.brand} {v.model} ({v.year})
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={vDate}
                onChange={(e) => setVDate(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
              />
              <input
                type="time"
                value={vTime}
                onChange={(e) => setVTime(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
              />
              <select
                value={vStatus}
                onChange={(e) => setVStatus(e.target.value as VisitStatus)}
                className="px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
              >
                <option value="consultada">Consultada</option>
                <option value="solicitada">Solicitada</option>
                <option value="confirmada">Confirmada</option>
              </select>
              <div className="sm:col-span-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowVisitForm(false)}
                  className="px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white"
                >
                  Salvar visita
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="py-10 flex items-center justify-center gap-2 text-xs text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Carregando agenda...</span>
            </div>
          ) : visits.length === 0 ? (
            <div className="p-8 rounded-xl bg-[#111114] border border-white/[0.08] text-center text-xs text-zinc-400">
              Nenhuma visita registrada ainda. Consultas de horário feitas com "Não agende nada" não criam agendamentos indevidos.
            </div>
          ) : (
            <div className="bg-[#111114] border border-white/[0.08] rounded-xl divide-y divide-white/[0.06]">
              {visits.map((visit) => (
                <div
                  key={visit.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-semibold text-white">
                      {visit.customerName || 'Visitante'} · {visit.vehicleLabel || 'Showroom'}
                    </p>
                    <p className="text-xs text-zinc-400 font-mono tabular-nums">
                      {visit.scheduledDate || 'Sem data'} {visit.scheduledTime || ''} · Responsável:{' '}
                      {visit.assignedUserName || 'Equipe'}
                      {visit.customerPhone ? ` · ${visit.customerPhone}` : ''}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      Estado atual: {VISIT_STATUS_LABELS[visit.status]}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {visit.sessionId && canOpenSession && onOpenSession && (
                      <button
                        type="button"
                        onClick={() => onOpenSession(visit.sessionId!)}
                        className="px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08]"
                      >
                        Abrir conversa
                      </button>
                    )}
                    <select
                      value={visit.status}
                      onChange={(e) =>
                        void handleUpdateVisitStatus(visit.id, e.target.value as VisitStatus)
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
                    >
                      {(Object.keys(VISIT_STATUS_LABELS) as VisitStatus[]).map((st) => (
                        <option key={st} value={st}>
                          {VISIT_STATUS_LABELS[st]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {showTradeForm && (
            <form
              onSubmit={handleCreateTradeIn}
              className="p-5 rounded-xl bg-[#111114] border border-white/[0.08] grid grid-cols-1 sm:grid-cols-3 gap-3"
            >
              <input
                required
                value={tBrandModel}
                onChange={(e) => setTBrandModel(e.target.value)}
                placeholder="Veículo usado (ex.: Renault Sandero 1.6)"
                className="px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
              />
              <input
                value={tYear}
                onChange={(e) => setTYear(e.target.value)}
                placeholder="Ano (ex.: 2018)"
                className="px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
              />
              <input
                type="number"
                value={tKm}
                onChange={(e) => setTKm(e.target.value)}
                placeholder="Quilometragem (ex.: 110000)"
                className="px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
              />
              <input
                value={tTransmission}
                onChange={(e) => setTTransmission(e.target.value)}
                placeholder="Câmbio"
                className="px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
              />
              <input
                value={tCustomer}
                onChange={(e) => setTCustomer(e.target.value)}
                placeholder="Nome do cliente"
                className="px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
              />
              <input
                value={tNotes}
                onChange={(e) => setTNotes(e.target.value)}
                placeholder="Estado / observações"
                className="px-3 py-2 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
              />
              <div className="sm:col-span-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowTradeForm(false)}
                  className="px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white"
                >
                  Registrar troca
                </button>
              </div>
            </form>
          )}

          {tradeIns.length === 0 ? (
            <div className="p-8 rounded-xl bg-[#111114] border border-white/[0.08] text-center text-xs text-zinc-400">
              Nenhuma troca cadastrada. Trocas informadas no chat aparecem automaticamente aqui vinculadas ao atendimento.
            </div>
          ) : (
            <div className="bg-[#111114] border border-white/[0.08] rounded-xl divide-y divide-white/[0.06]">
              {tradeIns.map((t) => (
                <div
                  key={t.id}
                  className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-1 min-w-0">
                    <p className="text-sm font-semibold text-white">
                      {t.brandModel} {t.yearText ? `(${t.yearText})` : ''}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {t.customerName || 'Cliente'}
                      {t.km ? ` · ${formatKm(t.km)}` : ''}
                      {t.transmission ? ` · ${t.transmission}` : ''} · Fotos recebidas:{' '}
                      <span className="font-mono tabular-nums">{t.photos.length}</span>
                    </p>
                    {t.pendingItems.length > 0 && (
                      <p className="text-[11px] text-amber-300/90">
                        Pendências: {t.pendingItems.join(' · ')}
                      </p>
                    )}
                    {t.approvedValue && t.approvedValue > 0 && (
                      <p className="text-xs font-mono tabular-nums text-emerald-400">
                        Valor pré-aprovado: {formatBRL(t.approvedValue)} (por {t.evaluatedByName || 'Gestão'})
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {t.sessionId && canOpenSession && onOpenSession && (
                      <button
                        type="button"
                        onClick={() => onOpenSession(t.sessionId!)}
                        className="px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08]"
                      >
                        Ver atendimento
                      </button>
                    )}

                    <select
                      value={t.status}
                      onChange={(e) =>
                        void handleUpdateTradeIn(t.id, {
                          status: e.target.value as TradeInStatus,
                        })
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs text-white"
                    >
                      {(Object.keys(TRADE_STATUS_LABELS) as TradeInStatus[]).map((st) => (
                        <option key={st} value={st}>
                          {TRADE_STATUS_LABELS[st]}
                        </option>
                      ))}
                    </select>

                    {canApproveTradeValue && (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          placeholder="Valor R$"
                          value={approvedValueDrafts[t.id] ?? (t.approvedValue ? String(t.approvedValue) : '')}
                          onChange={(e) =>
                            setApprovedValueDrafts((prev) => ({
                              ...prev,
                              [t.id]: e.target.value,
                            }))
                          }
                          className="w-28 px-2.5 py-1.5 rounded-lg bg-[#09090B] border border-white/[0.1] text-xs font-mono text-white"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const val = Number(approvedValueDrafts[t.id]);
                            if (Number.isFinite(val) && val > 0) {
                              void handleUpdateTradeIn(t.id, {
                                approvedValue: val,
                                status: 'aprovada',
                              });
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Aprovar</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
