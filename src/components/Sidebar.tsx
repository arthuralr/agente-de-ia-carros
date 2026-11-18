import React from 'react';
import {
  LayoutDashboard,
  CarFront,
  Users,
  FileSignature,
  Sparkles,
  Settings,
  LogOut,
  X,
} from 'lucide-react';
import { AdminUser, NavModule } from '../types';
import { MANAGER_AVATAR_URL } from '../data/mockData';

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
  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Visão Geral', icon: LayoutDashboard },
    { id: 'inventory', label: 'Gestão de Estoque', icon: CarFront, count: counts.availableVehicles },
    { id: 'crm', label: 'CRM & Leads', icon: Users, count: counts.newLeads },
    { id: 'contracts', label: 'Contratos & Docs', icon: FileSignature },
    { id: 'social_ai', label: 'Posts com IA', icon: Sparkles },
    { id: 'settings', label: 'Configurações', icon: Settings },
  ];

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
              onClick={() => handleNavClick('dashboard')}
              className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 rounded-md"
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
              <span className="font-display font-semibold text-base tracking-tight text-white whitespace-nowrap">
                {dealershipName}
              </span>
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

          {/* Primary Navigation */}
          <nav className="px-3 py-5 space-y-1" aria-label="Menu principal">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeModule === item.id;
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
              alt={adminUser?.name || 'Gerente Comercial'}
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-lg object-cover border border-white/10 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-zinc-100 truncate">
                {adminUser?.name || 'Ricardo Almeida'}
              </p>
              <p className="text-xs text-zinc-500 truncate">
                {adminUser?.role || 'Gerente Comercial'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.04] hover:bg-red-600/15 hover:text-red-300 border border-white/[0.07] hover:border-red-600/30 transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Sair do Painel</span>
          </button>
        </div>
      </aside>
    </>
  );
};
