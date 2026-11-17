import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  Bookmark,
  Calculator,
  Check,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  PlusCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { DealershipSettings, RadarOpportunity, Vehicle } from '../../types';
import { formatBRL, formatKm } from '../../utils/formatters';
import { VehicleImage } from '../VehicleImage';

interface RadarModuleProps {
  opportunities: RadarOpportunity[];
  settings: DealershipSettings;
  onToggleSave: (id: string) => void;
  onImportToInventory: (opportunity: RadarOpportunity, vehicle: Vehicle) => void;
  onRefreshRadar?: () => Promise<void>;
  onAddOpportunity?: (payload: {
    platform: 'OLX' | 'Webmotors' | 'Marketplace';
    title: string;
    price: number;
    fipe_price: number;
    link: string;
  }) => Promise<void>;
}

const DEFAULT_BRANDS = ['BMW', 'Porsche', 'Jeep', 'Honda', 'Toyota', 'Volkswagen'];

export const RadarModule: React.FC<RadarModuleProps> = ({
  opportunities,
  settings,
  onToggleSave,
  onImportToInventory,
  onRefreshRadar,
  onAddOpportunity,
}) => {
  const [radiusKm, setRadiusKm] = useState<number>(settings.radarDefaultRadiusKm);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [minDiscountPct, setMinDiscountPct] = useState<number>(
    Math.min(settings.minResaleMarginPct, 10)
  );
  const [sourceFilter, setSourceFilter] = useState<
    'Todas' | 'OLX' | 'Webmotors' | 'Marketplace'
  >('Todas');
  const [onlySaved, setOnlySaved] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [analyzerTarget, setAnalyzerTarget] = useState<RadarOpportunity | null>(
    null
  );
  const [prepCost, setPrepCost] = useState(3500);
  const [targetResaleDiscountFipe, setTargetResaleDiscountFipe] = useState(3);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSubmittingNew, setIsSubmittingNew] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [newOppForm, setNewOppForm] = useState({
    platform: 'OLX' as 'OLX' | 'Webmotors' | 'Marketplace',
    title: '',
    price: '',
    fipe_price: '',
    link: 'https://www.olx.com.br',
  });

  useEffect(() => {
    if (onRefreshRadar) {
      setIsScanning(true);
      onRefreshRadar()
        .catch(() => {})
        .finally(() => setIsScanning(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availableBrands = useMemo(() => {
    const set = new Set<string>(DEFAULT_BRANDS);
    opportunities.forEach((o) => {
      if (o.brand) set.add(o.brand);
    });
    return Array.from(set);
  }, [opportunities]);

  const toggleBrand = (brand: string) => {
    setSelectedBrands((prev) =>
      prev.includes(brand) ? prev.filter((b) => b !== brand) : [...prev, brand]
    );
  };

  const handleRefreshScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setScanError(null);
    try {
      if (onRefreshRadar) {
        await onRefreshRadar();
      }
    } catch (err: unknown) {
      setScanError(
        err instanceof Error
          ? err.message
          : 'Erro ao consultar oportunidades no banco Neon.'
      );
    } finally {
      setIsScanning(false);
    }
  };

  const filtered = opportunities.filter((item) => {
    const discountPct =
      item.fipePrice > 0
        ? ((item.fipePrice - item.askingPrice) / item.fipePrice) * 100
        : item.discountPercent || 0;
    const matchesRadius = item.distanceKm <= radiusKm;
    const matchesBrand =
      selectedBrands.length === 0 || selectedBrands.includes(item.brand);
    const matchesMargin = discountPct >= minDiscountPct;
    const matchesSource =
      sourceFilter === 'Todas' || item.source === sourceFilter;
    const matchesSaved = !onlySaved || item.saved;

    return (
      matchesRadius &&
      matchesBrand &&
      matchesMargin &&
      matchesSource &&
      matchesSaved
    );
  });

  const handleImport = (opp: RadarOpportunity) => {
    const suggestedSalePrice = Math.round(opp.fipePrice * 0.96);
    const newVehicle: Vehicle = {
      id: `veh-rad-${Date.now()}`,
      brand: opp.brand,
      model: opp.model || opp.title,
      version: `Captação ${opp.source}`,
      year: opp.year,
      km: opp.km,
      price: suggestedSalePrice,
      fipePrice: opp.fipePrice,
      color: 'A confirmar',
      transmission: 'Automático',
      fuel: 'Flex',
      plate: 'CAP0A00',
      renavam: '',
      chassis: '',
      status: 'Disponível',
      imageUrl: opp.imageUrl,
      optionals: [opp.highlights],
      createdAt: new Date().toISOString().slice(0, 10),
    };
    onImportToInventory(opp, newVehicle);
  };

  const handleCreateOpportunity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddOpportunity || isSubmittingNew) return;
    setAddError(null);

    const priceNum = Number(newOppForm.price);
    const fipeNum = Number(newOppForm.fipe_price);
    if (!newOppForm.title.trim() || !Number.isFinite(priceNum) || !Number.isFinite(fipeNum) || priceNum <= 0 || fipeNum <= 0) {
      setAddError('Informe título, preço anunciado e valor FIPE válidos.');
      return;
    }

    setIsSubmittingNew(true);
    try {
      await onAddOpportunity({
        platform: newOppForm.platform,
        title: newOppForm.title.trim(),
        price: priceNum,
        fipe_price: fipeNum,
        link: newOppForm.link.trim() || 'https://www.olx.com.br',
      });
      setIsAddModalOpen(false);
      setNewOppForm({
        platform: 'OLX',
        title: '',
        price: '',
        fipe_price: '',
        link: 'https://www.olx.com.br',
      });
    } catch (err: unknown) {
      setAddError(
        err instanceof Error
          ? err.message
          : 'Erro ao cadastrar oportunidade no banco Neon.'
      );
    } finally {
      setIsSubmittingNew(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Search Configuration Panel */}
      <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-white">
              Parâmetros do Radar Regional
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Base: {settings.city} - {settings.state} · Anúncios monitorados abaixo da
              Tabela FIPE ({filtered.length} encontrados)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setOnlySaved((p) => !p)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                onlySaved
                  ? 'bg-red-600/15 border-red-600/40 text-white'
                  : 'bg-[#09090B] border-white/[0.08] text-zinc-300 hover:text-white'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Salvos</span>
            </button>

            {onAddOpportunity && (
              <button
                type="button"
                onClick={() => {
                  setAddError(null);
                  setIsAddModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-[#09090B] hover:bg-white/[0.06] border border-white/[0.1] transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5 text-red-500" />
                <span>Monitorar Anúncio</span>
              </button>
            )}

            <button
              type="button"
              disabled={isScanning}
              onClick={() => void handleRefreshScan()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`}
              />
              <span>{isScanning ? 'Consultando Radar...' : 'Atualizar Varredura'}</span>
            </button>
          </div>
        </div>

        {scanError && (
          <div className="px-3.5 py-2.5 rounded-lg bg-red-950/50 border border-red-600/40 text-xs text-red-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{scanError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-white/[0.06]">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Raio de Busca ({radiusKm} km)
            </label>
            <div className="flex items-center gap-1.5">
              {[25, 50, 100, 250].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRadiusKm(r)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                    radiusKm === r
                      ? 'bg-zinc-800 border-white/20 text-white'
                      : 'bg-[#09090B] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {r}km
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Desconto Mínimo sobre FIPE
            </label>
            <div className="flex items-center gap-1.5">
              {[5, 10, 12, 15].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setMinDiscountPct(pct)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                    minDiscountPct === pct
                      ? 'bg-zinc-800 border-white/20 text-white'
                      : 'bg-[#09090B] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  -{pct}%
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Portal de Origem
            </label>
            <select
              value={sourceFilter}
              onChange={(e) =>
                setSourceFilter(
                  e.target.value as 'Todas' | 'OLX' | 'Webmotors' | 'Marketplace'
                )
              }
              className="w-full px-3 py-1.5 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none focus:border-red-600"
            >
              <option value="Todas">Todos os Portais (OLX, Webmotors, Marketplace)</option>
              <option value="OLX">OLX Autos</option>
              <option value="Webmotors">Webmotors</option>
              <option value="Marketplace">Facebook Marketplace</option>
            </select>
          </div>
        </div>

        {/* Brand Filters */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-zinc-500 mr-1">Marcas monitoradas:</span>
          <button
            type="button"
            onClick={() => setSelectedBrands([])}
            className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
              selectedBrands.length === 0
                ? 'bg-zinc-800 border-white/20 text-white'
                : 'bg-[#09090B] border-white/[0.08] text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Todas
          </button>
          {availableBrands.map((brand) => {
            const active = selectedBrands.includes(brand);
            return (
              <button
                key={brand}
                type="button"
                onClick={() => toggleBrand(brand)}
                className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-red-600/15 border-red-600/40 text-white'
                    : 'bg-[#09090B] border-white/[0.08] text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {brand}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results List */}
      {filtered.length === 0 ? (
        <div className="bg-[#111114] border border-white/[0.08] rounded-xl py-16 px-6 text-center">
          <p className="text-sm font-medium text-zinc-200">
            Nenhuma oportunidade encontrada com estes critérios.
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            Amplie o raio de busca, limpe os filtros de marca ou reduza o percentual mínimo abaixo da FIPE.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((item) => {
            const marginBRL = item.fipePrice - item.askingPrice;
            const marginPct =
              item.fipePrice > 0
                ? ((marginBRL / item.fipePrice) * 100).toFixed(1)
                : (item.discountPercent || 0).toFixed(1);

            return (
              <div
                key={item.id}
                className="bg-[#111114] border border-white/[0.08] hover:border-white/[0.16] rounded-xl p-4 flex flex-col sm:flex-row gap-4 transition-colors"
              >
                <div className="w-full sm:w-44 aspect-[4/3] sm:aspect-auto sm:h-auto rounded-lg overflow-hidden shrink-0 bg-zinc-950 border border-white/[0.06]">
                  <VehicleImage src={item.imageUrl} alt={item.title} />
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-white leading-snug">
                        {item.title}
                      </p>
                      <button
                        type="button"
                        onClick={() => onToggleSave(item.id)}
                        title={item.saved ? 'Remover dos salvos' : 'Salvar oportunidade'}
                        className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                          item.saved
                            ? 'text-red-500 bg-red-600/10'
                            : 'text-zinc-500 hover:text-zinc-200'
                        }`}
                      >
                        <Bookmark className="w-4 h-4" />
                      </button>
                    </div>

                    <p className="text-xs text-zinc-400 mt-1">
                      {item.year} · {formatKm(item.km)} · {item.source} ({item.sellerType})
                    </p>

                    <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-zinc-500 shrink-0" />
                      <span>
                        {item.city} ({item.distanceKm} km) · {item.postedAgo}
                      </span>
                    </p>

                    <p className="text-xs text-zinc-300 mt-2 leading-relaxed">
                      {item.highlights}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/[0.06] space-y-3">
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-base font-semibold text-white tabular-nums">
                          {formatBRL(item.askingPrice)}
                        </span>
                        <span className="text-xs font-mono text-zinc-500 line-through tabular-nums">
                          FIPE {formatBRL(item.fipePrice)}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-emerald-400 flex items-center gap-1 mt-0.5 tabular-nums">
                        <ArrowDownRight className="w-3.5 h-3.5" />
                        <span>
                          -{marginPct}% abaixo da FIPE ({formatBRL(marginBRL)} de desconto)
                        </span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={item.link || 'https://www.olx.com.br'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-200 bg-[#09090B] hover:bg-white/[0.08] border border-white/[0.1] transition-colors whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-red-400" />
                        <span>Ver Anúncio</span>
                      </a>

                      <button
                        type="button"
                        onClick={() => setAnalyzerTarget(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] whitespace-nowrap"
                      >
                        <Calculator className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Analisar</span>
                      </button>

                      {item.imported ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-400">
                          <Check className="w-3.5 h-3.5" />
                          <span>No Estoque</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleImport(item)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 whitespace-nowrap"
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                          <span>Importar</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Margin & Reconditioning Analyzer Modal */}
      {analyzerTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#111114] border border-white/[0.1] rounded-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
              <div className="min-w-0 pr-3">
                <h2 className="font-display text-base font-semibold text-white">
                  Simulador de Margem de Repasse
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5 truncate">
                  {analyzerTarget.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAnalyzerTarget(null)}
                className="p-2 text-zinc-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3.5 rounded-lg bg-[#09090B] border border-white/[0.08]">
                  <p className="text-xs text-zinc-400">Valor Pedido (Anúncio)</p>
                  <p className="font-mono text-lg font-semibold text-white tabular-nums mt-1">
                    {formatBRL(analyzerTarget.askingPrice)}
                  </p>
                </div>
                <div className="p-3.5 rounded-lg bg-[#09090B] border border-white/[0.08]">
                  <p className="text-xs text-zinc-400">Tabela FIPE Atual</p>
                  <p className="font-mono text-lg font-semibold text-zinc-200 tabular-nums mt-1">
                    {formatBRL(analyzerTarget.fipePrice)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Custo Est. Preparação / Laudo (R$)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={prepCost}
                    onChange={(e) => setPrepCost(Number(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white font-mono focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Desconto p/ Revenda vs FIPE (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={targetResaleDiscountFipe}
                    onChange={(e) =>
                      setTargetResaleDiscountFipe(Number(e.target.value) || 0)
                    }
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white font-mono focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              {(() => {
                const suggestedSale = Math.round(
                  analyzerTarget.fipePrice * (1 - targetResaleDiscountFipe / 100)
                );
                const totalCost = analyzerTarget.askingPrice + prepCost;
                const netProfit = suggestedSale - totalCost;
                const roiPct = ((netProfit / totalCost) * 100).toFixed(1);

                return (
                  <div className="p-4 rounded-xl bg-[#09090B] border border-white/[0.08] space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">Preço Sugerido de Venda</span>
                      <span className="font-mono text-white font-semibold tabular-nums">
                        {formatBRL(suggestedSale)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">
                        Investimento Total (Compra + Preparação)
                      </span>
                      <span className="font-mono text-zinc-300 tabular-nums">
                        {formatBRL(totalCost)}
                      </span>
                    </div>
                    <div className="pt-2.5 border-t border-white/[0.08] flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">
                        Lucro Líquido Estimado
                      </span>
                      <div className="text-right">
                        <span
                          className={`font-mono text-base font-bold tabular-nums ${
                            netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {formatBRL(netProfit)}
                        </span>
                        <span className="block text-[11px] font-mono text-zinc-400 tabular-nums">
                          ROI {roiPct}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <a
                  href={analyzerTarget.link || 'https://www.olx.com.br'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-[#09090B] hover:bg-white/[0.08] border border-white/[0.1]"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-red-400" />
                  <span>Abrir Anúncio Original</span>
                </a>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setAnalyzerTarget(null)}
                    className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.05] hover:bg-white/[0.1]"
                  >
                    Fechar
                  </button>
                  {!analyzerTarget.imported && (
                    <button
                      type="button"
                      onClick={() => {
                        handleImport(analyzerTarget);
                        setAnalyzerTarget(null);
                      }}
                      className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500"
                    >
                      Importar para Estoque
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Monitored Opportunity Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#111114] border border-white/[0.1] rounded-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-white">
                Cadastrar Oportunidade no Radar
              </h2>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-2 text-zinc-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOpportunity} className="p-6 space-y-4">
              {addError && (
                <div className="px-3 py-2 rounded-lg bg-red-950/50 border border-red-600/40 text-xs text-red-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{addError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Portal / Origem
                </label>
                <select
                  value={newOppForm.platform}
                  onChange={(e) =>
                    setNewOppForm((p) => ({
                      ...p,
                      platform: e.target.value as 'OLX' | 'Webmotors' | 'Marketplace',
                    }))
                  }
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-red-600"
                >
                  <option value="OLX">OLX Autos</option>
                  <option value="Webmotors">Webmotors</option>
                  <option value="Marketplace">Facebook Marketplace</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Título do Anúncio *
                </label>
                <input
                  required
                  type="text"
                  value={newOppForm.title}
                  onChange={(e) =>
                    setNewOppForm((p) => ({ ...p, title: e.target.value }))
                  }
                  placeholder="Ex: BMW X1 sDrive20i M Sport 2023"
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Preço do Anúncio (R$) *
                  </label>
                  <input
                    required
                    type="number"
                    min={1000}
                    value={newOppForm.price}
                    onChange={(e) =>
                      setNewOppForm((p) => ({ ...p, price: e.target.value }))
                    }
                    placeholder="Ex: 235000"
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white font-mono focus:outline-none focus:border-red-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Valor Tabela FIPE (R$) *
                  </label>
                  <input
                    required
                    type="number"
                    min={1000}
                    value={newOppForm.fipe_price}
                    onChange={(e) =>
                      setNewOppForm((p) => ({ ...p, fipe_price: e.target.value }))
                    }
                    placeholder="Ex: 274000"
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white font-mono focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Link Direto do Anúncio *
                </label>
                <input
                  required
                  type="url"
                  value={newOppForm.link}
                  onChange={(e) =>
                    setNewOppForm((p) => ({ ...p, link: e.target.value }))
                  }
                  placeholder="https://www.olx.com.br/..."
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white font-mono focus:outline-none focus:border-red-600"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={isSubmittingNew}
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.05] hover:bg-white/[0.09] disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingNew}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-60"
                >
                  {isSubmittingNew && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSubmittingNew ? 'Salvando...' : 'Salvar no Radar'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
