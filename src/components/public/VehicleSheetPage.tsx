import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Car,
  Check,
  CheckCircle2,
  Copy,
  Fuel,
  Gauge,
  MessageCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { DealershipSettings, FipeLookupResult, Vehicle } from '../../types';
import { ApiVehicleRow, mapDbVehicleToFrontend } from '../../db/mappers';
import { VehicleImage } from '../VehicleImage';
import {
  analyzeVehicleDataQuality,
  buildVehicleSheetUrl,
  computeFipeMetrics,
  formatBrlCurrency,
  formatKmBr,
  getVehicleDisplayTitle,
  isVehicleAvailable,
} from '../../utils/vehicleDomain';
import { WhatsAppHandoffModal } from './WhatsAppHandoffModal';
import { HandoffPurpose } from '../../utils/whatsappHandoff';

interface VehicleSheetPageProps {
  vehicleId: string;
  initialVehicle?: Vehicle | null;
  settings: DealershipSettings;
  storeWhatsappNumber?: string;
  onBackToCatalog: () => void;
  onOpenChatWithVehicle: (vehicle: Vehicle) => void;
}

export const VehicleSheetPage: React.FC<VehicleSheetPageProps> = ({
  vehicleId,
  initialVehicle = null,
  settings,
  storeWhatsappNumber,
  onBackToCatalog,
  onOpenChatWithVehicle,
}) => {
  const [vehicle, setVehicle] = useState<Vehicle | null>(initialVehicle);
  const [loading, setLoading] = useState(!initialVehicle);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [activePhoto, setActivePhoto] = useState(0);
  const [copiedLink, setCopiedLink] = useState(false);
  const [liveFipe, setLiveFipe] = useState<FipeLookupResult | null>(null);
  const [loadingFipe, setLoadingFipe] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffPurpose, setHandoffPurpose] = useState<HandoffPurpose>('sales');

  const loadVehicle = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/public/vehicles/${encodeURIComponent(vehicleId)}`);
      if (res.status === 404) {
        setNotFound(true);
        setVehicle(null);
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Não foi possível carregar a ficha do veículo.');
      }
      const row = (await res.json()) as ApiVehicleRow;
      setVehicle(mapDbVehicleToFrontend(row));
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro de conexão ao buscar a ficha do veículo.'
      );
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    void loadVehicle();
  }, [loadVehicle]);

  // Optionally consult official BrasilAPI FIPE when vehicle has a registered fipeCode
  useEffect(() => {
    setLiveFipe(null);
    if (!vehicle?.fipeCode) return;
    let cancelled = false;
    setLoadingFipe(true);
    const yearDigits = vehicle.year.split('/').pop();
    const qs = yearDigits ? `?ano=${encodeURIComponent(yearDigits)}` : '';
    fetch(`/api/fipe/${encodeURIComponent(vehicle.fipeCode)}${qs}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: FipeLookupResult | null) => {
        if (!cancelled && data?.recommended) {
          setLiveFipe(data);
        }
      })
      .catch(() => {
        // Keep persisted FIPE data only
      })
      .finally(() => {
        if (!cancelled) setLoadingFipe(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vehicle?.id, vehicle?.fipeCode, vehicle?.year]);

  const handleCopyShareLink = async () => {
    if (!vehicle) return;
    const url = buildVehicleSheetUrl(
      vehicle.id,
      typeof window !== 'undefined' ? window.location.origin : ''
    );
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      // Ignore clipboard failures
    }
  };

  if (loading && !vehicle) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] text-zinc-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6 animate-pulse">
          <div className="h-9 w-40 bg-zinc-800 rounded-lg" />
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 aspect-[16/10] bg-zinc-900 rounded-2xl border border-zinc-800" />
            <div className="lg:col-span-5 space-y-4">
              <div className="h-8 w-3/4 bg-zinc-800 rounded" />
              <div className="h-10 w-1/2 bg-zinc-800 rounded" />
              <div className="h-32 bg-zinc-900 rounded-xl border border-zinc-800" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] text-zinc-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-center space-y-4">
          <Car className="w-10 h-10 text-zinc-500 mx-auto" />
          <h1 className="text-xl font-semibold text-white">Veículo não encontrado</h1>
          <p className="text-sm text-zinc-400">
            Este anúncio pode ter sido removido ou o endereço informado não corresponde a um veículo do estoque.
          </p>
          <button
            type="button"
            onClick={onBackToCatalog}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] rounded-xl bg-white text-zinc-950 text-sm font-semibold hover:bg-zinc-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar ao estoque disponível</span>
          </button>
        </div>
      </div>
    );
  }

  if (error && !vehicle) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] text-zinc-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-red-900/60 bg-zinc-950 p-6 text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto" />
          <h1 className="text-lg font-semibold text-white">Falha ao carregar ficha</h1>
          <p className="text-sm text-zinc-400">{error}</p>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center">
            <button
              type="button"
              onClick={() => void loadVehicle()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Tentar novamente</span>
            </button>
            <button
              type="button"
              onClick={onBackToCatalog}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl border border-zinc-700 text-zinc-200 text-sm font-medium hover:bg-zinc-900"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar ao catálogo</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!vehicle) return null;

  const title = getVehicleDisplayTitle(vehicle);
  const available = isVehicleAvailable(vehicle);
  const quality = analyzeVehicleDataQuality(vehicle);

  // Merge live BrasilAPI FIPE if fetched for this vehicle's fipeCode; otherwise strictly persisted DB values
  const effectiveVehicleForFipe: Vehicle = liveFipe?.recommended
    ? {
        ...vehicle,
        fipePrice: liveFipe.recommended.valorNumerico || vehicle.fipePrice,
        fipeReferenceMonth:
          liveFipe.recommended.mesReferencia || vehicle.fipeReferenceMonth,
      }
    : vehicle;
  const fipe = computeFipeMetrics(effectiveVehicleForFipe);

  const photos =
    vehicle.gallery && vehicle.gallery.length > 0
      ? vehicle.gallery
      : vehicle.imageUrl
        ? [vehicle.imageUrl]
        : [''];

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-zinc-100 pb-16">
      {/* Sticky top bar */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-[#0A0A0B]/95 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBackToCatalog}
            className="inline-flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-lg text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar ao estoque</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyShareLink}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg border border-zinc-800 bg-zinc-900/90 hover:bg-zinc-800 text-xs sm:text-sm font-medium text-zinc-200 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {copiedLink ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Link copiado</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Compartilhar ficha</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 space-y-6">
        {/* Unavailable banner */}
        {!available && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-100">
                  Este veículo está atualmente {vehicle.status.toLowerCase()}.
                </p>
                <p className="text-xs text-amber-200/80 mt-0.5">
                  A ficha permanece acessível para consulta, mas esta unidade não está disponível para venda imediata.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onBackToCatalog}
              className="px-4 py-2.5 min-h-[44px] rounded-lg bg-amber-400 text-zinc-950 text-xs font-semibold hover:bg-amber-300 shrink-0"
            >
              Ver veículos disponíveis
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
          {/* Left: Gallery */}
          <div className="lg:col-span-7 space-y-3">
            <div className="relative aspect-[16/10] rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950">
              <VehicleImage
                src={photos[activePhoto] || vehicle.imageUrl}
                alt={`${title} ${vehicle.year}`}
                className="w-full h-full object-cover"
              />
            </div>

            {photos.length > 1 && (
              <div className="grid grid-cols-4 gap-2">
                {photos.map((photo, idx) => (
                  <button
                    key={`${photo}-${idx}`}
                    type="button"
                    onClick={() => setActivePhoto(idx)}
                    aria-label={`Ver foto ${idx + 1}`}
                    className={`aspect-[16/10] rounded-lg overflow-hidden border-2 transition-colors ${
                      activePhoto === idx
                        ? 'border-red-500'
                        : 'border-zinc-800 opacity-70 hover:opacity-100'
                    }`}
                  >
                    <VehicleImage
                      src={photo}
                      alt={`${title} foto ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}

            {/* Optionals */}
            <section className="rounded-2xl border border-zinc-800/90 bg-zinc-950 p-5">
              <h2 className="text-sm font-semibold text-white mb-3">
                Itens e equipamentos cadastrados
              </h2>
              {vehicle.optionals.length > 0 ? (
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {vehicle.optionals.map((opt) => (
                    <li
                      key={opt}
                      className="text-xs sm:text-sm text-zinc-300 flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span>{opt}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-400">
                  Lista detalhada de opcionais disponível para confirmação com a loja.
                </p>
              )}
            </section>
          </div>

          {/* Right: Price, FIPE, Specs, CTAs */}
          <div className="lg:col-span-5 space-y-5">
            <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950 p-5 sm:p-6 space-y-4">
              <div>
                <p className="text-xs font-medium text-zinc-400">
                  {settings.tradeName} · Ref. #{vehicle.id} · {vehicle.status}
                </p>
                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mt-1">
                  {title}
                </h1>
                {vehicle.version && (
                  <p className="text-sm text-zinc-400 mt-1">{vehicle.version}</p>
                )}
              </div>

              <div className="pt-2 border-t border-zinc-800">
                <p className="text-xs text-zinc-400">Preço à vista</p>
                <p className="text-3xl sm:text-4xl font-bold text-white tabular-nums mt-0.5">
                  {formatBrlCurrency(vehicle.price)}
                </p>
              </div>

              {/* Truthful FIPE block */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-200">
                    Referência Tabela FIPE
                  </span>
                  {loadingFipe && (
                    <span className="text-[11px] text-zinc-400">Consultando...</span>
                  )}
                </div>

                {fipe.hasFipeValue && fipe.fipePrice ? (
                  <>
                    <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
                      <span className="text-zinc-400">Valor FIPE:</span>
                      <span className="font-semibold text-white">
                        {formatBrlCurrency(fipe.fipePrice)}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                      <span className="text-zinc-400">Referência:</span>
                      <span
                        className={
                          fipe.hasReferenceMonth
                            ? 'text-zinc-200'
                            : 'text-amber-300 font-medium'
                        }
                      >
                        {fipe.fipeReferenceMonth || 'Mês de referência não informado'}
                      </span>
                    </div>
                    {fipe.diffBrl !== null && fipe.diffPct !== null && (
                      <p
                        className={`text-xs pt-1 tabular-nums ${
                          fipe.isConfirmedBelowFipeOffer
                            ? 'text-emerald-400 font-medium'
                            : 'text-zinc-400'
                        }`}
                      >
                        {fipe.diffBrl > 0
                          ? fipe.hasReferenceMonth
                            ? `${formatBrlCurrency(fipe.diffBrl)} (${fipe.diffPct}%) abaixo da FIPE`
                            : `Diferença de ${formatBrlCurrency(fipe.diffBrl)} (${fipe.diffPct}%) — confirme o mês de referência com a loja antes de considerar oferta abaixo da FIPE.`
                          : fipe.diffBrl < 0
                            ? `${formatBrlCurrency(Math.abs(fipe.diffBrl))} (${Math.abs(fipe.diffPct)}%) acima da FIPE`
                            : 'No mesmo valor da Tabela FIPE'}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-zinc-400">
                    Valor FIPE não cadastrado para este veículo. Solicite a conferência exata da versão ao consultor.
                  </p>
                )}
              </div>

              {/* Technical Specs */}
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3">
                  <span className="text-zinc-400 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    Ano
                  </span>
                  <span className="block text-sm font-semibold text-white tabular-nums mt-1">
                    {vehicle.year}
                  </span>
                </div>
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3">
                  <span className="text-zinc-400 flex items-center gap-1.5">
                    <Gauge className="w-3.5 h-3.5" />
                    Quilometragem
                  </span>
                  <span className="block text-sm font-semibold text-white tabular-nums mt-1">
                    {formatKmBr(vehicle.km)}
                  </span>
                </div>
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3">
                  <span className="text-zinc-400 flex items-center gap-1.5">
                    <Settings2 className="w-3.5 h-3.5" />
                    Câmbio
                  </span>
                  <span
                    className={`block text-sm font-semibold mt-1 ${
                      quality.hasTransmissionConflict
                        ? 'text-amber-300'
                        : 'text-white'
                    }`}
                  >
                    {quality.displayTransmission}
                  </span>
                </div>
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3">
                  <span className="text-zinc-400 flex items-center gap-1.5">
                    <Fuel className="w-3.5 h-3.5" />
                    Combustível
                  </span>
                  <span className="block text-sm font-semibold text-white mt-1">
                    {vehicle.fuel || 'Não informado'}
                  </span>
                </div>
              </div>

              {quality.hasTransmissionConflict && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Identificamos uma divergência cadastral sobre o câmbio deste veículo ({quality.conflictDetail}). Confirme presencialmente ou com o consultor antes de fechar negócio.
                  </span>
                </div>
              )}

              {/* Primary CTAs */}
              <div className="space-y-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setHandoffPurpose('sales');
                    setHandoffOpen(true);
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>Falar com consultor</span>
                </button>

                {available && (
                  <button
                    type="button"
                    onClick={() => onOpenChatWithVehicle(vehicle)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[46px] rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-100 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500"
                  >
                    <Sparkles className="w-4 h-4 text-red-400" />
                    <span>Simular ou tirar dúvidas no chat</span>
                  </button>
                )}
              </div>

              {/* Dealership trust & hours */}
              <div className="pt-3 border-t border-zinc-800 text-xs text-zinc-400 space-y-1.5">
                <p className="flex items-center gap-1.5 text-zinc-300">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>
                    Garantia legal de {settings.warrantyDays} dias · {settings.tradeName}
                  </span>
                </p>
                <p>
                  {settings.address}, {settings.city}/{settings.state}
                </p>
                <p>
                  {settings.hoursWeekdays} · {settings.hoursSaturday}
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <WhatsAppHandoffModal
        isOpen={handoffOpen}
        onClose={() => setHandoffOpen(false)}
        settings={settings}
        fallbackWhatsapp={storeWhatsappNumber}
        purpose={handoffPurpose}
        vehicleLabel={`${title} ${vehicle.year} (Ref. #${vehicle.id})`}
        contextSummary={`Tenho interesse no ${title} ${vehicle.year} (${formatBrlCurrency(vehicle.price)})`}
      />
    </div>
  );
};
