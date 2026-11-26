import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ExternalLink,
  Kanban,
  Loader2,
  Menu,
  MessageSquareText,
  Plus,
  X,
} from 'lucide-react';
import { AdminNotificationItem, NavModule, OperationMode } from '../types';
import { adminFetch } from '../utils/authSession';
import { useWebPush } from '../hooks/useWebPush';

interface TopBarProps {
  activeModule: NavModule;
  operationMode?: OperationMode;
  canCreateVehicle?: boolean;
  onOpenMobileMenu: () => void;
  onQuickNewVehicle: () => void;
  onOpenPublicCatalog: () => void;
  onUnauthorized?: () => void;
  onOpenChatSession?: (sessionId: string) => void;
  onOpenCrmLead?: (leadId?: string) => void;
}

const MODULE_META: Record<NavModule, { title: string; subtitle: string }> = {
  hoje: {
    title: 'Hoje',
    subtitle: 'Central da Revenda · Pendências acionáveis e copiloto interno',
  },
  atendimentos: {
    title: 'Atendimentos',
    subtitle: 'Fila unificada · Conversas, assunção humana, contexto e funil comercial',
  },
  estoque: {
    title: 'Estoque',
    subtitle: 'Inventário oficial · Precificação, FIPE e alertas cadastrais em tempo real',
  },
  agenda_trocas: {
    title: 'Agenda e Trocas',
    subtitle: 'Visitas ao showroom e pré-avaliação de veículos usados na troca',
  },
  divulgacao: {
    title: 'Divulgação',
    subtitle: 'Peças visuais, classificados e links rastreados direto do estoque',
  },
  documentos: {
    title: 'Documentos',
    subtitle: 'Emissão guiada em PDF, snapshots imutáveis e biblioteca versionada',
  },
  gestao: {
    title: 'Gestão',
    subtitle: 'Indicadores operacionais reais, carga da equipe e reativação',
  },
  configuracoes: {
    title: 'Configurações',
    subtitle: 'Dados oficiais da revenda, canais WhatsApp e controle de equipe',
  },
  // Legacy aliases
  dashboard: {
    title: 'Hoje',
    subtitle: 'Central da Revenda · Pendências acionáveis e copiloto interno',
  },
  inventory: {
    title: 'Estoque',
    subtitle: 'Inventário de veículos · Precificação e status em tempo real',
  },
  crm: {
    title: 'Atendimentos',
    subtitle: 'Funil comercial · Captura via Chat IA e histórico de conversas',
  },
  chat_audit: {
    title: 'Atendimentos',
    subtitle: 'Fila em tempo real · Histórico gravado no Neon e assunção humana',
  },
  contracts: {
    title: 'Documentos',
    subtitle: 'Emissão de propostas, fichas e contratos com histórico preservado',
  },
  social_ai: {
    title: 'Divulgação',
    subtitle: 'Peças prontas para Feed, Stories, Classificados e Carrossel',
  },
  settings: {
    title: 'Configurações',
    subtitle: 'Parâmetros institucionais · Modo de operação, horários e equipe',
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
  canCreateVehicle = true,
  onOpenMobileMenu,
  onQuickNewVehicle,
  onOpenPublicCatalog,
  onUnauthorized,
  onOpenChatSession,
  onOpenCrmLead,
}) => {
  const meta = MODULE_META[activeModule] || MODULE_META.hoje;

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
  const adminPush = useWebPush({ role: 'admin' });

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

  const handleActivateAdminPush = async () => {
    const ok = await adminPush.subscribe();
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setBrowserNotifPermission(Notification.permission);
    }
    return ok;
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

      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {/* Admin Native Web Push Subscription Button (role = 'admin') */}
        <button
          type="button"
          disabled={adminPush.isSubscribing}
          onClick={() => void handleActivateAdminPush()}
          title={
            adminPush.isSubscribed
              ? 'Alertas Push ativos neste aparelho (toque para revalidar)'
              : 'Ativar notificações Push nativas neste aparelho para novos leads e mensagens'
          }
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 ${
            adminPush.isSubscribed
              ? 'bg-emerald-500/12 border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/20'
              : 'bg-amber-500/12 border-amber-500/35 text-amber-200 hover:bg-amber-500/20'
          }`}
        >
          {adminPush.isSubscribing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span className="hidden md:inline">Ativando...</span>
            </>
          ) : adminPush.isSubscribed ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="hidden md:inline">Alertas Ativos</span>
              <span className="md:hidden">Push Ativo</span>
            </>
          ) : (
            <>
              <BellRing className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="hidden xl:inline">
                Ativar Alertas Push neste Aparelho
              </span>
              <span className="xl:hidden">Ativar Alertas Push</span>
            </>
          )}
        </button>

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

              {!adminPush.isSubscribed && browserNotifPermission !== 'denied' && (
                <div className="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-amber-200 leading-snug">
                    Receba alertas Push nativos no celular/PC quando chegar um novo lead.
                  </span>
                  <button
                    type="button"
                    disabled={adminPush.isSubscribing}
                    onClick={() => void handleActivateAdminPush()}
                    className="px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-[#09090B] text-[11px] font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    {adminPush.isSubscribing ? 'Ativando...' : 'Ativar'}
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

        {canCreateVehicle && (
          <button
            type="button"
            onClick={onQuickNewVehicle}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Novo Veículo</span>
          </button>
        )}
      </div>

      {adminPush.statusMessage && (
        <div className="absolute right-4 sm:right-6 top-[68px] z-50 max-w-sm bg-[#111114] border border-amber-500/40 rounded-xl shadow-2xl px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-amber-100">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span className="leading-snug flex-1">{adminPush.statusMessage}</span>
          <button
            type="button"
            onClick={adminPush.clearStatusMessage}
            aria-label="Fechar aviso"
            className="text-zinc-400 hover:text-white shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </header>
  );
};
