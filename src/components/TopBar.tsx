import React from 'react';
import { Menu, Plus, ExternalLink } from 'lucide-react';
import { NavModule, OperationMode } from '../types';

interface TopBarProps {
  activeModule: NavModule;
  operationMode?: OperationMode;
  onOpenMobileMenu: () => void;
  onQuickNewVehicle: () => void;
  onOpenPublicCatalog: () => void;
}

const MODULE_META: Record<NavModule, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'Visão Geral',
    subtitle: 'Painel executivo · Resumo operacional do showroom',
  },
  inventory: {
    title: 'Gestão de Estoque',
    subtitle: 'Inventário de veículos · Precificação e status em tempo real',
  },
  crm: {
    title: 'CRM de Atendimento & Leads',
    subtitle: 'Funil comercial · Captura via Chat IA e histórico de conversas',
  },
  chat_audit: {
    title: 'Conversas & Atendimentos IA',
    subtitle: 'Auditoria em tempo real · Histórico gravado no Neon e transição para WhatsApp',
  },
  contracts: {
    title: 'Gerador de Contratos & Documentos',
    subtitle: 'Emissão jurídica · Compra e venda, ATPV-e, vistoria e garantia CDC',
  },
  social_ai: {
    title: 'Gerador de Posts para Redes Sociais',
    subtitle: 'Copywriting automotivo com IA · Instagram, Reels e TikTok Shop',
  },
  settings: {
    title: 'Configurações da Revenda',
    subtitle: 'Parâmetros institucionais · Modo de operação, horários e regras do sistema',
  },
};

export const TopBar: React.FC<TopBarProps> = ({
  activeModule,
  operationMode = 'full',
  onOpenMobileMenu,
  onQuickNewVehicle,
  onOpenPublicCatalog,
}) => {
  const meta = MODULE_META[activeModule];

  return (
    <header className="no-print h-16 px-6 lg:px-8 border-b border-white/[0.08] bg-[#09090B]/95 backdrop-blur-sm flex items-center justify-between gap-6 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Abrir menu lateral"
          className="lg:hidden p-2 -ml-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/[0.05]"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="min-w-0">
          <h1 className="font-display text-lg font-semibold text-white truncate">
            {meta.title}
          </h1>
          <p className="text-xs text-zinc-400 truncate hidden sm:block">
            {meta.subtitle}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onOpenPublicCatalog}
          className="hidden sm:inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
          <span>
            {operationMode === 'agent_only'
              ? 'Abrir Agente Público (/chat)'
              : 'Ver Estoque Público'}
          </span>
        </button>

        <button
          type="button"
          onClick={onQuickNewVehicle}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Novo Veículo</span>
        </button>
      </div>
    </header>
  );
};
