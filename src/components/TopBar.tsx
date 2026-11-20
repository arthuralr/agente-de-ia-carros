import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellRing,
  CheckCheck,
  ExternalLink,
  Kanban,
  Menu,
  MessageSquareText,
  Plus,
} from 'lucide-react';
import { AdminNotificationItem, NavModule, OperationMode } from '../types';
import { adminFetch } from '../utils/authSession';

interface TopBarProps {
  activeModule: NavModule;
  operationMode?: OperationMode;
  onOpenMobileMenu: () => void;
  onQuickNewVehicle: () => void;
  onOpenPublicCatalog: () => void;
  onUnauthorized?: () => void;
  onOpenChatSession?: (sessionId: string) => void;
  onOpenCrmLead?: (leadId?: string) => void;
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

const NOTIF_SEEN_KEY = 'armazem_admin_notif_seen_at_v1';

function playAdminAlertTone(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch {
    // Ignore browser autoplay constraints
  }
}

function formatRelativePt(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'Agora';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
}

export const TopBar: React.FC<TopBarProps> = ({
  activeModule,
  operationMode = 'full',
  onOpenMobileMenu,
  onQuickNewVehicle,
  onOpenPublicCatalog,
  onUnauthorized,
  onOpenChatSession,
  onOpenCrmLead,
}) => {
  const meta = MODULE_META[activeModule];

  const [notifications, setNotifications] = useState<AdminNotificationItem[]>(
    []
  );
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem(NOTIF_SEEN_KEY) || '0');
      if (Number.isFinite(saved) && saved > 0) return saved;
    } catch {
      // Ignore storage error
    }
    return 0;
  });
  const [browserNotifPermission, setBrowserNotifPermission] = useState<string>(
    () => {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        return Notification.permission;
      }
      return 'unsupported';
    }
  );

  const knownIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const pollNotifications = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/notifications');
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        items?: AdminNotificationItem[];
      };
      const items = Array.isArray(data.items) ? data.items : [];
      setNotifications(items);

      if (!initializedRef.current) {
        initializedRef.current = true;
        items.forEach((it) => knownIdsRef.current.add(it.id));
        if (lastSeenAt === 0 && items.length > 0) {
          // On first visit with no stored watermark, treat older history as seen except the last 10 minutes
          const defaultWatermark = Date.now() - 10 * 60 * 1000;
          setLastSeenAt(defaultWatermark);
          try {
            window.localStorage.setItem(
              NOTIF_SEEN_KEY,
              String(defaultWatermark)
            );
          } catch {
            // Ignore
          }
        }
        return;
      }

      const freshlyArrived = items.filter(
        (it) => !knownIdsRef.current.has(it.id)
      );
      if (freshlyArrived.length > 0) {
        freshlyArrived.forEach((it) => knownIdsRef.current.add(it.id));
        playAdminAlertTone();

        const newest = freshlyArrived[0];
        if (
          typeof window !== 'undefined' &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          try {
            new Notification(newest.title, {
              body: newest.preview,
              icon: '/pwa-192x192.png',
            });
          } catch {
            // Ignore Notification API exceptions
          }
        }
      }
    } catch {
      // Silent retry on next polling cycle
    }
  }, [lastSeenAt, onUnauthorized]);

  useEffect(() => {
    void pollNotifications();
    const timer = window.setInterval(() => {
      void pollNotifications();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [pollNotifications]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [dropdownOpen]);

  const unreadCount = useMemo(() => {
    return notifications.filter(
      (item) => new Date(item.createdAt).getTime() > lastSeenAt
    ).length;
  }, [lastSeenAt, notifications]);

  const markAllAsRead = () => {
    const now = Date.now();
    setLastSeenAt(now);
    try {
      window.localStorage.setItem(NOTIF_SEEN_KEY, String(now));
    } catch {
      // Ignore storage error
    }
  };

  const handleRequestBrowserPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const perm = await Notification.requestPermission();
      setBrowserNotifPermission(perm);
    } catch {
      // Ignore permission errors
    }
  };

  const handleSelectNotification = (item: AdminNotificationItem) => {
    setDropdownOpen(false);
    markAllAsRead();
    if (item.type === 'chat_message' && item.sessionId && onOpenChatSession) {
      onOpenChatSession(item.sessionId);
      return;
    }
    if (item.leadId && onOpenCrmLead) {
      onOpenCrmLead(item.leadId);
      return;
    }
    if (item.sessionId && onOpenChatSession) {
      onOpenChatSession(item.sessionId);
    }
  };

  return (
    <header className="no-print h-16 px-4 sm:px-6 lg:px-8 border-b border-white/[0.08] bg-[#09090B]/95 backdrop-blur-sm flex items-center justify-between gap-4 shrink-0 relative z-30">
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

      <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
        {/* Admin Notification Bell + Unread Badge */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen((prev) => !prev)}
            aria-label="Notificações de mensagens e leads"
            title="Notificações em tempo real"
            className={`relative w-10 h-10 rounded-lg border transition-colors inline-flex items-center justify-center cursor-pointer ${
              dropdownOpen || unreadCount > 0
                ? 'bg-white/[0.08] border-white/[0.16] text-white'
                : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.08] text-zinc-300 hover:text-white'
            }`}
          >
            {unreadCount > 0 ? (
              <BellRing className="w-4 h-4 text-amber-400" />
            ) : (
              <Bell className="w-4 h-4" />
            )}
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-red-600 text-white text-[10px] font-mono font-bold tabular-nums flex items-center justify-center ring-2 ring-[#09090B]">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-[48px] w-[330px] sm:w-[370px] max-w-[calc(100vw-24px)] bg-[#111114] border border-white/[0.12] rounded-xl shadow-2xl overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-white/[0.08] bg-[#0D0D10] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-red-400" />
                  <span className="text-xs font-semibold text-white">
                    Notificações do Atendimento
                  </span>
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllAsRead}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Marcar lidas</span>
                  </button>
                )}
              </div>

              {browserNotifPermission === 'default' && (
                <div className="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-amber-200 leading-snug">
                    Receba alertas no navegador quando chegar um novo lead.
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRequestBrowserPermission()}
                    className="px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-[#09090B] text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Ativar
                  </button>
                </div>
              )}

              <div className="max-h-[360px] overflow-y-auto divide-y divide-white/[0.06]">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-zinc-500">
                    Nenhuma atividade recente de chat ou leads.
                  </div>
                ) : (
                  notifications.map((item) => {
                    const isUnread =
                      new Date(item.createdAt).getTime() > lastSeenAt;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectNotification(item)}
                        className={`w-full text-left px-4 py-3 hover:bg-white/[0.05] transition-colors flex items-start gap-3 cursor-pointer ${
                          isUnread ? 'bg-red-600/[0.07]' : ''
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                            item.type === 'chat_message'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-red-500/15 text-red-400 border border-red-500/30'
                          }`}
                        >
                          {item.type === 'chat_message' ? (
                            <MessageSquareText className="w-4 h-4" />
                          ) : (
                            <Kanban className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-white truncate">
                              {item.title}
                            </p>
                            <span className="text-[10.5px] font-mono tabular-nums text-zinc-500 shrink-0">
                              {formatRelativePt(item.createdAt)}
                            </span>
                          </div>
                          <p className="text-[11.5px] text-zinc-400 line-clamp-2 mt-0.5 leading-snug">
                            {item.preview}
                          </p>
                          {item.leadPhone && (
                            <p className="text-[10.5px] font-mono text-emerald-400/90 mt-1">
                              {item.leadPhone}
                            </p>
                          )}
                        </div>
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-1.5" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

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
