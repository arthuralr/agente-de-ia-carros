import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  LayoutGrid,
  Loader2,
  MessageCircle,
  RotateCcw,
  Save,
} from 'lucide-react';
import { DealershipSettings, OperationMode } from '../../types';
import { INITIAL_SETTINGS } from '../../data/mockData';
import { normalizeStoreWhatsAppNumber } from '../../utils/whatsappHandoff';
import { formatPhoneDisplay } from '../../utils/vehicleDomain';

interface SettingsModuleProps {
  settings: DealershipSettings;
  operationMode: OperationMode;
  storeWhatsappNumber: string;
  onChangeOperationMode: (mode: OperationMode) => Promise<void>;
  onSaveStoreWhatsappNumber: (nextNumber: string) => Promise<void>;
  onSaveSettings: (next: DealershipSettings) => Promise<void> | void;
}

export const SettingsModule: React.FC<SettingsModuleProps> = ({
  settings,
  operationMode,
  storeWhatsappNumber,
  onChangeOperationMode,
  onSaveSettings,
}) => {
  const [form, setForm] = useState<DealershipSettings>(settings);
  const [selectedMode, setSelectedMode] = useState<OperationMode>(operationMode);
  const [savingMode, setSavingMode] = useState(false);
  const [modeSavedNotice, setModeSavedNotice] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setSelectedMode(operationMode);
  }, [operationMode]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      ...settings,
      salesWhatsapp:
        settings.salesWhatsapp || storeWhatsappNumber || settings.whatsapp,
      whatsapp:
        settings.salesWhatsapp || storeWhatsappNumber || settings.whatsapp,
    }));
  }, [settings, storeWhatsappNumber]);

  const activeSalesNormalized = normalizeStoreWhatsAppNumber(
    form.salesWhatsapp || form.whatsapp
  );
  const activeFinancingNormalized = normalizeStoreWhatsAppNumber(
    form.financingWhatsapp || ''
  );

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsError(null);
    setSavedNotice(false);

    const normalizedSales = normalizeStoreWhatsAppNumber(
      form.salesWhatsapp || form.whatsapp
    );
    if (normalizedSales.length < 10) {
      setSettingsError(
        'Informe um WhatsApp principal de vendas válido com DDI + DDD + número (ex: 5511994821040).'
      );
      return;
    }

    const normalizedFinancing = (form.financingWhatsapp || '').trim()
      ? normalizeStoreWhatsAppNumber(form.financingWhatsapp || '')
      : '';
    if ((form.financingWhatsapp || '').trim() && normalizedFinancing.length < 10) {
      setSettingsError(
        'O WhatsApp opcional de financiamento precisa ter DDI + DDD + número ou ficar em branco.'
      );
      return;
    }

    const payload: DealershipSettings = {
      ...form,
      whatsapp: normalizedSales,
      salesWhatsapp: normalizedSales,
      salesWhatsappLabel:
        (form.salesWhatsappLabel || '').trim() || 'Consultor de Vendas',
      financingWhatsapp: normalizedFinancing,
      financingWhatsappLabel:
        (form.financingWhatsappLabel || '').trim() || 'Financeiro / Simulação',
    };

    setSavingSettings(true);
    try {
      await onSaveSettings(payload);
      setForm(payload);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } catch (err: unknown) {
      setSettingsError(
        err instanceof Error
          ? err.message
          : 'Erro ao salvar configurações centralizadas no banco Neon.'
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleReset = async () => {
    setSettingsError(null);
    setSavingSettings(true);
    try {
      const next: DealershipSettings = {
        ...INITIAL_SETTINGS,
        whatsapp: activeSalesNormalized || INITIAL_SETTINGS.whatsapp,
        salesWhatsapp: activeSalesNormalized || INITIAL_SETTINGS.whatsapp,
      };
      await onSaveSettings(next);
      setForm(next);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } catch (err: unknown) {
      setSettingsError(
        err instanceof Error
          ? err.message
          : 'Erro ao restaurar padrões no banco Neon.'
      );
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="max-w-4xl space-y-6">
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
              Consultor Virtual estilo WhatsApp em tela cheia — ideal para Link na Bio do Instagram e anúncios.
            </p>
          </button>
        </div>
      </div>

      {/* Unified Centralized WhatsApp Channels & Financing Parameter (Single Source of Truth in Neon) */}
      <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-5">
        <div>
          <h2 className="font-display text-base font-semibold text-white">
            Canais de WhatsApp da Loja (Fonte Única Centralizada)
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Todos os pontos da aplicação (<span className="font-mono text-zinc-300">/chat</span>,
            vitrine, rodapé e ficha <span className="font-mono text-zinc-300">/veiculo/:id</span>)
            consomem exatamente estes canais salvos no banco Neon.
          </p>
        </div>

        {/* Operational confirmation note */}
        <div className="p-3.5 rounded-lg bg-amber-950/35 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-amber-100">
              Confirme com a loja o número oficial de atendimento ativo
            </p>
            <p className="text-amber-200/85 leading-relaxed">
              Número principal atual:{' '}
              <strong className="font-mono text-white">
                {formatPhoneDisplay(activeSalesNormalized) || 'Não configurado'}
              </strong>
              . Se houver canal separado para Financiamento, informe abaixo com o rótulo do setor para que o cliente veja claramente qual destino está abrindo.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              WhatsApp Principal de Vendas (DDI + DDD + Número) *
            </label>
            <input
              required
              type="tel"
              value={form.salesWhatsapp || form.whatsapp}
              onChange={(e) =>
                setForm({
                  ...form,
                  salesWhatsapp: e.target.value,
                  whatsapp: e.target.value,
                })
              }
              placeholder="5511994821040"
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-emerald-500 rounded-lg text-sm text-white font-mono focus:outline-none"
            />
            <p className="text-[11px] text-zinc-500 font-mono mt-1 truncate">
              {activeSalesNormalized
                ? `https://wa.me/${activeSalesNormalized}`
                : 'Informe DDI 55 + DDD + número'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Rótulo do Canal Principal
            </label>
            <input
              type="text"
              value={form.salesWhatsappLabel || ''}
              onChange={(e) =>
                setForm({ ...form, salesWhatsappLabel: e.target.value })
              }
              placeholder="Consultor de Vendas"
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-emerald-500 rounded-lg text-sm text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              WhatsApp de Financiamento (Opcional)
            </label>
            <input
              type="tel"
              value={form.financingWhatsapp || ''}
              onChange={(e) =>
                setForm({ ...form, financingWhatsapp: e.target.value })
              }
              placeholder="Deixe vazio para usar o mesmo de Vendas"
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-emerald-500 rounded-lg text-sm text-white font-mono focus:outline-none"
            />
            {activeFinancingNormalized && (
              <p className="text-[11px] text-zinc-500 font-mono mt-1 truncate">
                https://wa.me/{activeFinancingNormalized}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Rótulo do Canal de Financiamento
            </label>
            <input
              type="text"
              value={form.financingWhatsappLabel || ''}
              onChange={(e) =>
                setForm({ ...form, financingWhatsappLabel: e.target.value })
              }
              placeholder="Financeiro / Simulação"
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-emerald-500 rounded-lg text-sm text-white focus:outline-none"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Taxa Mensal Ilustrativa de Financiamento (% a.m. — Opcional)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="10"
              value={
                typeof form.financingMonthlyRatePct === 'number'
                  ? form.financingMonthlyRatePct
                  : ''
              }
              onChange={(e) => {
                const raw = e.target.value.trim();
                setForm({
                  ...form,
                  financingMonthlyRatePct:
                    raw === '' ? null : Number(raw.replace(',', '.')),
                });
              }}
              placeholder="Deixe vazio para exibir apenas o saldo a financiar sem inventar parcela"
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-emerald-500 rounded-lg text-sm text-white font-mono focus:outline-none"
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Quando vazio, o consultor virtual calcula exatamente <span className="font-mono text-zinc-300">preço − entrada</span> e informa que a parcela depende da análise bancária.
            </p>
          </div>
        </div>
      </div>

      {/* Dealership Data */}
      <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-5">
        <div>
          <h2 className="font-display text-base font-semibold text-white">
            Dados Institucionais da Revenda
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Aplicados no chat, vitrine, ficha do veículo, contratos e recibos ATPV-e.
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
              Telefone Fixo
            </label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              URL do Logotipo (Opcional)
            </label>
            <input
              type="url"
              value={form.logoUrl || ''}
              onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
              placeholder="https://..."
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
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
            Fonte oficial usada pelo assistente virtual para responder dúvidas de funcionamento e solicitações de visita.
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

      {settingsError && (
        <div className="p-3.5 rounded-lg bg-red-950/50 border border-red-600/40 flex items-center gap-2 text-xs text-red-200">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{settingsError}</span>
        </div>
      )}

      {/* Action Footer */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          disabled={savingSettings}
          onClick={() => void handleReset()}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Restaurar Padrões</span>
        </button>

        <div className="flex items-center gap-3">
          {savedNotice && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <Check className="w-4 h-4" />
              <span>Configurações salvas no Neon</span>
            </span>
          )}
          <button
            type="submit"
            disabled={savingSettings}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-60"
          >
            {savingSettings ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>
              {savingSettings ? 'Salvando...' : 'Salvar Configurações'}
            </span>
          </button>
        </div>
      </div>
    </form>
  );
};
