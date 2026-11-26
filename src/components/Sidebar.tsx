import React from 'react';
import {
  BarChart3,
  CalendarClock,
  CarFront,
  FileText,
  Home,
  LogOut,
  Megaphone,
  MessageSquareText,
  Settings,
  X,
} from 'lucide-react';
import { AdminUser, NavModule } from '../types';
import { MANAGER_AVATAR_URL } from '../data/mockData';
import { canAccessModule, STAFF_ROLE_META } from '../utils/rbac';

interface SidebarProps {
  activeModule: NavModule;
  onSelectModule: (module: NavModule) => void;
  dealershipName: string;
  adminUser?: AdminUser | null;
  counts: {
    availableVehicles: number;
    newLeads: number;
  };
  onLogout: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItem {
  id: NavModule;
  label: string;
  icon: React.FC<{ className?: string }>;
  count?: number;
  aliases?: NavModule[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeModule,
  onSelectModule,
  dealershipName,
  adminUser,
  counts,
  onLogout,
  mobileOpen,
  onCloseMobile,
}) => {
  const roleCode = adminUser?.roleCode || 'administrador';

  const allNavItems: NavItem[] = [
    { id: 'hoje', label: 'Hoje', icon: Home, aliases: ['dashboard'] },
    {
      id: 'atendimentos',
      label: 'Atendimentos',
      icon: MessageSquareText,
      count: counts.newLeads,
      aliases: ['chat_audit', 'crm'],
    },
    {
      id: 'estoque',
      label: 'Estoque',
      icon: CarFront,
      count: counts.availableVehicles,
      aliases: ['inventory'],
    },
    { id: 'agenda_trocas', label: 'Agenda e Trocas', icon: CalendarClock },
    {
      id: 'divulgacao',
      label: 'Divulgação',
      icon: Megaphone,
      aliases: ['social_ai'],
    },
    {
      id: 'documentos',
      label: 'Documentos',
      icon: FileText,
      aliases: ['contracts'],
    },
    { id: 'gestao', label: 'Gestão', icon: BarChart3 },
    {
      id: 'configuracoes',
      label: 'Configurações',
      icon: Settings,
      aliases: ['settings'],
    },
  ];

  const navItems = allNavItems.filter((item) =>
    canAccessModule(roleCode, item.id)
  );

  const handleNavClick = (id: NavModule) => {
    onSelectModule(id);
    onCloseMobile();
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-xs lg:hidden no-print"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`no-print fixed lg:static inset-y-0 left-0 z-50 w-[264px] shrink-0 bg-[#0D0D10] border-r border-white/[0.08] flex flex-col justify-between transition-transform duration-200 ease-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div>
          {/* Brand Header */}
          <div className="h-16 px-5 flex items-center justify-between border-b border-white/[0.08]">
            <button
              type="button"
              onClick={() => handleNavClick('hoje')}
              className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 rounded-md min-w-0"
            >
              <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center shrink-0">
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4 text-white"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 16h18" />
                  <path d="M5 16l2.2-6.5A2 2 0 0 1 9.1 8h5.8a2 2 0 0 1 1.9 1.5L19 16" />
                  <circle cx="7.5" cy="16" r="1.5" fill="currentColor" />
                  <circle cx="16.5" cy="16" r="1.5" fill="currentColor" />
                </svg>
              </div>
              <div className="min-w-0">
                <span className="font-display font-semibold text-sm tracking-tight text-white block truncate">
                  {dealershipName}
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 block">
                  Central da Revenda
                </span>
              </div>
            </button>

            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Fechar menu"
              className="lg:hidden p-1.5 text-zinc-400 hover:text-white rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Primary Navigation (Filtered by Role) */}
          <nav className="px-3 py-5 space-y-1" aria-label="Menu da Central da Revenda">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                activeModule === item.id ||
                Boolean(item.aliases?.includes(activeModule));
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 ${
                    isActive
                      ? 'bg-red-600/15 text-white border border-red-600/30'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-red-500' : 'text-zinc-500'
                      }`}
                    />
                    <span className="truncate whitespace-nowrap">{item.label}</span>
                  </span>
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span
                      className={`text-xs font-mono tabular-nums shrink-0 ml-2 ${
                        isActive ? 'text-red-400' : 'text-zinc-500'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Footer */}
        <div className="p-4 border-t border-white/[0.08]">
          <div className="flex items-center gap-3 mb-3">
            <img
              src={adminUser?.avatarUrl || MANAGER_AVATAR_URL}
              alt={adminUser?.name || 'Equipe'}
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-lg object-cover border border-white/10 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-zinc-100 truncate">
                {adminUser?.name || 'Equipe'}
              </p>
              <p className="text-xs text-zinc-500 truncate">
                {STAFF_ROLE_META[roleCode]?.label || adminUser?.role || 'Equipe'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.04] hover:bg-red-600/15 hover:text-red-300 border border-white/[0.07] hover:border-red-600/30 transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Sair da Central</span>
          </button>
        </div>
      </aside>
    </>
  );
};
