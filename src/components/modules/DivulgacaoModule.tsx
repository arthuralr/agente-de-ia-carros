import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AdminUser,
  DealershipSettings,
  MarketingDraftRecord,
  MarketingFormat,
  Vehicle,
} from '../../types';
import { adminFetch } from '../../utils/authSession';
import { formatBRL, formatKm } from '../../utils/formatters';
import {
  buildDeterministicMarketingOutput,
  renderMarketingArtworkDataUrl,
  revalidateMarketingDraft,
} from '../../utils/marketingTemplates';
import { hasPermission } from '../../utils/rbac';
import { VehicleImage } from '../VehicleImage';

interface DivulgacaoModuleProps {
  currentUser: AdminUser;
  vehicles: Vehicle[];
  settings: DealershipSettings;
  preselectedVehicleId?: string | null;
  onClearPreselection?: () => void;
  onUnauthorized: () => void;
  onOpenVehicleSheet: (vehicleId: string) => void;
}

const FORMAT_META: Array<{
  id: MarketingFormat;
  label: string;
  aspectHint: string;
}> = [
  { id: 'feed', label: 'Feed (4:5)', aspectHint: '1080 × 1350 · Instagram / Facebook' },
  { id: 'stories', label: 'Stories / Status (9:16)', aspectHint: '1080 × 1920 · WhatsApp / Stories' },
  { id: 'classificado', label: 'Classificados (Texto)', aspectHint: 'OLX · Webmotors · Marketplace' },
  { id: 'carrossel', label: 'Carrossel (4 slides)', aspectHint: '1080 × 1350 · 4 lâminas' },
];

export const DivulgacaoModule: React.FC<DivulgacaoModuleProps> = ({
  currentUser,
  vehicles,
  settings,
  preselectedVehicleId,
  onClearPreselection,
  onUnauthorized,
  onOpenVehicleSheet,
}) => {
  const canCreate = hasPermission(currentUser.roleCode, 'marketing:create');

  const availableFirst = useMemo(() => {
    return [...vehicles].sort((a, b) => {
      if (a.status === 'Disponível' && b.status !== 'Disponível') return -1;
      if (a.status !== 'Disponível' && b.status === 'Disponível') return 1;
      return 0;
    });
  }, [vehicles]);

  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(
    preselectedVehicleId || availableFirst[0]?.id || ''
  );
  const [format, setFormat] = useState<MarketingFormat>('feed');
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string>('');
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);
  const [customTitle, setCustomTitle] = useState<string>('');
  const [captionText, setCaptionText] = useState<string>('');
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null);

  const [drafts, setDrafts] = useState<MarketingDraftRecord[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [polishingAi, setPolishingAi] = useState(false);
  const [renderingPng, setRenderingPng] = useState(false);
  const [previewPngUrl, setPreviewPngUrl] = useState<string | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (preselectedVehicleId) {
      setSelectedVehicleId(preselectedVehicleId);
      setEditingDraftId(null);
      onClearPreselection?.();
    }
  }, [preselectedVehicleId, onClearPreselection]);

  useEffect(() => {
    if (!selectedVehicleId && availableFirst.length > 0) {
      setSelectedVehicleId(availableFirst[0].id);
    }
  }, [availableFirst, selectedVehicleId]);

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => String(v.id) === String(selectedVehicleId)) || null,
    [vehicles, selectedVehicleId]
  );

  const appOrigin =
    typeof window !== 'undefined' ? window.location.origin : '';

  const vehiclePhotos = useMemo(() => {
    if (!selectedVehicle) return [];
    const list = [
      selectedVehicle.imageUrl,
      ...(selectedVehicle.gallery || []),
    ].filter((u): u is string => Boolean(u && u.trim()));
    return Array.from(new Set(list));
  }, [selectedVehicle]);

  useEffect(() => {
    if (vehiclePhotos.length > 0 && !vehiclePhotos.includes(selectedPhotoUrl)) {
      setSelectedPhotoUrl(vehiclePhotos[0]);
    }
  }, [vehiclePhotos, selectedPhotoUrl]);

  // Deterministic 0-token output recalculated live from stock + official Admin settings
  const deterministicOutput = useMemo(() => {
    if (!selectedVehicle) return null;
    return buildDeterministicMarketingOutput({
      vehicle: selectedVehicle,
      dealership: settings,
      format,
      selectedPhotoUrl: selectedPhotoUrl || selectedVehicle.imageUrl,
      baseUrl: appOrigin,
    });
  }, [selectedVehicle, settings, format, selectedPhotoUrl, appOrigin]);

  // Keep caption & title synced when switching vehicle/format (unless actively editing an existing draft)
  useEffect(() => {
    if (!deterministicOutput || editingDraftId !== null) return;
    setCustomTitle(deterministicOutput.title);
    setCaptionText(
      format === 'classificado'
        ? deterministicOutput.classifiedText
        : deterministicOutput.caption
    );
    setActiveSlideIndex(0);
  }, [deterministicOutput, format, editingDraftId]);

  const loadDrafts = useCallback(async () => {
    setLoadingDrafts(true);
    try {
      const res = await adminFetch('/api/admin/marketing/drafts');
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { drafts?: MarketingDraftRecord[] };
      setDrafts(Array.isArray(data.drafts) ? data.drafts : []);
    } catch {
      // ignore transient network failure
    } finally {
      setLoadingDrafts(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  // Render live Canvas PNG artwork (0 tokens) for visual formats
  useEffect(() => {
    if (!selectedVehicle || format === 'classificado') {
      setPreviewPngUrl(null);
      return;
    }
    let cancelled = false;
    setRenderingPng(true);
    const activePhoto =
      format === 'carrossel'
        ? deterministicOutput?.carouselSlides[activeSlideIndex]?.photoUrl ||
          selectedPhotoUrl ||
          selectedVehicle.imageUrl
        : selectedPhotoUrl || selectedVehicle.imageUrl;

    void renderMarketingArtworkDataUrl({
      vehicle: selectedVehicle,
      dealership: settings,
      format,
      photoUrl: activePhoto,
      slideIndex: activeSlideIndex,
      customHeadline: customTitle || undefined,
    })
      .then((dataUrl) => {
        if (!cancelled) setPreviewPngUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setPreviewPngUrl(null);
      })
      .finally(() => {
        if (!cancelled) setRenderingPng(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedVehicle,
    settings,
    format,
    selectedPhotoUrl,
    activeSlideIndex,
    customTitle,
    deterministicOutput,
  ]);

  const activeDraftObj = useMemo(
    () => drafts.find((d) => d.id === editingDraftId) || null,
    [drafts, editingDraftId]
  );

  const liveValidation = useMemo(() => {
    if (!selectedVehicle) return null;
    return revalidateMarketingDraft(
      activeDraftObj ? activeDraftObj.snapshotPrice : selectedVehicle.price,
      activeDraftObj ? activeDraftObj.snapshotStatus : selectedVehicle.status,
      selectedVehicle
    );
  }, [selectedVehicle, activeDraftObj]);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setErrorMsg('Não foi possível copiar para a área de transferência.');
    }
  };

  const handleDownloadArtwork = async (slideIdx?: number) => {
    if (!selectedVehicle || format === 'classificado') return;
    if (liveValidation && !liveValidation.canExportActiveOffer) {
      setErrorMsg(
        `Exportação bloqueada: o veículo está "${selectedVehicle.status}". Altere o status no estoque se desejar publicar como disponível.`
      );
      return;
    }

    setErrorMsg(null);
    const idx = typeof slideIdx === 'number' ? slideIdx : activeSlideIndex;
    const photo =
      format === 'carrossel'
        ? deterministicOutput?.carouselSlides[idx]?.photoUrl ||
          selectedPhotoUrl ||
          selectedVehicle.imageUrl
        : selectedPhotoUrl || selectedVehicle.imageUrl;

    try {
      const dataUrl = await renderMarketingArtworkDataUrl({
        vehicle: selectedVehicle,
        dealership: settings,
        format,
        photoUrl: photo,
        slideIndex: idx,
        customHeadline: customTitle || undefined,
      });
      const link = document.createElement('a');
      const slug = `${selectedVehicle.brand}-${selectedVehicle.model}-${selectedVehicle.id}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
      link.download =
        format === 'carrossel'
          ? `${slug}-carrossel-0${idx + 1}.png`
          : `${slug}-${format}.png`;
      link.href = dataUrl;
      link.click();
      setNotice('Arte PNG exportada em alta resolução diretamente do modelo local.');
      window.setTimeout(() => setNotice(null), 3000);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Erro ao exportar arte PNG.'
      );
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedVehicle || !deterministicOutput || !canCreate) return;
    setSavingDraft(true);
    setErrorMsg(null);
    try {
      const payload = {
        vehicleId: Number(selectedVehicle.id),
        format,
        title: customTitle.trim() || deterministicOutput.title,
        caption: captionText.trim() || deterministicOutput.caption,
        selectedPhotoUrl: selectedPhotoUrl || selectedVehicle.imageUrl,
        selectedPhotos: vehiclePhotos,
        templateConfig: {
          activeSlideIndex,
        },
        publicSheetUrl: deterministicOutput.publicSheetUrl,
        trackingSource: deterministicOutput.trackingSource,
      };

      const url = editingDraftId
        ? `/api/admin/marketing/drafts/${editingDraftId}`
        : '/api/admin/marketing/drafts';
      const method = editingDraftId ? 'PATCH' : 'POST';

      const res = await adminFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || 'Falha ao salvar rascunho de divulgação.');
      }

      const saved = (await res.json()) as { draft: MarketingDraftRecord };
      setEditingDraftId(saved.draft.id);
      setNotice('Rascunho salvo com referência de preço, status e link rastreado.');
      window.setTimeout(() => setNotice(null), 3500);
      await loadDrafts();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Erro ao salvar rascunho.'
      );
    } finally {
      setSavingDraft(false);
    }
  };

  const handleDeleteDraft = async (draftId: number) => {
    try {
      const res = await adminFetch(`/api/admin/marketing/drafts/${draftId}`, {
        method: 'DELETE',
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (editingDraftId === draftId) {
        setEditingDraftId(null);
      }
      await loadDrafts();
    } catch {
      setErrorMsg('Erro ao excluir rascunho.');
    }
  };

  const handleLoadDraft = (draft: MarketingDraftRecord) => {
    setEditingDraftId(draft.id);
    setSelectedVehicleId(String(draft.vehicleId));
    setFormat(draft.format);
    setCustomTitle(draft.title);
    setCaptionText(draft.caption);
    if (draft.selectedPhotoUrl) {
      setSelectedPhotoUrl(draft.selectedPhotoUrl);
    }
    setActiveSlideIndex(0);
    setErrorMsg(null);
  };

  const handleSyncDraftWithLiveStock = () => {
    if (!deterministicOutput) return;
    setCustomTitle(deterministicOutput.title);
    setCaptionText(
      format === 'classificado'
        ? deterministicOutput.classifiedText
        : deterministicOutput.caption
    );
    setNotice('Texto e preço sincronizados com o estoque atual.');
    window.setTimeout(() => setNotice(null), 2500);
  };

  const handleOptionalAiPolish = async () => {
    if (!selectedVehicle || !captionText.trim() || !canCreate) return;
    setPolishingAi(true);
    setErrorMsg(null);
    try {
      const res = await adminFetch('/api/admin/marketing/polish-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: Number(selectedVehicle.id),
          format,
          baseCaption: captionText,
        }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        caption?: string;
        error?: string;
      };
      if (!res.ok || !data.caption) {
        throw new Error(
          data.error ||
            'Assistente de redação indisponível agora. Você pode continuar usando o texto padrão.'
        );
      }
      setCaptionText(data.caption);
      setNotice('Variação de texto aplicada preservando os dados reais do anúncio.');
      window.setTimeout(() => setNotice(null), 3500);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Erro ao ajustar legenda.'
      );
    } finally {
      setPolishingAi(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Vehicle + Format Selector Header */}
      <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-white">
              Estúdio de Divulgação do Estoque
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Peças visuais, textos para classificados e link rastreado para a ficha pública preenchidos automaticamente com os dados oficiais do estoque.
            </p>
          </div>

          {selectedVehicle && (
            <button
              type="button"
              onClick={() => onOpenVehicleSheet(selectedVehicle.id)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] self-start md:self-auto"
            >
              <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
              <span>Abrir ficha pública</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5">
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Veículo do estoque
            </label>
            <select
              value={selectedVehicleId}
              onChange={(e) => {
                setEditingDraftId(null);
                setSelectedVehicleId(e.target.value);
              }}
              className="w-full px-3.5 py-2.5 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
            >
              {availableFirst.map((v) => (
                <option key={v.id} value={v.id} className="bg-zinc-950">
                  #{v.id} · {v.brand} {v.model} {v.year} · {formatBRL(v.price)} ({v.status})
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-7">
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Formato da peça
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {FORMAT_META.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setEditingDraftId(null);
                    setFormat(item.id);
                  }}
                  className={`px-3 py-2 rounded-lg border text-left transition-colors ${
                    format === item.id
                      ? 'bg-red-600/15 border-red-600/50 text-white'
                      : 'bg-[#09090B] border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:border-white/[0.16]'
                  }`}
                >
                  <p className="text-xs font-semibold truncate">{item.label}</p>
                  <p className="text-[10px] text-zinc-500 truncate mt-0.5">
                    {item.aspectHint}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Live Price / Status / Data Quality Alerts */}
      {liveValidation && liveValidation.warnings.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/35 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              {liveValidation.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          </div>
          {liveValidation.priceChanged && (
            <button
              type="button"
              onClick={handleSyncDraftWithLiveStock}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-zinc-950 hover:bg-amber-400 shrink-0 self-start sm:self-auto"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Atualizar com preço atual</span>
            </button>
          )}
        </div>
      )}

      {deterministicOutput && deterministicOutput.dataWarnings.length > 0 && (
        <div className="p-3.5 rounded-xl bg-[#111114] border border-white/[0.1] text-xs text-zinc-300 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-zinc-200">Avisos de conferência cadastral:</p>
            {deterministicOutput.dataWarnings.map((w, i) => (
              <p key={i} className="text-zinc-400">
                • {w}
              </p>
            ))}
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-red-950/50 border border-red-600/40 text-xs text-red-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {notice && (
        <div className="p-3.5 rounded-xl bg-emerald-950/50 border border-emerald-500/35 text-xs text-emerald-200 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Main Studio Grid */}
      {selectedVehicle && deterministicOutput && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left: Visual Preview / Classified Preview */}
          <div className="xl:col-span-5 bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">
                {format === 'classificado'
                  ? 'Prévia do Anúncio para Classificados'
                  : 'Prévia da Arte (PNG)'}
              </h3>
              {format === 'carrossel' && (
                <div className="flex items-center gap-1">
                  {[0, 1, 2, 3].map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveSlideIndex(idx)}
                      className={`px-2 py-1 rounded text-[11px] font-mono ${
                        activeSlideIndex === idx
                          ? 'bg-red-600 text-white'
                          : 'bg-[#09090B] text-zinc-400 border border-white/[0.08]'
                      }`}
                    >
                      0{idx + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {format !== 'classificado' ? (
              <div className="space-y-3">
                <div
                  className={`w-full rounded-lg overflow-hidden border border-white/[0.08] bg-[#09090B] flex items-center justify-center ${
                    format === 'stories' ? 'aspect-[9/16] max-h-[520px] mx-auto' : 'aspect-[4/5]'
                  }`}
                >
                  {renderingPng && !previewPngUrl ? (
                    <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
                  ) : previewPngUrl ? (
                    <img
                      src={previewPngUrl}
                      alt={`Prévia ${format} de ${selectedVehicle.brand} ${selectedVehicle.model}`}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="text-xs text-zinc-500 p-6 text-center">
                      Prévia indisponível neste navegador.
                    </div>
                  )}
                </div>

                {/* Photo picker if multiple photos */}
                {vehiclePhotos.length > 1 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>Selecionar foto principal</span>
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {vehiclePhotos.slice(0, 8).map((url, idx) => (
                        <button
                          key={`${url}-${idx}`}
                          type="button"
                          onClick={() => setSelectedPhotoUrl(url)}
                          className={`aspect-[4/3] rounded-md overflow-hidden border-2 ${
                            selectedPhotoUrl === url
                              ? 'border-red-500'
                              : 'border-white/[0.08] opacity-70 hover:opacity-100'
                          }`}
                        >
                          <VehicleImage src={url} alt={`Foto ${idx + 1}`} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!liveValidation?.canExportActiveOffer}
                    onClick={() => void handleDownloadArtwork()}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      {format === 'carrossel'
                        ? `Baixar Slide 0${activeSlideIndex + 1} (PNG)`
                        : 'Baixar Arte PNG'}
                    </span>
                  </button>
                  {format === 'carrossel' && (
                    <button
                      type="button"
                      disabled={!liveValidation?.canExportActiveOffer}
                      onClick={() => {
                        void (async () => {
                          for (let i = 0; i < 4; i++) {
                            await handleDownloadArtwork(i);
                          }
                        })();
                      }}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] disabled:opacity-40"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Baixar 4 slides</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <pre className="p-4 rounded-lg bg-[#09090B] border border-white/[0.08] text-xs text-zinc-200 whitespace-pre-wrap font-sans leading-relaxed max-h-[460px] overflow-y-auto">
                  {captionText}
                </pre>
                <button
                  type="button"
                  disabled={!liveValidation?.canExportActiveOffer}
                  onClick={() => void handleCopy('classified', captionText)}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-40"
                >
                  {copiedKey === 'classified' ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  <span>
                    {copiedKey === 'classified'
                      ? 'Anúncio copiado!'
                      : 'Copiar texto completo do classificado'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Right: Copy Editor, Tracked Link & Saved Drafts */}
          <div className="xl:col-span-7 space-y-5">
            <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">
                  Texto da Peça & Link Rastreado
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSyncDraftWithLiveStock}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-zinc-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08]"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Regerar padrão</span>
                  </button>
                  {canCreate && (
                    <button
                      type="button"
                      disabled={polishingAi}
                      onClick={() => void handleOptionalAiPolish()}
                      title="Opcional: reescrever legenda mantendo os dados reais"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] disabled:opacity-50"
                    >
                      {polishingAi ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5 text-red-400" />
                      )}
                      <span>Ajustar redação (opcional)</span>
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Título / Chamada na arte
                </label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  {format === 'classificado' ? 'Texto do classificado' : 'Legenda / Mensagem pronta'}
                </label>
                <textarea
                  rows={8}
                  value={captionText}
                  onChange={(e) => setCaptionText(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-xs text-zinc-100 leading-relaxed focus:outline-none"
                />
              </div>

              {/* Tracked Link Box */}
              <div className="p-3.5 rounded-lg bg-[#09090B] border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-zinc-400">
                    Link rastreado para a ficha pública ({deterministicOutput.trackingSource})
                  </p>
                  <p className="text-xs font-mono text-emerald-400 truncate mt-0.5">
                    {deterministicOutput.publicSheetUrl}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void handleCopy('link', deterministicOutput.publicSheetUrl)
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] shrink-0 self-start sm:self-auto"
                >
                  {copiedKey === 'link' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedKey === 'link' ? 'Copiado' : 'Copiar link'}</span>
                </button>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => void handleCopy('caption', captionText)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08]"
                >
                  {copiedKey === 'caption' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {copiedKey === 'caption' ? 'Legenda copiada' : 'Copiar legenda'}
                  </span>
                </button>

                {canCreate && (
                  <button
                    type="button"
                    disabled={savingDraft}
                    onClick={() => void handleSaveDraft()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {savingDraft ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {editingDraftId ? 'Atualizar rascunho' : 'Salvar rascunho'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Saved Drafts List with Live Revalidation */}
            <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-zinc-400" />
                  <h3 className="text-sm font-semibold text-white">
                    Rascunhos Salvos da Equipe
                  </h3>
                </div>
                <span className="text-xs font-mono text-zinc-500 tabular-nums">
                  {drafts.length}
                </span>
              </div>

              {loadingDrafts ? (
                <div className="py-6 flex justify-center">
                  <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                </div>
              ) : drafts.length === 0 ? (
                <p className="text-xs text-zinc-500 py-4 text-center">
                  Nenhum rascunho salvo ainda. Selecione um veículo acima e clique em &quot;Salvar rascunho&quot;.
                </p>
              ) : (
                <div className="divide-y divide-white/[0.06]">
                  {drafts.map((draft) => {
                    const liveVeh = vehicles.find(
                      (v) => Number(v.id) === Number(draft.vehicleId)
                    );
                    const check = revalidateMarketingDraft(
                      draft.snapshotPrice,
                      draft.snapshotStatus,
                      liveVeh
                    );
                    return (
                      <div
                        key={draft.id}
                        className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-semibold text-white truncate">
                              {draft.title}
                            </p>
                            <span className="text-[10px] font-mono uppercase text-zinc-400">
                              {draft.format}
                            </span>
                            {check.isUnavailable && (
                              <span className="text-[10px] font-medium text-red-400">
                                Bloqueado ({check.currentStatus})
                              </span>
                            )}
                            {!check.isUnavailable && check.priceChanged && (
                              <span className="text-[10px] font-medium text-amber-400">
                                Preço alterado ({formatBRL(check.currentPrice)})
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-zinc-500 mt-0.5 tabular-nums">
                            Ref. #{draft.vehicleId} · Salvo a {formatBRL(draft.snapshotPrice)}
                            {liveVeh ? ` · ${formatKm(liveVeh.km)}` : ''} · por{' '}
                            {draft.updatedByName || draft.createdByName || 'Equipe'}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleLoadDraft(draft)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08]"
                          >
                            Abrir
                          </button>
                          {canCreate && (
                            <button
                              type="button"
                              onClick={() => void handleDeleteDraft(draft.id)}
                              aria-label="Excluir rascunho"
                              className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-600/10"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
