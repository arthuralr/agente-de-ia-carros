import React, { useState } from 'react';
import { Check, RotateCcw, Save } from 'lucide-react';
import { DealershipSettings } from '../../types';
import { INITIAL_SETTINGS } from '../../data/mockData';

interface SettingsModuleProps {
  settings: DealershipSettings;
  onSaveSettings: (next: DealershipSettings) => void;
}

export const SettingsModule: React.FC<SettingsModuleProps> = ({
  settings,
  onSaveSettings,
}) => {
  const [form, setForm] = useState<DealershipSettings>(settings);
  const [savedNotice, setSavedNotice] = useState(false);

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
            Parâmetros Gerais, Radar & Garantia CDC
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Regras operacionais padrão dos módulos de Radar, CRM e Contratos.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Raio Padrão do Radar (km)
            </label>
            <input
              type="number"
              min={10}
              max={500}
              value={form.radarDefaultRadiusKm}
              onChange={(e) =>
                setForm({
                  ...form,
                  radarDefaultRadiusKm: Number(e.target.value) || 100,
                })
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
            />
          </div>

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
