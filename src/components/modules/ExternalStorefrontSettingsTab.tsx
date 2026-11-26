import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Globe,
  Link2,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Store,
  Wifi,
} from 'lucide-react';
import {
  DealershipSettings,
  ExternalInventorySourceSummary,
  ExternalInventorySourceType,
  StorefrontMode,
  WidgetPosition,
} from '../../types';
import { adminFetch } from '../../utils/authSession';
import { FloatingAgentWidget } from '../public/FloatingAgentWidget';

interface ExternalStorefrontSettingsTabProps {
  settings: DealershipSettings;
  onSaveSettings: (next: DealershipSettings) => Promise<void> | void;
  onUnauthorized?: () => void;
}

const HEALTH_META: Record<
  string,
  { label: string; className: string }
> = {
  ok: {
    label: 'Conectado e sincronizado',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
  },
  connected: {
    label: 'Conectado e sincronizado',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
  },
  empty: {
    label: 'Conectado (estoque vazio)',
    className: 'bg-zinc-800 text-zinc-200 border-white/[0.14]',
  },
  stale: {
    label: 'Desatualizado (mantendo último catálogo válido)',
    className: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
  },
  connector_required: {
    label: 'Conector dedicado necessário',
    className: 'bg-amber-500/15 text-amber-200 border-amber-500/35',
  },
  error: {
    label: 'Falha de conexão',
    className: 'bg-red-500/15 text-red-300 border-red-500/35',
  },
  unavailable: {
    label: 'Fonte indisponível no momento',
    className: 'bg-red-500/15 text-red-300 border-red-500/35',
  },
  not_configured: {
    label: 'Não configurado',
    className: 'bg-zinc-800 text-zinc-300 border-white/[0.1]',
  },
  unconfigured: {
    label: 'Não configurado',
    className: 'bg-zinc-800 text-zinc-300 border-white/[0.1]',
  },
};

function formatSyncTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'Ainda não sincronizado';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ExternalStorefrontSettingsTab: React.FC<
  ExternalStorefrontSettingsTabProps
> = ({ settings, onSaveSettings, onUnauthorized }) => {
  // Storefront & Widget config (stored in dealership_config)
  const [storefrontMode, setStorefrontMode] = useState<StorefrontMode>(
    settings.storefrontMode || 'internal'
  );
  const [publicStoreSlug, setPublicStoreSlug] = useState(
    settings.publicStoreSlug || 'armazem-do-carro'
  );
  const [externalCatalogUrl, setExternalCatalogUrl] = useState(
    settings.externalCatalogUrl || ''
  );
  const [externalHomeUrl, setExternalHomeUrl] = useState(
    settings.externalHomeUrl || ''
  );
  const [widgetEnabled, setWidgetEnabled] = useState(
    settings.widgetEnabled !== false
  );
  const [widgetPosition, setWidgetPosition] = useState<WidgetPosition>(
    settings.widgetPosition === 'bottom-left' ? 'bottom-left' : 'bottom-right'
  );
  const [widgetLabel, setWidgetLabel] = useState(
    settings.widgetLabel || 'Fale com o agente'
  );
  const [widgetAllowedOriginsText, setWidgetAllowedOriginsText] = useState(
    (settings.widgetAllowedOrigins || []).join('\n')
  );

  // Public link validation state (independent from inventory data source!)
  const [validatingLink, setValidatingLink] = useState(false);
  const [linkStatus, setLinkStatus] = useState<{
    ok: boolean;
    message: string;
    httpStatus?: number | null;
  } | null>(null);

  // Saving dealership storefront/widget config
  const [savingStorefront, setSavingStorefront] = useState(false);
  const [storefrontError, setStorefrontError] = useState<string | null>(null);
  const [storefrontSaved, setStorefrontSaved] = useState(false);

  // External inventory data source state (server-only table)
  const [sourceSummary, setSourceSummary] =
    useState<ExternalInventorySourceSummary | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [sourceType, setSourceType] =
    useState<ExternalInventorySourceType>('json_feed');
  const [feedUrl, setFeedUrl] = useState('');
  const [authHeaderName, setAuthHeaderName] = useState('Authorization');
  const [authHeaderValue, setAuthHeaderValue] = useState('');
  const [clearAuthHeader, setClearAuthHeader] = useState(false);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(15);

  const [savingSource, setSavingSource] = useState(false);
  const [testingSource, setTestingSource] = useState(false);
  const [syncingSource, setSyncingSource] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);

  const [copiedSnippet, setCopiedSnippet] = useState(false);

  useEffect(() => {
    setStorefrontMode(settings.storefrontMode || 'internal');
    setPublicStoreSlug(settings.publicStoreSlug || 'armazem-do-carro');
    setExternalCatalogUrl(settings.externalCatalogUrl || '');
    setExternalHomeUrl(settings.externalHomeUrl || '');
    setWidgetEnabled(settings.widgetEnabled !== false);
    setWidgetPosition(
      settings.widgetPosition === 'bottom-left' ? 'bottom-left' : 'bottom-right'
    );
    setWidgetLabel(settings.widgetLabel || 'Fale com o agente');
    setWidgetAllowedOriginsText((settings.widgetAllowedOrigins || []).join('\n'));
  }, [settings]);

  const loadExternalSourceStatus = useCallback(async () => {
    setLoadingSource(true);
    setSourceError(null);
    try {
      const res = await adminFetch('/api/admin/external-storefront/status');
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
      if (!res.ok) {
        throw new Error('Não foi possível consultar o status da integração.');
      }
      const data = (await res.json()) as {
        source?: ExternalInventorySourceSummary | null;
      };
      if (data.source) {
        setSourceSummary(data.source);
        setSourceType(data.source.sourceType);
        setFeedUrl(data.source.feedUrl || '');
        setAuthHeaderName(data.source.authHeaderName || 'Authorization');
        setSyncIntervalMinutes(data.source.syncIntervalMinutes || 15);
        if (
          data.source.publicLinkStatus === 'valid' ||
          data.source.publicLinkStatus === 'invalid'
        ) {
          setLinkStatus({
            ok: data.source.publicLinkStatus === 'valid',
            message:
              data.source.publicLinkDetail ||
              (data.source.publicLinkStatus === 'valid'
                ? 'Link público validado.'
                : 'Link público inválido ou inacessível.'),
          });
        }
      }
    } catch (err) {
      setSourceError(
        err instanceof Error ? err.message : 'Erro ao consultar integração.'
      );
    } finally {
      setLoadingSource(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void loadExternalSourceStatus();
  }, [loadExternalSourceStatus]);

  const handleValidatePublicLink = async () => {
    const trimmed = externalCatalogUrl.trim();
    if (!trimmed) {
      setLinkStatus({
        ok: false,
        message: 'Informe a URL pública da vitrine oficial antes de validar.',
      });
      return;
    }
    setValidatingLink(true);
    setLinkStatus(null);
    try {
      const res = await adminFetch('/api/admin/external-storefront/validate-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        message?: string;
        httpStatus?: number | null;
        summary?: ExternalInventorySourceSummary;
        error?: string;
      };
      if (data.summary) setSourceSummary(data.summary);
      setLinkStatus({
        ok: Boolean(data.ok),
        message:
          data.detail ||
          data.message ||
          data.error ||
          (data.ok
            ? 'Link público validado com sucesso.'
            : 'Não foi possível validar o link informado.'),
        httpStatus: data.httpStatus ?? null,
      });
    } catch {
      setLinkStatus({
        ok: false,
        message: 'Falha de rede ao testar o link público da revenda.',
      });
    } finally {
      setValidatingLink(false);
    }
  };

  const handleSaveStorefrontAndWidget = async (e: React.FormEvent) => {
    e.preventDefault();
    setStorefrontError(null);
    setStorefrontSaved(false);

    if (storefrontMode === 'external' && !externalCatalogUrl.trim()) {
      setStorefrontError(
        'Informe a URL da vitrine oficial do site da revenda para ativar o modo externo.'
      );
      return;
    }

    const parsedOrigins = widgetAllowedOriginsText
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    const normalizedSlug =
      publicStoreSlug
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-|-$/g, '') || 'armazem-do-carro';

    const nextPayload: DealershipSettings = {
      ...settings,
      storefrontMode,
      publicStoreSlug: normalizedSlug,
      externalCatalogUrl: externalCatalogUrl.trim(),
      externalHomeUrl: externalHomeUrl.trim(),
      widgetEnabled,
      widgetPosition,
      widgetLabel: widgetLabel.trim() || 'Fale com o agente',
      widgetAllowedOrigins: parsedOrigins,
    };

    setSavingStorefront(true);
    try {
      await onSaveSettings(nextPayload);
      setPublicStoreSlug(normalizedSlug);
      setStorefrontSaved(true);
      window.setTimeout(() => setStorefrontSaved(false), 3000);
    } catch (err) {
      setStorefrontError(
        err instanceof Error
          ? err.message
          : 'Não foi possível salvar as configurações de vitrine e botão.'
      );
    } finally {
      setSavingStorefront(false);
    }
  };

  const handleSaveSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSource(true);
    setSourceError(null);
    setSourceNotice(null);
    try {
      const res = await adminFetch('/api/admin/external-storefront/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType,
          feedUrl: feedUrl.trim(),
          authHeaderName: authHeaderName.trim(),
          authHeaderValue: authHeaderValue.trim() || undefined,
          clearAuthHeader,
          syncIntervalMinutes,
        }),
      });
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        source?: ExternalInventorySourceSummary;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao salvar fonte de estoque.');
      }
      if (data.source) setSourceSummary(data.source);
      setAuthHeaderValue('');
      setClearAuthHeader(false);
      setSourceNotice(
        'Fonte de dados salva no servidor. Credenciais de acesso nunca são enviadas ao navegador.'
      );
    } catch (err) {
      setSourceError(
        err instanceof Error ? err.message : 'Erro ao salvar fonte de dados.'
      );
    } finally {
      setSavingSource(false);
    }
  };

  const handleTestSource = async () => {
    setTestingSource(true);
    setSourceError(null);
    setSourceNotice(null);
    try {
      const res = await adminFetch('/api/admin/external-storefront/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType,
          feedUrl: feedUrl.trim(),
          authHeaderName: authHeaderName.trim(),
          authHeaderValue: authHeaderValue.trim() || undefined,
        }),
      });
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        message?: string;
        sampleCount?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setSourceError(
          data.detail ||
            data.message ||
            data.error ||
            'Teste de conexão não encontrou estoque válido.'
        );
      } else {
        setSourceNotice(
          data.detail ||
            data.message ||
            `Conexão validada (${data.sampleCount || 0} veículo(s) identificados).`
        );
      }
      await loadExternalSourceStatus();
    } catch {
      setSourceError('Falha ao executar teste de conexão no servidor.');
    } finally {
      setTestingSource(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncingSource(true);
    setSourceError(null);
    setSourceNotice(null);
    try {
      const res = await adminFetch('/api/admin/external-storefront/sync', {
        method: 'POST',
      });
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        message?: string;
        summary?: ExternalInventorySourceSummary;
        source?: ExternalInventorySourceSummary;
        error?: string;
      };
      const nextSummary = data.summary || data.source;
      if (nextSummary) setSourceSummary(nextSummary);
      if (!res.ok || !data.ok) {
        setSourceError(
          data.detail ||
            data.message ||
            data.error ||
            'A sincronização falhou. O catálogo anterior válido foi preservado.'
        );
      } else {
        setSourceNotice(
          data.detail || data.message || 'Sincronização concluída com sucesso.'
        );
      }
    } catch {
      setSourceError('Falha ao acionar sincronização no servidor.');
    } finally {
      setSyncingSource(false);
    }
  };

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://seu-dominio.vercel.app';
  const cleanSlug =
    publicStoreSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '') || 'armazem-do-carro';
  const embedSnippet = `<script src="${origin}/widget.js" data-loja="${cleanSlug}" async></script>`;
  const vehiclePageSnippet = `<script src="${origin}/widget.js" data-loja="${cleanSlug}" data-veiculo="CODIGO-DO-VEICULO" async></script>`;

  const previewSettings: DealershipSettings = {
    ...settings,
    widgetEnabled,
    widgetPosition,
    widgetLabel: widgetLabel.trim() || 'Fale com o agente',
  };

  const healthInfo =
    HEALTH_META[sourceSummary?.connectionStatus || 'not_configured'] ||
    HEALTH_META.not_configured;

  return (
    <div className="space-y-6">
      {/* 1. Storefront Mode + Public Links + Floating Widget Settings */}
      <form onSubmit={(e) => void handleSaveStorefrontAndWidget(e)} className="space-y-6">
        <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold text-white flex items-center gap-2">
              <Store className="w-4 h-4 text-red-500" />
              <span>Site e vitrine da revenda</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Escolha se os clientes navegam pela vitrine interna do sistema ou pela vitrine do
              site oficial da revenda. O estoque interno da Central (
              <span className="font-mono text-zinc-300">/revenda/estoque</span>) permanece
              preservado nos dois modos.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setStorefrontMode('internal')}
              className={`text-left p-4 rounded-xl border transition-colors ${
                storefrontMode === 'internal'
                  ? 'bg-red-600/12 border-red-600/50'
                  : 'bg-[#09090B] border-white/[0.08] hover:border-white/[0.18]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">
                  Usar a vitrine do sistema
                </span>
                <span className="text-[11px] font-mono text-zinc-400">internal</span>
              </div>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
                O site público e o chat consultam o estoque interno e abrem fichas diretamente em{' '}
                <span className="font-mono text-zinc-300">/veiculo/:id</span>.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setStorefrontMode('external')}
              className={`text-left p-4 rounded-xl border transition-colors ${
                storefrontMode === 'external'
                  ? 'bg-emerald-600/12 border-emerald-500/50'
                  : 'bg-[#09090B] border-white/[0.08] hover:border-white/[0.18]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">
                  Usar a vitrine do site oficial
                </span>
                <span className="text-[11px] font-mono text-zinc-400">external</span>
              </div>
              <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
                Menus, rodapé, chat e WhatsApp direcionam o cliente para o site oficial da revenda,
                e o agente consulta o estoque sincronizado da fonte oficial abaixo.
              </p>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                URL da vitrine oficial da revenda {storefrontMode === 'external' ? '*' : '(opcional)'}
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  value={externalCatalogUrl}
                  onChange={(e) => {
                    setExternalCatalogUrl(e.target.value);
                    setLinkStatus(null);
                  }}
                  placeholder="https://www.suarevenda.com.br/estoque"
                  className="flex-1 px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={validatingLink}
                  onClick={() => void handleValidatePublicLink()}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] disabled:opacity-50 whitespace-nowrap"
                >
                  {validatingLink ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Link2 className="w-3.5 h-3.5 text-red-400" />
                  )}
                  <span>Validar link público</span>
                </button>
              </div>
              {linkStatus && (
                <p
                  className={`mt-1.5 text-xs flex items-center gap-1.5 ${
                    linkStatus.ok ? 'text-emerald-400' : 'text-amber-300'
                  }`}
                >
                  {linkStatus.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>
                    Status do link público: {linkStatus.message}
                  </span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                URL da página inicial do site oficial (opcional)
              </label>
              <input
                type="url"
                value={externalHomeUrl}
                onChange={(e) => setExternalHomeUrl(e.target.value)}
                placeholder="https://www.suarevenda.com.br"
                className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Identificador público da revenda (slug)
              </label>
              <input
                type="text"
                value={publicStoreSlug}
                onChange={(e) => setPublicStoreSlug(e.target.value)}
                placeholder="armazem-do-carro"
                className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm font-mono text-white placeholder:text-zinc-600 focus:outline-none"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Usado exclusivamente no código do botão flutuante externo (sem dados privados).
              </p>
            </div>
          </div>
        </div>

        {/* 2. Floating Agent Widget Configuration + Live 3D Preview + Embed Code */}
        <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-red-500" />
                <span>Botão flutuante do agente (interno e site oficial)</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Exibido nas páginas públicas do sistema (nunca sobreposto em{' '}
                <span className="font-mono text-zinc-300">/chat</span>) e pronto para instalação no
                site oficial da revenda com carregamento leve sob demanda.
              </p>
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={widgetEnabled}
                onChange={(e) => setWidgetEnabled(e.target.checked)}
                className="w-4 h-4 rounded accent-red-600"
              />
              <span>Botão ativo</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Texto do botão flutuante
              </label>
              <input
                type="text"
                maxLength={48}
                value={widgetLabel}
                onChange={(e) => setWidgetLabel(e.target.value)}
                placeholder="Fale com o agente"
                className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Posição na tela
              </label>
              <select
                value={widgetPosition}
                onChange={(e) => setWidgetPosition(e.target.value as WidgetPosition)}
                className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
              >
                <option value="bottom-right" className="bg-zinc-950">
                  Canto inferior direito (padrão)
                </option>
                <option value="bottom-left" className="bg-zinc-950">
                  Canto inferior esquerdo
                </option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Domínios autorizados para painel embutido (um por linha — opcional)
              </label>
              <textarea
                rows={2}
                value={widgetAllowedOriginsText}
                onChange={(e) => setWidgetAllowedOriginsText(e.target.value)}
                placeholder={'https://www.suarevenda.com.br\nhttps://suarevenda.com.br'}
                className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-xs font-mono text-white placeholder:text-zinc-600 focus:outline-none"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Se o site externo não estiver listado ou restringir janelas embutidas, o botão
                continua funcionando e abre <span className="font-mono text-zinc-300">/chat</span>{' '}
                diretamente como fallback seguro.
              </p>
            </div>
          </div>

          {/* Live 3D Visual Preview */}
          <FloatingAgentWidget
            settings={previewSettings}
            onOpenChat={() => {}}
            previewMode
          />

          {/* Copyable Installation Snippet */}
          <div className="rounded-xl bg-[#09090B] border border-white/[0.08] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white">
                Código para colar antes de &lt;/body&gt; no site oficial
              </span>
              <div className="flex items-center gap-2">
                <a
                  href="/demo-site-externo"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-zinc-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08]"
                >
                  <Globe className="w-3.5 h-3.5 text-red-400" />
                  <span>Abrir página de teste</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(embedSnippet);
                    setCopiedSnippet(true);
                    window.setTimeout(() => setCopiedSnippet(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-red-600 hover:bg-red-500"
                >
                  {copiedSnippet ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedSnippet ? 'Copiado' : 'Copiar código'}</span>
                </button>
              </div>
            </div>

            <pre className="p-3 rounded-lg bg-zinc-950 border border-white/[0.06] text-[11.5px] font-mono text-emerald-300 overflow-x-auto">
              {embedSnippet}
            </pre>

            <div className="text-[11px] text-zinc-400 space-y-1">
              <p>
                <strong className="text-zinc-200">Em páginas de veículo (opcional):</strong>{' '}
                passe o código do carro em <code className="text-zinc-300">data-veiculo</code>{' '}
                para abrir o chat já focado naquele anúncio:
              </p>
              <code className="block p-2 rounded bg-zinc-950/80 text-[11px] font-mono text-zinc-300 overflow-x-auto">
                {vehiclePageSnippet}
              </code>
            </div>

            <div className="pt-2 border-t border-white/[0.06] text-[11px] text-zinc-400 space-y-1">
              <p className="font-semibold text-zinc-200">
                Checklist rápido de verificação após publicar no site oficial:
              </p>
              <p>1. O botão aparece uma única vez no canto configurado, sem cobrir botões do site.</p>
              <p>2. No desktop, o clique abre o chat flutuante e a tecla ESC fecha voltando o foco ao botão.</p>
              <p>3. No celular, o toque abre o chat completo com o histórico preservado.</p>
            </div>
          </div>

          {storefrontError && (
            <div className="p-3 rounded-lg bg-red-950/50 border border-red-600/40 flex items-center gap-2 text-xs text-red-200">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{storefrontError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            {storefrontSaved && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                <Check className="w-4 h-4" />
                <span>Vitrine e botão salvos no Neon</span>
              </span>
            )}
            <button
              type="submit"
              disabled={savingStorefront}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-60"
            >
              {savingStorefront ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>Salvar Vitrine & Botão</span>
            </button>
          </div>
        </div>
      </form>

      {/* 3. External Inventory Data Connection (Independent from public storefront link) */}
      <form
        onSubmit={(e) => void handleSaveSource(e)}
        className="bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-red-500" />
              <span>Conexão de dados do estoque oficial</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              Status independente do link público acima. Quando o modo externo está ativo, o agente
              responde usando apenas os veículos sincronizados desta fonte oficial.
            </p>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium ${healthInfo.className}`}
          >
            <Wifi className="w-3 h-3" />
            <span>{healthInfo.label}</span>
          </span>
        </div>

        {/* Independent Health Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="rounded-lg bg-[#09090B] border border-white/[0.08] p-3">
            <span className="text-zinc-500 block">Última sincronização bem-sucedida</span>
            <span className="text-zinc-200 font-medium mt-1 block">
              {loadingSource
                ? 'Consultando...'
                : formatSyncTimestamp(sourceSummary?.lastSyncSuccessAt)}
            </span>
          </div>
          <div className="rounded-lg bg-[#09090B] border border-white/[0.08] p-3">
            <span className="text-zinc-500 block">Veículos disponíveis sincronizados</span>
            <span className="text-white font-semibold font-mono text-sm mt-1 block tabular-nums">
              {sourceSummary?.availableCount ?? 0}
            </span>
          </div>
          <div className="rounded-lg bg-[#09090B] border border-white/[0.08] p-3">
            <span className="text-zinc-500 block">Status técnico</span>
            <span className="text-zinc-300 mt-1 block line-clamp-2">
              {sourceSummary?.lastError || 'Sem alertas registrados'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Tipo de fonte do estoque oficial
            </label>
            <select
              value={sourceType}
              onChange={(e) =>
                setSourceType(e.target.value as ExternalInventorySourceType)
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
            >
              <option value="json_feed" className="bg-zinc-950">
                Feed JSON oficial da revenda / integrador
              </option>
              <option value="structured_site" className="bg-zinc-950">
                Dados estruturados do site oficial (JSON-LD)
              </option>
              <option value="site_connector" className="bg-zinc-950">
                Conector dedicado (site sem feed público)
              </option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Intervalo recomendado de atualização (minutos)
            </label>
            <input
              type="number"
              min={5}
              max={1440}
              value={syncIntervalMinutes}
              onChange={(e) =>
                setSyncIntervalMinutes(Math.max(5, Number(e.target.value) || 15))
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm font-mono text-white focus:outline-none"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              URL da fonte de estoque (somente servidor)
            </label>
            <input
              type="url"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder={
                sourceType === 'json_feed'
                  ? 'https://api.suarevenda.com.br/estoque.json'
                  : 'https://www.suarevenda.com.br/estoque'
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white placeholder:text-zinc-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Cabeçalho de autenticação (opcional)
            </label>
            <input
              type="text"
              value={authHeaderName}
              onChange={(e) => setAuthHeaderName(e.target.value)}
              placeholder="Authorization ou X-API-Key"
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm font-mono text-white placeholder:text-zinc-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Token / Chave do feed{' '}
              {sourceSummary?.hasAuthHeader ? '(já configurada no servidor)' : '(opcional)'}
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={authHeaderValue}
              onChange={(e) => {
                setAuthHeaderValue(e.target.value);
                if (e.target.value) setClearAuthHeader(false);
              }}
              placeholder={
                sourceSummary?.hasAuthHeader
                  ? 'Deixe vazio para manter a chave atual'
                  : 'Bearer ...'
              }
              className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm font-mono text-white placeholder:text-zinc-600 focus:outline-none"
            />
            {sourceSummary?.hasAuthHeader && (
              <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearAuthHeader}
                  onChange={(e) => setClearAuthHeader(e.target.checked)}
                  className="rounded accent-red-600"
                />
                <span>Remover chave salva ao gravar</span>
              </label>
            )}
          </div>
        </div>

        {sourceError && (
          <div className="p-3 rounded-lg bg-red-950/50 border border-red-600/40 flex items-center gap-2 text-xs text-red-200">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{sourceError}</span>
          </div>
        )}
        {sourceNotice && (
          <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-500/35 flex items-center gap-2 text-xs text-emerald-200">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{sourceNotice}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            disabled={testingSource || syncingSource}
            onClick={() => void handleTestSource()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] disabled:opacity-50"
          >
            {testingSource ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>Testar conexão</span>
          </button>

          <button
            type="button"
            disabled={syncingSource || testingSource}
            onClick={() => void handleSyncNow()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
          >
            {syncingSource ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>Sincronizar agora</span>
          </button>

          <button
            type="submit"
            disabled={savingSource}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50"
          >
            {savingSource ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Salvar fonte</span>
          </button>
        </div>
      </form>
    </div>
  );
};
