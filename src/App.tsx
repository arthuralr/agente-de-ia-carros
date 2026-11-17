import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  ActivityLog,
  AdminUser,
  AppViewMode,
  DealershipSettings,
  Lead,
  NavModule,
  RadarOpportunity,
  Vehicle,
} from './types';
import {
  INITIAL_ACTIVITY,
  INITIAL_SETTINGS,
  INITIAL_VEHICLES,
} from './data/mockData';
import {
  ApiLeadRow,
  ApiRadarRow,
  ApiVehicleRow,
  mapDbLeadToFrontend,
  mapDbRadarToFrontend,
  mapDbVehicleToFrontend,
  parseYearPair,
} from './db/mappers';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { DashboardModule } from './components/modules/DashboardModule';
import { InventoryModule } from './components/modules/InventoryModule';
import { CrmModule } from './components/modules/CrmModule';
import { ContractsModule } from './components/modules/ContractsModule';
import { SocialAiModule } from './components/modules/SocialAiModule';
import { RadarModule } from './components/modules/RadarModule';
import { SettingsModule } from './components/modules/SettingsModule';
import { PublicCatalogPage } from './components/public/PublicCatalogPage';
import { PublicHomePage } from './components/public/PublicHomePage';
import { VehicleDetailModal } from './components/public/VehicleDetailModal';
import { AiChatDrawer } from './components/public/AiChatDrawer';
import { StandaloneChatPage } from './components/public/StandaloneChatPage';
import { AdminLoginPage } from './components/auth/AdminLoginPage';
import { adminFetch, clearAdminSessionToken } from './utils/authSession';

function loadStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const MODULE_PATH_MAP: Record<NavModule, string> = {
  dashboard: '/admin/visao-geral',
  inventory: '/admin/estoque',
  crm: '/admin/crm',
  contracts: '/admin/contratos',
  social_ai: '/admin/ia',
  radar: '/admin/radar',
  settings: '/admin/configuracoes',
};

function parseRouteFromPathname(pathname: string): {
  viewMode: AppViewMode;
  module: NavModule;
} {
  const clean = pathname.replace(/\/+$/, '') || '/';

  if (clean === '/inicio' || clean === '/home') {
    return { viewMode: 'home', module: 'inventory' };
  }
  if (clean === '/chat' || clean === '/atendimento') {
    return { viewMode: 'chat', module: 'inventory' };
  }
  if (clean === '/login') {
    return { viewMode: 'login', module: 'inventory' };
  }
  if (clean === '/admin' || clean.startsWith('/admin/')) {
    const sub = clean.slice('/admin'.length);
    if (sub === '/visao-geral' || sub === '/dashboard') {
      return { viewMode: 'admin', module: 'dashboard' };
    }
    if (sub === '/crm') return { viewMode: 'admin', module: 'crm' };
    if (sub === '/contratos') return { viewMode: 'admin', module: 'contracts' };
    if (sub === '/ia' || sub === '/posts-ia') {
      return { viewMode: 'admin', module: 'social_ai' };
    }
    if (sub === '/radar') return { viewMode: 'admin', module: 'radar' };
    if (sub === '/configuracoes') return { viewMode: 'admin', module: 'settings' };
    return { viewMode: 'admin', module: 'inventory' };
  }

  return { viewMode: 'catalog', module: 'inventory' };
}

function getPathForView(viewMode: AppViewMode, module: NavModule): string {
  if (viewMode === 'home') return '/inicio';
  if (viewMode === 'chat') return '/chat';
  if (viewMode === 'login') return '/login';
  if (viewMode === 'admin') return MODULE_PATH_MAP[module] || '/admin/estoque';
  return '/';
}

export default function App() {
  const initialRoute = parseRouteFromPathname(
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );

  const [viewMode, setViewMode] = useState<AppViewMode>(initialRoute.viewMode);
  const [activeModule, setActiveModule] = useState<NavModule>(initialRoute.module);
  const [pendingAdminModule, setPendingAdminModule] = useState<NavModule>(
    initialRoute.module
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Auth Session State
  const [authUser, setAuthUser] = useState<AdminUser | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [loginRedirectNotice, setLoginRedirectNotice] = useState<string | null>(
    null
  );

  // Storefront & Admin Domain State
  const [vehicles, setVehicles] = useState<Vehicle[]>(
    INITIAL_VEHICLES.filter((v) => v.status === 'Disponível')
  );
  const [leads, setLeads] = useState<Lead[]>([]);
  const [settings, setSettings] = useState<DealershipSettings>(() =>
    loadStored('armazem_settings_v1', INITIAL_SETTINGS)
  );
  const [radarItems, setRadarItems] = useState<RadarOpportunity[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>(INITIAL_ACTIVITY);

  // Public Chat Lead Token Store (allows public visitors to append chat turns without admin auth)
  const publicChatTokensRef = useRef<Map<string, string>>(new Map());

  // Public modals / drawers
  const [detailVehicle, setDetailVehicle] = useState<Vehicle | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatVehicle, setChatVehicle] = useState<Vehicle | null>(null);

  // Admin cross-module navigation state
  const [triggerNewVehicleModal, setTriggerNewVehicleModal] = useState(false);
  const [preselectedLeadId, setPreselectedLeadId] = useState<string | null>(null);
  const [contractPreselect, setContractPreselect] = useState<{
    leadId: string | null;
    vehicleId: string | null;
  }>({ leadId: null, vehicleId: null });
  const [socialPreselectVehicleId, setSocialPreselectVehicleId] = useState<
    string | null
  >(null);

  const navigateTo = useCallback(
    (nextView: AppViewMode, nextModule?: NavModule, replace = false) => {
      const resolvedModule = nextModule ?? activeModule;
      if (nextModule) {
        setActiveModule(nextModule);
      }
      setViewMode(nextView);

      if (typeof window !== 'undefined') {
        const targetPath = getPathForView(nextView, resolvedModule);
        if (window.location.pathname !== targetPath) {
          if (replace) {
            window.history.replaceState(null, '', targetPath);
          } else {
            window.history.pushState(null, '', targetPath);
          }
        }
      }
    },
    [activeModule]
  );

  const handleUnauthorizedSession = useCallback(
    (notice = 'Sua sessão administrativa expirou ou requer autenticação.') => {
      clearAdminSessionToken();
      setAuthUser(null);
      setLeads([]);
      setRadarItems([]);
      setLoginRedirectNotice(notice);
      navigateTo('login', undefined, true);
    },
    [navigateTo]
  );

  const hydratePublicVehicles = useCallback(async () => {
    try {
      const res = await fetch('/api/public/vehicles');
      if (res.ok) {
        const rows = (await res.json()) as ApiVehicleRow[];
        if (Array.isArray(rows)) {
          setVehicles(rows.map(mapDbVehicleToFrontend));
        }
      }
    } catch {
      // Keep current public fallback if offline
    }
  }, []);

  const hydrateAdminData = useCallback(async () => {
    try {
      const [vehRes, leadRes, radarRes] = await Promise.all([
        adminFetch('/api/vehicles'),
        adminFetch('/api/leads'),
        adminFetch('/api/radar'),
      ]);

      if (
        vehRes.status === 401 ||
        leadRes.status === 401 ||
        radarRes.status === 401
      ) {
        handleUnauthorizedSession();
        return;
      }

      if (vehRes.ok) {
        const rows = (await vehRes.json()) as ApiVehicleRow[];
        if (Array.isArray(rows)) {
          setVehicles(rows.map(mapDbVehicleToFrontend));
        }
      }

      if (leadRes.ok) {
        const rows = (await leadRes.json()) as ApiLeadRow[];
        if (Array.isArray(rows)) {
          setLeads(rows.map(mapDbLeadToFrontend));
        }
      }

      if (radarRes.ok) {
        const rows = (await radarRes.json()) as ApiRadarRow[];
        if (Array.isArray(rows)) {
          setRadarItems(rows.map(mapDbRadarToFrontend));
        }
      }
    } catch {
      // Ignore transient network errors
    }
  }, [handleUnauthorizedSession]);

  // Verify existing HttpOnly cookie session + hydrate public storefront on mount
  useEffect(() => {
    let active = true;

    async function initApp() {
      void hydratePublicVehicles();

      try {
        const res = await adminFetch('/api/auth/me');
        if (!active) return;

        if (res.ok) {
          const data = (await res.json()) as {
            authenticated?: boolean;
            user?: AdminUser;
          };
          if (data.authenticated && data.user) {
            setAuthUser(data.user);
            await hydrateAdminData();
          }
        }
      } catch {
        // Unauthenticated
      } finally {
        if (active) {
          setAuthChecking(false);
        }
      }
    }

    void initApp();
    return () => {
      active = false;
    };
  }, [hydrateAdminData, hydratePublicVehicles]);

  // Browser back/forward route listener
  useEffect(() => {
    const onPopState = () => {
      const parsed = parseRouteFromPathname(window.location.pathname);
      setActiveModule(parsed.module);
      setViewMode(parsed.viewMode);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Route Protection Middleware (Frontend Guard)
  useEffect(() => {
    if (authChecking) return;

    if (viewMode === 'admin' && !authUser) {
      setPendingAdminModule(activeModule);
      setLoginRedirectNotice(
        'Acesso restrito. Autentique-se para abrir o Painel Administrativo.'
      );
      navigateTo('login', undefined, true);
      return;
    }

    if (viewMode === 'login' && authUser) {
      setLoginRedirectNotice(null);
      navigateTo('admin', pendingAdminModule, true);
    }
  }, [
    activeModule,
    authChecking,
    authUser,
    navigateTo,
    pendingAdminModule,
    viewMode,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem('armazem_settings_v1', JSON.stringify(settings));
    } catch {
      // Storage quota ignored
    }
  }, [settings]);

  const pushActivity = (
    title: string,
    detail: string,
    category: ActivityLog['category']
  ) => {
    setActivities((prev) => [
      {
        id: `act-${Date.now()}`,
        title,
        detail,
        time: 'Agora',
        category,
      },
      ...prev,
    ]);
  };

  const handleOpenAdminEntry = () => {
    if (authUser) {
      setLoginRedirectNotice(null);
      navigateTo('admin', activeModule);
    } else {
      setPendingAdminModule(activeModule);
      setLoginRedirectNotice(null);
      navigateTo('login');
    }
  };

  const handleLoginSuccess = async (user: AdminUser) => {
    setAuthUser(user);
    setLoginRedirectNotice(null);
    await hydrateAdminData();
    navigateTo('admin', pendingAdminModule, true);
  };

  const handleLogout = async () => {
    try {
      await adminFetch('/api/auth/logout', {
        method: 'POST',
      });
    } catch {
      // Ignore network errors on logout
    }
    clearAdminSessionToken();
    setAuthUser(null);
    setLeads([]);
    setRadarItems([]);
    setLoginRedirectNotice('Sessão encerrada com segurança.');
    void hydratePublicVehicles();
    navigateTo('login', undefined, true);
  };

  const refreshVehiclesFromDb = async () => {
    const res = await adminFetch('/api/vehicles');
    if (res.status === 401) {
      handleUnauthorizedSession();
      return;
    }
    if (res.ok) {
      const rows = (await res.json()) as ApiVehicleRow[];
      setVehicles(rows.map(mapDbVehicleToFrontend));
    }
  };

  const handleAddVehicle = async (vehicle: Vehicle): Promise<void> => {
    const { year_fab, year_model } = parseYearPair(vehicle.year);
    const res = await adminFetch('/api/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: vehicle.brand,
        model: vehicle.model,
        version: vehicle.version,
        year_fab,
        year_model,
        km: vehicle.km,
        price: vehicle.price,
        status: 'Disponivel',
        fuel: vehicle.fuel,
        transmission: vehicle.transmission,
        image_url: vehicle.imageUrl,
        options: vehicle.optionals,
      }),
    });

    if (res.status === 401) {
      handleUnauthorizedSession();
      throw new Error('Sessão administrativa expirada.');
    }

    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || 'Falha ao inserir veículo no banco Neon.');
    }

    const created = (await res.json()) as ApiVehicleRow;
    const mapped = mapDbVehicleToFrontend(created);
    mapped.color = vehicle.color || mapped.color;
    mapped.plate = vehicle.plate || mapped.plate;
    mapped.fipePrice = vehicle.fipePrice || mapped.fipePrice;
    mapped.category = vehicle.category || mapped.category;

    setVehicles((prev) => [mapped, ...prev]);
    await refreshVehiclesFromDb().catch(() => {});

    pushActivity(
      'Novo veículo cadastrado no estoque',
      `${vehicle.brand} ${vehicle.model} ${vehicle.year} inserido com status Disponivel`,
      'estoque'
    );
  };

  const handleUpdateVehicle = async (updated: Vehicle): Promise<void> => {
    setVehicles((prev) =>
      prev.map((v) => (v.id === updated.id ? updated : v))
    );
    pushActivity(
      'Ficha de veículo atualizada',
      `${updated.brand} ${updated.model} · Status atual: ${updated.status}`,
      'estoque'
    );

    if (/^\d+$/.test(updated.id)) {
      const { year_fab, year_model } = parseYearPair(updated.year);
      const res = await adminFetch(`/api/vehicles/${updated.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: updated.brand,
          model: updated.model,
          version: updated.version,
          year_fab,
          year_model,
          km: updated.km,
          price: updated.price,
          status: updated.status,
          fuel: updated.fuel,
          transmission: updated.transmission,
          image_url: updated.imageUrl,
          options: updated.optionals,
        }),
      });
      if (res.status === 401) {
        handleUnauthorizedSession();
        throw new Error('Sessão administrativa expirada.');
      }
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || 'Falha ao atualizar veículo no banco.');
      }
      await refreshVehiclesFromDb().catch(() => {});
    }
  };

  const handleDeleteVehicle = async (id: string): Promise<void> => {
    const target = vehicles.find((v) => v.id === id);
    setVehicles((prev) => prev.filter((v) => v.id !== id));
    if (target) {
      pushActivity(
        'Veículo removido do inventário',
        `${target.brand} ${target.model} (${target.plate}) excluído`,
        'estoque'
      );
    }

    if (/^\d+$/.test(id)) {
      try {
        const res = await adminFetch(`/api/vehicles/${id}`, {
          method: 'DELETE',
        });
        if (res.status === 401) {
          handleUnauthorizedSession();
        }
      } catch {
        // Ignore network error
      }
    }
  };

  const refreshLeadsFromDb = async () => {
    const res = await adminFetch('/api/leads');
    if (res.status === 401) {
      handleUnauthorizedSession();
      return;
    }
    if (res.ok) {
      const rows = (await res.json()) as ApiLeadRow[];
      setLeads(rows.map(mapDbLeadToFrontend));
    }
  };

  const handleUpdateLead = async (updated: Lead): Promise<void> => {
    const previousLead = leads.find((l) => l.id === updated.id);
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));

    if (/^\d+$/.test(updated.id)) {
      const res = await adminFetch(`/api/leads/${updated.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: updated.name,
          phone: updated.whatsapp,
          vehicle_interest: updated.vehicleInterestLabel,
          stage: updated.stage,
          chat_history: JSON.stringify(updated.chatHistory),
        }),
      });

      if (res.status === 401) {
        handleUnauthorizedSession();
        throw new Error('Sessão administrativa expirada.');
      }

      if (!res.ok) {
        if (previousLead) {
          setLeads((prev) =>
            prev.map((l) => (l.id === updated.id ? previousLead : l))
          );
        }
        const errData = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errData.error || 'Falha ao atualizar estágio do lead no banco.'
        );
      }

      const savedRow = (await res.json()) as ApiLeadRow;
      const mapped = mapDbLeadToFrontend(savedRow);
      setLeads((prev) =>
        prev.map((l) =>
          l.id === updated.id
            ? {
                ...updated,
                stage: mapped.stage,
                createdAt: mapped.createdAt,
              }
            : l
        )
      );

      if (previousLead && previousLead.stage !== updated.stage) {
        pushActivity(
          'Etapa de lead atualizada no CRM',
          `${updated.name} movido para ${updated.stage}`,
          'crm'
        );
      }
    }
  };

  // Used inside protected Admin CRM
  const handleAddLeadAdmin = async (lead: Lead): Promise<Lead> => {
    const res = await adminFetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: lead.name,
        phone: lead.whatsapp,
        vehicle_interest: lead.vehicleInterestLabel,
        stage: lead.stage || 'Novo Lead',
        chat_history: JSON.stringify(lead.chatHistory),
      }),
    });

    if (res.status === 401) {
      handleUnauthorizedSession();
      throw new Error('Sessão administrativa expirada.');
    }

    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        errData.error || 'Falha ao registrar lead no banco de dados.'
      );
    }

    const created = (await res.json()) as ApiLeadRow;
    const mapped = mapDbLeadToFrontend(created);
    const hydratedLead: Lead = {
      ...mapped,
      email: lead.email || mapped.email,
      cpf: lead.cpf || mapped.cpf,
      address: lead.address || mapped.address,
      city: lead.city || mapped.city,
      vehicleInterestId: lead.vehicleInterestId || mapped.vehicleInterestId,
      source: lead.source || mapped.source,
      notes: lead.notes || mapped.notes,
      lastActivity: 'Agora',
    };

    setLeads((prev) => [hydratedLead, ...prev]);
    pushActivity(
      'Novo lead registrado no CRM',
      `${hydratedLead.name} · Interesse: ${hydratedLead.vehicleInterestLabel}`,
      'crm'
    );
    await refreshLeadsFromDb().catch(() => {});
    return hydratedLead;
  };

  // Used by Public Storefront ("Tenho Interesse" & AI Chat Drawer) without requiring admin login
  const handleCapturePublicLead = async (lead: Lead): Promise<Lead> => {
    const res = await fetch('/api/public/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: lead.name,
        phone: lead.whatsapp,
        vehicle_interest: lead.vehicleInterestLabel,
        chat_history: JSON.stringify(lead.chatHistory),
      }),
    });

    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        errData.error || 'Falha ao registrar interesse no atendimento.'
      );
    }

    const created = (await res.json()) as ApiLeadRow & { chatToken?: string };
    const mapped = mapDbLeadToFrontend(created);
    if (created.chatToken) {
      publicChatTokensRef.current.set(mapped.id, created.chatToken);
    }

    const hydratedLead: Lead = {
      ...mapped,
      vehicleInterestId: lead.vehicleInterestId || mapped.vehicleInterestId,
      source: 'Chat IA do Site',
      lastActivity: 'Agora',
    };

    if (authUser) {
      setLeads((prev) => [hydratedLead, ...prev]);
    }
    return hydratedLead;
  };

  const handleSyncPublicLeadChat = async (
    leadId: string,
    chatHistory: Lead['chatHistory']
  ): Promise<void> => {
    if (authUser) {
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, chatHistory } : l))
      );
    }

    const chatToken = publicChatTokensRef.current.get(leadId);
    if (/^\d+$/.test(leadId) && chatToken) {
      await fetch(`/api/public/leads/${leadId}/chat`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatToken,
          chat_history: JSON.stringify(chatHistory),
        }),
      }).catch(() => {});
    }
  };

  const refreshRadarFromDb = async () => {
    const res = await adminFetch('/api/radar');
    if (res.status === 401) {
      handleUnauthorizedSession();
      return;
    }
    if (res.ok) {
      const rows = (await res.json()) as ApiRadarRow[];
      setRadarItems((prev) =>
        rows.map((row) => {
          const mapped = mapDbRadarToFrontend(row);
          const existing = prev.find((p) => p.id === mapped.id);
          return existing
            ? { ...mapped, saved: existing.saved, imported: existing.imported }
            : mapped;
        })
      );
    }
  };

  const handleAddRadarOpportunity = async (payload: {
    platform: 'OLX' | 'Webmotors' | 'Marketplace';
    title: string;
    price: number;
    fipe_price: number;
    link: string;
  }) => {
    const res = await adminFetch('/api/radar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      handleUnauthorizedSession();
      throw new Error('Sessão administrativa expirada.');
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Falha ao cadastrar oportunidade no radar.');
    }

    const mapped = mapDbRadarToFrontend(data as ApiRadarRow);
    setRadarItems((prev) => [mapped, ...prev]);
    pushActivity(
      'Nova oportunidade monitorada no Radar',
      `${mapped.title} (${mapped.source})`,
      'radar'
    );
  };

  const handleToggleRadarSave = (id: string) => {
    setRadarItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, saved: !item.saved } : item
      )
    );
  };

  const handleImportRadarToInventory = (
    opp: RadarOpportunity,
    newVehicle: Vehicle
  ) => {
    setRadarItems((prev) =>
      prev.map((item) =>
        item.id === opp.id ? { ...item, imported: true } : item
      )
    );
    void handleAddVehicle(newVehicle);
    pushActivity(
      'Oportunidade importada do Radar',
      `${opp.title} (${opp.source}) entrou no estoque disponível`,
      'radar'
    );
  };

  const handleQuickNewVehicle = () => {
    navigateTo('admin', 'inventory');
    setTriggerNewVehicleModal(true);
  };

  const handleSelectAdminModule = (module: NavModule) => {
    navigateTo('admin', module);
  };

  const openVehicleInterestChat = (vehicle: Vehicle) => {
    setChatVehicle(vehicle);
    setChatOpen(true);
  };

  const openGeneralChat = () => {
    setChatVehicle(null);
    setChatOpen(true);
  };

  // 1A. Public Standalone Mobile-First Agent Page (/chat or /atendimento)
  if (viewMode === 'chat') {
    return (
      <StandaloneChatPage
        vehicles={vehicles}
        settings={settings}
        onCaptureLead={handleCapturePublicLead}
        onSyncLeadChat={handleSyncPublicLeadChat}
        onOpenCatalog={() => {
          void hydratePublicVehicles();
          navigateTo('catalog');
        }}
      />
    );
  }

  // 1B. Public Storefront Views (Always accessible without authentication)
  if (viewMode === 'catalog' || viewMode === 'home') {
    return (
      <>
        {viewMode === 'catalog' ? (
          <PublicCatalogPage
            vehicles={vehicles}
            settings={settings}
            onBackHome={() => navigateTo('home')}
            onOpenAdmin={handleOpenAdminEntry}
            onOpenDetails={(v) => setDetailVehicle(v)}
            onInterest={openVehicleInterestChat}
            onOpenGeneralChat={openGeneralChat}
          />
        ) : (
          <PublicHomePage
            vehicles={vehicles}
            settings={settings}
            onGoToCatalog={() => navigateTo('catalog')}
            onOpenAdmin={handleOpenAdminEntry}
            onOpenDetails={(v) => setDetailVehicle(v)}
            onInterest={openVehicleInterestChat}
            onOpenGeneralChat={openGeneralChat}
          />
        )}

        <VehicleDetailModal
          vehicle={detailVehicle}
          settings={settings}
          onClose={() => setDetailVehicle(null)}
          onInterest={openVehicleInterestChat}
        />

        <AiChatDrawer
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
          targetVehicle={chatVehicle}
          vehicles={vehicles}
          settings={settings}
          onCaptureLead={handleCapturePublicLead}
          onSyncLeadChat={handleSyncPublicLeadChat}
          onOpenStandaloneChat={() => {
            setChatOpen(false);
            navigateTo('chat');
          }}
        />
      </>
    );
  }

  // 2. Auth Session Verification Screen (prevents flashing protected routes before check completes)
  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#09090B] text-zinc-200 flex flex-col items-center justify-center gap-3 p-6">
        <Loader2 className="w-6 h-6 text-red-600 animate-spin" />
        <p className="text-sm text-zinc-400">
          Verificando sessão administrativa...
        </p>
      </div>
    );
  }

  // 3. Dedicated Login Page (also blocks any unauthenticated access to /admin)
  if (viewMode === 'login' || !authUser) {
    return (
      <AdminLoginPage
        dealershipName={settings.tradeName}
        redirectNotice={loginRedirectNotice}
        onLoginSuccess={handleLoginSuccess}
        onBackToCatalog={() => {
          setLoginRedirectNotice(null);
          navigateTo('catalog');
        }}
      />
    );
  }

  // 4. Protected Admin Panel View (only reachable with verified Neon JWT session)
  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex">
      <Sidebar
        activeModule={activeModule}
        onSelectModule={handleSelectAdminModule}
        dealershipName={settings.tradeName}
        adminUser={authUser}
        counts={{
          availableVehicles: vehicles.filter((v) => v.status === 'Disponível')
            .length,
          newLeads: leads.filter((l) => l.stage === 'Novo Lead').length,
          radarDeals: radarItems.filter((r) => !r.imported).length,
        }}
        onLogout={() => void handleLogout()}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        <TopBar
          activeModule={activeModule}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onQuickNewVehicle={handleQuickNewVehicle}
          onOpenPublicCatalog={() => {
            void hydratePublicVehicles();
            navigateTo('catalog');
          }}
        />

        <main className="flex-1 p-5 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {activeModule === 'dashboard' && (
            <DashboardModule
              vehicles={vehicles}
              leads={leads}
              activities={activities}
              onNavigate={handleSelectAdminModule}
              onSelectLead={(leadId) => {
                setPreselectedLeadId(leadId);
                handleSelectAdminModule('crm');
              }}
            />
          )}

          {activeModule === 'inventory' && (
            <InventoryModule
              vehicles={vehicles}
              onAddVehicle={handleAddVehicle}
              onUpdateVehicle={handleUpdateVehicle}
              onDeleteVehicle={handleDeleteVehicle}
              onGeneratePostForVehicle={(vehicleId) => {
                setSocialPreselectVehicleId(vehicleId);
                handleSelectAdminModule('social_ai');
              }}
              externalModalOpen={triggerNewVehicleModal}
              onCloseExternalModal={() => setTriggerNewVehicleModal(false)}
            />
          )}

          {activeModule === 'crm' && (
            <CrmModule
              leads={leads}
              vehicles={vehicles}
              aiAssistantName={settings.aiAssistantName}
              onUpdateLead={handleUpdateLead}
              onAddLead={handleAddLeadAdmin}
              onRefreshLeads={refreshLeadsFromDb}
              onGenerateContractForLead={(leadId, vehicleId) => {
                setContractPreselect({ leadId, vehicleId });
                handleSelectAdminModule('contracts');
              }}
              preselectedLeadId={preselectedLeadId}
              onClearPreselectedLead={() => setPreselectedLeadId(null)}
            />
          )}

          {activeModule === 'contracts' && (
            <ContractsModule
              leads={leads}
              vehicles={vehicles}
              settings={settings}
              preselectedLeadId={contractPreselect.leadId}
              preselectedVehicleId={contractPreselect.vehicleId}
              onClearPreselection={() =>
                setContractPreselect({ leadId: null, vehicleId: null })
              }
              onContractCreated={(record) => {
                pushActivity(
                  'Contrato registrado no histórico',
                  `${record.clientName} · ${record.vehicleLabel}`,
                  'contrato'
                );
              }}
              onUnauthorized={() => handleUnauthorizedSession()}
            />
          )}

          {activeModule === 'social_ai' && (
            <SocialAiModule
              vehicles={vehicles}
              settings={settings}
              preselectedVehicleId={socialPreselectVehicleId}
              onClearPreselection={() => setSocialPreselectVehicleId(null)}
              onUnauthorized={() => handleUnauthorizedSession()}
            />
          )}

          {activeModule === 'radar' && (
            <RadarModule
              opportunities={radarItems}
              settings={settings}
              onToggleSave={handleToggleRadarSave}
              onImportToInventory={handleImportRadarToInventory}
              onRefreshRadar={refreshRadarFromDb}
              onAddOpportunity={handleAddRadarOpportunity}
            />
          )}

          {activeModule === 'settings' && (
            <SettingsModule
              settings={settings}
              onSaveSettings={(next) => {
                setSettings(next);
                pushActivity(
                  'Configurações atualizadas',
                  'Parâmetros institucionais e regras da revenda salvos',
                  'estoque'
                );
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
