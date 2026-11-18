import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Calendar,
  FileSignature,
  Kanban,
  List,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { Lead, LeadStage, Vehicle } from '../../types';
import { formatBRL, formatWhatsAppLink } from '../../utils/formatters';
import { ChatMarkdown } from '../public/ChatMarkdown';

interface CrmModuleProps {
  leads: Lead[];
  vehicles: Vehicle[];
  aiAssistantName: string;
  onUpdateLead: (lead: Lead) => Promise<void>;
  onAddLead: (lead: Lead) => Promise<Lead | void>;
  onDeleteLead?: (leadId: string) => Promise<void>;
  onRefreshLeads?: () => Promise<void>;
  onGenerateContractForLead: (leadId: string, vehicleId: string) => void;
  preselectedLeadId: string | null;
  onClearPreselectedLead: () => void;
}

const STAGES: LeadStage[] = ['Novo Lead', 'Em Atendimento', 'Proposta', 'Fechado'];

export const CrmModule: React.FC<CrmModuleProps> = ({
  leads,
  vehicles,
  aiAssistantName,
  onUpdateLead,
  onAddLead,
  onDeleteLead,
  onRefreshLeads,
  onGenerateContractForLead,
  preselectedLeadId,
  onClearPreselectedLead,
}) => {
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [search, setSearch] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [savingLeadId, setSavingLeadId] = useState<string | null>(null);
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null);
  const [confirmDeleteLead, setConfirmDeleteLead] = useState<Lead | null>(null);
  const [isCreatingLead, setIsCreatingLead] = useState(false);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [visitDraft, setVisitDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');

  const [newLeadForm, setNewLeadForm] = useState({
    name: '',
    whatsapp: '',
    email: '',
    cpf: '',
    address: '',
    city: 'São Paulo - SP',
    vehicleInterestId: vehicles[0]?.id || '',
    source: 'WhatsApp Direto' as Lead['source'],
    notes: '',
  });

  useEffect(() => {
    if (onRefreshLeads) {
      setIsRefreshing(true);
      onRefreshLeads()
        .catch(() => {})
        .finally(() => setIsRefreshing(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (preselectedLeadId) {
      setSelectedLeadId(preselectedLeadId);
      onClearPreselectedLead();
    }
  }, [preselectedLeadId, onClearPreselectedLead]);

  const selectedLead = leads.find((l) => l.id === selectedLeadId) || null;

  useEffect(() => {
    if (selectedLead) {
      setVisitDraft(selectedLead.visitScheduled || '');
      setNotesDraft(selectedLead.notes || '');
    }
  }, [selectedLeadId, selectedLead?.visitScheduled, selectedLead?.notes]);

  const filteredLeads = leads.filter((lead) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return `${lead.name} ${lead.whatsapp} ${lead.vehicleInterestLabel} ${lead.source}`
      .toLowerCase()
      .includes(term);
  });

  const handleManualRefresh = async () => {
    if (!onRefreshLeads || isRefreshing) return;
    setIsRefreshing(true);
    setCrmError(null);
    try {
      await onRefreshLeads();
    } catch (err: unknown) {
      setCrmError(
        err instanceof Error ? err.message : 'Falha ao atualizar lista de leads.'
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const moveStage = async (lead: Lead, nextStage: LeadStage) => {
    if (lead.stage === nextStage) return;
    setSavingLeadId(lead.id);
    setCrmError(null);
    try {
      await onUpdateLead({ ...lead, stage: nextStage, lastActivity: 'Agora' });
    } catch (err: unknown) {
      setCrmError(
        err instanceof Error
          ? err.message
          : 'Não foi possível salvar a mudança de estágio no banco.'
      );
    } finally {
      setSavingLeadId(null);
    }
  };

  const handleSaveDetails = async () => {
    if (!selectedLead) return;
    setSavingLeadId(selectedLead.id);
    setCrmError(null);
    try {
      await onUpdateLead({
        ...selectedLead,
        visitScheduled: visitDraft,
        notes: notesDraft,
        lastActivity: 'Agora',
      });
    } catch (err: unknown) {
      setCrmError(
        err instanceof Error
          ? err.message
          : 'Não foi possível salvar as anotações do lead.'
      );
    } finally {
      setSavingLeadId(null);
    }
  };

  const handleConfirmPermanentDelete = async () => {
    if (!confirmDeleteLead || !onDeleteLead || deletingLeadId) return;
    setDeletingLeadId(confirmDeleteLead.id);
    setCrmError(null);
    try {
      await onDeleteLead(confirmDeleteLead.id);
      if (selectedLeadId === confirmDeleteLead.id) {
        setSelectedLeadId(null);
      }
      setConfirmDeleteLead(null);
    } catch (err: unknown) {
      setCrmError(
        err instanceof Error
          ? err.message
          : 'Não foi possível excluir os dados do lead no banco.'
      );
      setConfirmDeleteLead(null);
    } finally {
      setDeletingLeadId(null);
    }
  };

  const handleDropOnColumn = (stage: LeadStage) => {
    if (!draggedLeadId) return;
    const target = leads.find((l) => l.id === draggedLeadId);
    if (target && target.stage !== stage) {
      void moveStage(target, stage);
    }
    setDraggedLeadId(null);
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeadForm.name.trim() || !newLeadForm.whatsapp.trim() || isCreatingLead) {
      return;
    }

    setIsCreatingLead(true);
    setCreateError(null);

    const vehicle = vehicles.find((v) => v.id === newLeadForm.vehicleInterestId);
    const created: Lead = {
      id: `lead-${Date.now()}`,
      name: newLeadForm.name.trim(),
      whatsapp: newLeadForm.whatsapp.trim(),
      email: newLeadForm.email.trim(),
      cpf: newLeadForm.cpf.trim(),
      rg: '',
      address: newLeadForm.address.trim(),
      city: newLeadForm.city.trim(),
      vehicleInterestId: vehicle?.id || '',
      vehicleInterestLabel: vehicle
        ? `${vehicle.brand} ${vehicle.model} ${vehicle.year}`
        : 'Consultoria Geral',
      stage: 'Novo Lead',
      source: newLeadForm.source,
      createdAt: 'Agora',
      lastActivity: 'Agora',
      notes: newLeadForm.notes.trim(),
      chatHistory: [
        {
          id: `msg-${Date.now()}`,
          sender: 'ia',
          text: `Atendimento iniciado manualmente para ${newLeadForm.name.trim()} sobre ${
            vehicle ? `${vehicle.brand} ${vehicle.model}` : 'veículos do estoque'
          }.`,
          timestamp: new Date().toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        },
      ],
    };

    try {
      await onAddLead(created);
      setIsNewModalOpen(false);
      setNewLeadForm({
        name: '',
        whatsapp: '',
        email: '',
        cpf: '',
        address: '',
        city: 'São Paulo - SP',
        vehicleInterestId: vehicles[0]?.id || '',
        source: 'WhatsApp Direto',
        notes: '',
      });
    } catch (err: unknown) {
      setCreateError(
        err instanceof Error
          ? err.message
          : 'Erro ao salvar novo lead no banco de dados.'
      );
    } finally {
      setIsCreatingLead(false);
    }
  };

  const resolveMatchedVehicleId = (lead: Lead): string => {
    if (lead.vehicleInterestId) return lead.vehicleInterestId;
    const label = lead.vehicleInterestLabel.toLowerCase();
    const match = vehicles.find(
      (v) =>
        label.includes(v.brand.toLowerCase()) &&
        label.includes(v.model.toLowerCase())
    );
    return match?.id || vehicles[0]?.id || '';
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[240px] max-w-sm">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar lead, WhatsApp ou carro..."
              className="w-full pl-10 pr-4 py-2 bg-[#111114] border border-white/[0.08] focus:border-red-600/60 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#111114] border border-white/[0.08] rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === 'kanban'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Kanban className="w-3.5 h-3.5" />
              <span>Funil Visual</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === 'list'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Lista de Contatos</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {onRefreshLeads && (
            <button
              type="button"
              onClick={() => void handleManualRefresh()}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-[#111114] hover:bg-white/[0.06] border border-white/[0.08] transition-colors whitespace-nowrap disabled:opacity-60"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
              />
              <span>Atualizar</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              setIsNewModalOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Lead</span>
          </button>
        </div>
      </div>

      {crmError && (
        <div className="px-4 py-3 rounded-lg bg-red-950/50 border border-red-600/40 flex items-center justify-between gap-3 text-xs text-red-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{crmError}</span>
          </div>
          <button
            type="button"
            onClick={() => setCrmError(null)}
            className="text-red-300 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Kanban View */}
      {viewMode === 'kanban' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
          {STAGES.map((stage, stageIdx) => {
            const columnLeads = filteredLeads.filter((l) => l.stage === stage);
            const columnTotal = columnLeads.reduce(
              (acc, l) => acc + (l.proposalValue || 0),
              0
            );

            return (
              <div
                key={stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDropOnColumn(stage)}
                className="bg-[#111114] border border-white/[0.08] rounded-xl p-3.5 min-h-[420px] flex flex-col"
              >
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/[0.06]">
                  <div>
                    <h3 className="font-display text-sm font-semibold text-white">
                      {stage}
                    </h3>
                    {columnTotal > 0 && (
                      <p className="text-[11px] font-mono text-zinc-500 tabular-nums mt-0.5">
                        {formatBRL(columnTotal)}
                      </p>
                    )}
                  </div>
                  <span className="font-mono text-xs text-zinc-400 tabular-nums">
                    {columnLeads.length}
                  </span>
                </div>

                <div className="space-y-3 flex-1">
                  {columnLeads.length === 0 ? (
                    <div className="py-10 text-center text-xs text-zinc-600">
                      Arraste ou mova um lead para cá
                    </div>
                  ) : (
                    columnLeads.map((lead) => (
                      <div
                        key={lead.id}
                        draggable
                        onDragStart={() => setDraggedLeadId(lead.id)}
                        className="bg-[#18181C] border border-white/[0.07] hover:border-white/[0.16] rounded-lg p-3.5 transition-colors cursor-pointer"
                        onClick={() => setSelectedLeadId(lead.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-white leading-snug">
                            {lead.name}
                          </p>
                          <span className="text-[11px] text-zinc-500 whitespace-nowrap shrink-0">
                            {lead.lastActivity}
                          </span>
                        </div>

                        <p className="text-xs text-red-400 font-medium mt-1 truncate">
                          {lead.vehicleInterestLabel}
                        </p>

                        <p className="text-xs text-zinc-400 mt-1.5 font-mono tabular-nums">
                          {lead.whatsapp} · {lead.source}
                        </p>

                        {lead.visitScheduled && (
                          <p className="text-[11px] text-amber-400 mt-2 flex items-center gap-1.5">
                            <Calendar className="w-3 h-3 shrink-0" />
                            <span>Visita: {lead.visitScheduled}</span>
                          </p>
                        )}

                        <div
                          className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-[11px] text-zinc-500">
                            {lead.chatHistory.length} msg no chat IA
                          </span>

                          <div className="flex items-center gap-1">
                            {stageIdx > 0 && (
                              <button
                                type="button"
                                disabled={savingLeadId === lead.id}
                                title={`Mover para ${STAGES[stageIdx - 1]}`}
                                onClick={() =>
                                  void moveStage(lead, STAGES[stageIdx - 1])
                                }
                                className="p-1.5 rounded bg-white/[0.04] hover:bg-white/[0.1] disabled:opacity-50 text-zinc-400 hover:text-white transition-colors"
                              >
                                <ArrowLeft className="w-3 h-3" />
                              </button>
                            )}
                            {stageIdx < STAGES.length - 1 && (
                              <button
                                type="button"
                                disabled={savingLeadId === lead.id}
                                title={`Avançar para ${STAGES[stageIdx + 1]}`}
                                onClick={() =>
                                  void moveStage(lead, STAGES[stageIdx + 1])
                                }
                                className="p-1.5 rounded bg-white/[0.04] hover:bg-red-600/20 disabled:opacity-50 text-zinc-400 hover:text-red-400 transition-colors"
                              >
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="bg-[#111114] border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] text-xs font-medium text-zinc-400 bg-white/[0.01]">
                  <th className="py-3.5 px-5">Cliente</th>
                  <th className="py-3.5 px-4">WhatsApp</th>
                  <th className="py-3.5 px-4">Veículo de Interesse</th>
                  <th className="py-3.5 px-4">Origem</th>
                  <th className="py-3.5 px-4">Etapa do Funil</th>
                  <th className="py-3.5 px-5 text-right">Histórico IA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-sm">
                {filteredLeads.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLeadId(lead.id)}
                    className="hover:bg-white/[0.02] cursor-pointer transition-colors"
                  >
                    <td className="py-3.5 px-5">
                      <p className="font-medium text-white">{lead.name}</p>
                      <p className="text-xs text-zinc-500">{lead.city}</p>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-zinc-300 tabular-nums whitespace-nowrap">
                      {lead.whatsapp}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-zinc-200">
                      {lead.vehicleInterestLabel}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-zinc-400">
                      {lead.source}
                    </td>
                    <td
                      className="py-3.5 px-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <select
                        value={lead.stage}
                        disabled={savingLeadId === lead.id}
                        onChange={(e) =>
                          void moveStage(lead, e.target.value as LeadStage)
                        }
                        className="bg-[#09090B] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-red-600 disabled:opacity-60"
                      >
                        {STAGES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedLeadId(lead.id)}
                        className="text-xs font-medium text-red-400 hover:text-red-300 whitespace-nowrap"
                      >
                        Ver conversa ({lead.chatHistory.length})
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Lead Detail & AI Chat History Slide-Over Drawer */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-xl bg-[#111114] border-l border-white/[0.1] h-full flex flex-col">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-white truncate">
                  {selectedLead.name}
                </h2>
                <p className="text-xs text-zinc-400 truncate mt-0.5">
                  {selectedLead.source} · Capturado {selectedLead.createdAt}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLeadId(null)}
                className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/[0.05]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Quick Actions & Contact */}
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={formatWhatsAppLink(
                    selectedLead.whatsapp,
                    `Olá ${selectedLead.name.split(' ')[0]}, sou da Armazém do Carro e estou continuando seu atendimento sobre o ${selectedLead.vehicleInterestLabel}.`
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors whitespace-nowrap"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Chamar no WhatsApp ({selectedLead.whatsapp})</span>
                </a>

                <button
                  type="button"
                  onClick={() =>
                    onGenerateContractForLead(
                      selectedLead.id,
                      resolveMatchedVehicleId(selectedLead)
                    )
                  }
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] transition-colors whitespace-nowrap"
                >
                  <FileSignature className="w-3.5 h-3.5 text-red-500" />
                  <span>Gerar Contrato</span>
                </button>
              </div>

              {/* Lead Contact & Vehicle Interest Summary */}
              <div className="bg-[#09090B] border border-white/[0.08] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-zinc-500 block">Telefone / WhatsApp</span>
                  <span className="font-mono text-white font-medium tabular-nums">
                    {selectedLead.whatsapp}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Veículo de Interesse</span>
                  <span className="text-red-400 font-medium">
                    {selectedLead.vehicleInterestLabel}
                  </span>
                </div>
              </div>

              {/* Funnel & Negotiation Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Etapa no Funil
                  </label>
                  <select
                    value={selectedLead.stage}
                    disabled={savingLeadId === selectedLead.id}
                    onChange={(e) =>
                      void moveStage(selectedLead, e.target.value as LeadStage)
                    }
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-red-600 disabled:opacity-60"
                  >
                    {STAGES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Visita Agendada
                  </label>
                  <input
                    type="text"
                    value={visitDraft}
                    onChange={(e) => setVisitDraft(e.target.value)}
                    onBlur={() => void handleSaveDetails()}
                    placeholder="Ex: Hoje, 16:30"
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-zinc-400">
                    Anotações Comerciais
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleSaveDetails()}
                    disabled={savingLeadId === selectedLead.id}
                    className="text-[11px] font-medium text-red-400 hover:text-red-300 disabled:opacity-60"
                  >
                    {savingLeadId === selectedLead.id
                      ? 'Salvando...'
                      : 'Salvar anotações'}
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={() => void handleSaveDetails()}
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-red-600"
                />
              </div>

              {/* AI Chat History Transcript */}
              <div className="pt-4 border-t border-white/[0.08]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display text-sm font-semibold text-white">
                    Histórico com {aiAssistantName}
                  </h3>
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {selectedLead.chatHistory.length} mensagens
                  </span>
                </div>

                <div className="space-y-3 bg-[#09090B] border border-white/[0.08] rounded-xl p-4">
                  {selectedLead.chatHistory.map((msg) => {
                    const isAi = msg.sender === 'ia';
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${
                          isAi ? 'items-start' : 'items-end'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-1">
                          {isAi ? (
                            <>
                              <Bot className="w-3 h-3 text-red-500" />
                              <span>{aiAssistantName}</span>
                            </>
                          ) : (
                            <>
                              <User className="w-3 h-3 text-zinc-400" />
                              <span>{selectedLead.name.split(' ')[0]}</span>
                            </>
                          )}
                          <span>·</span>
                          <span className="font-mono tabular-nums">{msg.timestamp}</span>
                        </div>
                        <div
                          className={`max-w-[90%] rounded-lg px-4 py-3 ${
                            isAi
                              ? 'bg-[#18181C] text-zinc-200 border border-white/[0.08]'
                              : 'bg-red-600/20 text-zinc-100 border border-red-600/30'
                          }`}
                        >
                          <ChatMarkdown
                            content={msg.text}
                            variant={isAi ? 'ai' : 'user'}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* LGPD Privacy Status & Right to Erasure */}
              <div className="pt-4 border-t border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2 text-xs text-zinc-400">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-zinc-200 font-medium">
                      Conformidade LGPD · Consentimento {selectedLead.lgpdConsent === false ? 'pendente' : 'ativo'}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      {selectedLead.lgpdConsentAt
                        ? `Registrado em ${selectedLead.lgpdConsentAt}`
                        : 'Armazenamento minimizado (nome, WhatsApp e histórico)'}
                    </p>
                  </div>
                </div>

                {onDeleteLead && (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteLead(selectedLead)}
                    disabled={deletingLeadId === selectedLead.id}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-red-400 hover:text-white bg-red-950/30 hover:bg-red-600 border border-red-600/30 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Excluir Dados (LGPD)</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LGPD Permanent Erasure Confirmation Modal */}
      {confirmDeleteLead && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#111114] border border-red-600/30 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
              <div className="flex items-center gap-2 text-red-400">
                <Trash2 className="w-4 h-4" />
                <h3 className="font-display text-sm font-semibold text-white">
                  Excluir Dados do Titular (LGPD)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeleteLead(null)}
                disabled={Boolean(deletingLeadId)}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs text-zinc-300 leading-relaxed">
              <p>
                Você está prestes a remover definitivamente os dados pessoais de{' '}
                <strong className="text-white">{confirmDeleteLead.name}</strong> ({confirmDeleteLead.whatsapp})
                e todo o histórico de conversa da base PostgreSQL (Neon), em cumprimento ao direito de
                revogação e eliminação previsto na LGPD.
              </p>
              <p className="text-zinc-400">
                Esta ação é irreversível e não poderá ser desfeita.
              </p>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteLead(null)}
                  disabled={Boolean(deletingLeadId)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.05] hover:bg-white/[0.09] disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmPermanentDelete()}
                  disabled={Boolean(deletingLeadId)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-60"
                >
                  {deletingLeadId && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{deletingLeadId ? 'Excluindo...' : 'Confirmar Exclusão Definitiva'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Lead Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#111114] border border-white/[0.1] rounded-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-white">
                Registrar Novo Lead
              </h2>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="p-2 text-zinc-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateLead} className="p-6 space-y-4">
              {createError && (
                <div className="px-3 py-2 rounded-lg bg-red-950/50 border border-red-600/40 text-xs text-red-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Nome Completo *
                </label>
                <input
                  required
                  type="text"
                  value={newLeadForm.name}
                  onChange={(e) =>
                    setNewLeadForm((p) => ({ ...p, name: e.target.value }))
                  }
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    WhatsApp *
                  </label>
                  <input
                    required
                    type="text"
                    value={newLeadForm.whatsapp}
                    onChange={(e) =>
                      setNewLeadForm((p) => ({ ...p, whatsapp: e.target.value }))
                    }
                    placeholder="(11) 99999-0000"
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white font-mono focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Canal de Origem
                  </label>
                  <select
                    value={newLeadForm.source}
                    onChange={(e) =>
                      setNewLeadForm((p) => ({
                        ...p,
                        source: e.target.value as Lead['source'],
                      }))
                    }
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-red-600"
                  >
                    <option value="WhatsApp Direto">WhatsApp Direto</option>
                    <option value="Chat IA do Site">Chat IA do Site</option>
                    <option value="Instagram">Instagram</option>
                    <option value="Showroom">Showroom</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Veículo de Interesse
                </label>
                <select
                  value={newLeadForm.vehicleInterestId}
                  onChange={(e) =>
                    setNewLeadForm((p) => ({
                      ...p,
                      vehicleInterestId: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-red-600"
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.brand} {v.model} {v.year} — {formatBRL(v.price)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Observações iniciais
                </label>
                <textarea
                  rows={2}
                  value={newLeadForm.notes}
                  onChange={(e) =>
                    setNewLeadForm((p) => ({ ...p, notes: e.target.value }))
                  }
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  disabled={isCreatingLead}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.05] hover:bg-white/[0.09] disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCreatingLead}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-60"
                >
                  {isCreatingLead && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isCreatingLead ? 'Salvando...' : 'Adicionar ao Funil'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
