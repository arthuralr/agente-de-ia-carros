import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  LayoutGrid,
  Loader2,
  MessageCircle,
  RotateCcw,
  Save,
} from 'lucide-react';
import { DealershipSettings, OperationMode } from '../../types';
import { INITIAL_SETTINGS } from '../../data/mockData';

interface SettingsModuleProps {
  settings: DealershipSettings;
  operationMode: OperationMode;
  onChangeOperationMode: (mode: OperationMode) => Promise<void>;
  onSaveSettings: (next: DealershipSettings) => void;
}

export const SettingsModule: React.FC<SettingsModuleProps> = ({
  settings,
  operationMode,
  onChangeOperationMode,
  onSaveSettings,
}) => {
  const [form, setForm] = useState<DealershipSettings>(settings);
  const [selectedMode, setSelectedMode] = useState<OperationMode>(operationMode);
  const [savingMode, setSavingMode] = useState(false);
  const [modeSavedNotice, setModeSavedNotice] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setSelectedMode(operationMode);
  }, [operationMode]);

  const handleModeSelect = async (nextMode: OperationMode) => {
    if (nextMode === operationMode && !modeError) {
      setSelectedMode(nextMode);
      return;
    }
    setSelectedMode(nextMode);
    setSavingMode(true);
    setModeError(null);
    setModeSavedNotice(false);
    try {
      await onChangeOperationMode(nextMode);
      setModeSavedNotice(true);
      setTimeout(() => setModeSavedNotice(false), 3000);
    } catch (err: unknown) {
      setSelectedMode(operationMode);
      setModeError(
        err instanceof Error
          ? err.message
          : 'Erro ao atualizar modo de operação no banco Neon.'
      );
    } finally {
      setSavingMode(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(form);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleReset = () => {
    setForm(INITIAL_SETTINGS);
    onSaveSettings(INITIAL_SETTINGS);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
      {/* Dual Operation Mode (Persisted in Neon PostgreSQL) */}
      <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-white">
              Modo de Operação da Plataforma
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Defina como a rota principal (<span className="font-mono text-zinc-300">/</span>) se
              comporta para visitantes públicos. A alteração é salva imediatamente no banco Neon.
            </p>
          </div>

          {savingMode && (
            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" />
              <span>Salvando modo...</span>
            </span>
          )}
          {!savingMode && modeSavedNotice && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <Check className="w-4 h-4" />
              <span>Modo atualizado</span>
            </span>
          )}
        </div>

        {modeError && (
          <div className="p-3 rounded-lg bg-red-950/50 border border-red-600/40 flex items-center gap-2 text-xs text-red-200">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{modeError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            disabled={savingMode}
            onClick={() => void handleModeSelect('full')}
            className={`text-left p-4 rounded-xl border transition-colors ${
              selectedMode === 'full'
                ? 'bg-red-600/12 border-red-600/50'
                : 'bg-[#09090B] border-white/[0.08] hover:border-white/[0.18]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                <LayoutGrid className="w-4 h-4 text-red-500" />
                <span>Modo Completo (Vitrine + IA)</span>
              </span>
              <span className="text-[11px] font-mono text-zinc-400">full</span>
            </div>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              A rota raiz <span className="font-mono text-zinc-300">/</span> exibe a Vitrine de
              Veículos normalmente e a página <span className="font-mono text-zinc-300">/chat</span>{' '}
              mantém o botão de retorno para o catálogo.
            </p>
          </button>

          <button
            type="button"
            disabled={savingMode}
            onClick={() => void handleModeSelect('agent_only')}
            className={`text-left p-4 rounded-xl border transition-colors ${
              selectedMode === 'agent_only'
                ? 'bg-emerald-600/12 border-emerald-500/50'
                : 'bg-[#09090B] border-white/[0.08] hover:border-white/[0.18]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                <MessageCircle className="w-4 h-4 text-emerald-400" />
                <span>Apenas Agente de IA (WhatsApp)</span>
              </span>
              <span className="text-[11px] font-mono text-zinc-400">agent_only</span>
            </div>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              A rota raiz <span className="font-mono text-zinc-300">/</span> abre diretamente o
              Consultor Virtual estilo WhatsApp em tela cheia, ocultando links para a vitrine —
              ideal para Link na Bio do Instagram e anúncios.
            </p>
          </button>
        </div>
      </div>

      {/* Dealership Data */}
      <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-5">
        <div>
          <h2 className="font-display text-base font-semibold text-white">
            Dados Institucionais da Revenda
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Estas informações são aplicadas automaticamente no cabeçalho dos contratos e
            recibos ATPV-e.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Nome Fantasia
            </label>
            <input
              required
              type="text"
              value={form.tradeName}
              onChange={(e) => setForm({ ...form, tradeName: e.target.value })}
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Razão Social
            </label>
            <input
              required
              type="text"
              value={form.legalName}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              CNPJ
            </label>
            <input
              type="text"
              value={form.cnpj}
              onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Inscrição Estadual
            </label>
            <input
              type="text"
              value={form.stateRegistration}
              onChange={(e) =>
                setForm({ ...form, stateRegistration: e.target.value })
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              WhatsApp Comercial
            </label>
            <input
              type="text"
              value={form.whatsapp}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Telefone Fixo
            </label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Endereço do Showroom
            </label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Cidade
            </label>
            <input
              type="text"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              UF
            </label>
            <input
              type="text"
              maxLength={2}
              value={form.state}
              onChange={(e) =>
                setForm({ ...form, state: e.target.value.toUpperCase() })
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono uppercase focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Opening Hours */}
      <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-4">
        <div>
          <h2 className="font-display text-base font-semibold text-white">
            Horários de Atendimento
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Utilizado pelo assistente virtual para agendamento automático de visitas.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Segunda a Sexta
            </label>
            <input
              type="text"
              value={form.hoursWeekdays}
              onChange={(e) =>
                setForm({ ...form, hoursWeekdays: e.target.value })
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Sábados
            </label>
            <input
              type="text"
              value={form.hoursSaturday}
              onChange={(e) =>
                setForm({ ...form, hoursSaturday: e.target.value })
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Domingos e Feriados
            </label>
            <input
              type="text"
              value={form.hoursSunday}
              onChange={(e) => setForm({ ...form, hoursSunday: e.target.value })}
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* System Parameters */}
      <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-4">
        <div>
          <h2 className="font-display text-base font-semibold text-white">
            Parâmetros Gerais & Garantia CDC
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Regras operacionais padrão dos módulos de Estoque, CRM e Contratos.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Margem Mínima FIPE (%)
            </label>
            <input
              type="number"
              min={1}
              max={40}
              value={form.minResaleMarginPct}
              onChange={(e) =>
                setForm({
                  ...form,
                  minResaleMarginPct: Number(e.target.value) || 10,
                })
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Nome do Assistente IA (Chat)
            </label>
            <input
              type="text"
              value={form.aiAssistantName}
              onChange={(e) =>
                setForm({ ...form, aiAssistantName: e.target.value })
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Garantia Contratual (Dias)
            </label>
            <input
              type="number"
              min={90}
              value={form.warrantyDays}
              onChange={(e) =>
                setForm({ ...form, warrantyDays: Number(e.target.value) || 90 })
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Garantia Contratual (Km)
            </label>
            <input
              type="number"
              min={1000}
              step={500}
              value={form.warrantyKm}
              onChange={(e) =>
                setForm({ ...form, warrantyKm: Number(e.target.value) || 3000 })
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
            />
          </div>

          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              CTA Padrão de WhatsApp para Redes Sociais
            </label>
            <input
              type="text"
              value={form.defaultSocialCta}
              onChange={(e) =>
                setForm({ ...form, defaultSocialCta: e.target.value })
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Restaurar Padrões</span>
        </button>

        <div className="flex items-center gap-3">
          {savedNotice && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <Check className="w-4 h-4" />
              <span>Configurações salvas</span>
            </span>
          )}
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors"
          >
            <Save className="w-4 h-4" />
            <span>Salvar Configurações</span>
          </button>
        </div>
      </div>
    </form>
  );
};
