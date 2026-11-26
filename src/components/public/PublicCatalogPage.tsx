import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  Eye,
  Menu,
  MessageSquare,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { DealershipSettings, Vehicle, VehicleCategory } from '../../types';
import { inferVehicleCategory } from '../../data/mockData';
import { ApiVehicleRow, mapDbVehicleToFrontend } from '../../db/mappers';
import { formatBRL, formatKm } from '../../utils/formatters';
import {
  analyzeVehicleDataQuality,
  computeFipeMetrics,
  getVehicleDisplayTitle,
} from '../../utils/vehicleDomain';
import { VehicleImage } from '../VehicleImage';
import { PublicFooter } from './PublicFooter';

interface PublicCatalogPageProps {
  vehicles: Vehicle[];
  settings: DealershipSettings;
  onBackHome: () => void;
  onOpenAdmin: () => void;
  onOpenDetails: (vehicle: Vehicle) => void;
  onInterest: (vehicle: Vehicle) => void;
  onOpenGeneralChat: () => void;
  onOpenDirectChat: () => void;
  onOpenPrivacy?: () => void;
}

const CATEGORIES: ('Todos' | VehicleCategory)[] = [
  'Todos',
  'SUVs',
  'Sedans',
  'Hatches',
  'Esportivos',
];

type SortOption =
  | 'recent'
  | 'price_asc'
  | 'price_desc'
  | 'km_asc';

export const PublicCatalogPage: React.FC<PublicCatalogPageProps> = ({
  vehicles,
  settings,
  onBackHome,
  onOpenAdmin,
  onOpenDetails,
  onInterest,
  onOpenDirectChat,
  onOpenPrivacy,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'Todos' | VehicleCategory>('Todos');
  const [transmissionFilter, setTransmissionFilter] = useState<
    'Todos' | 'Automático' | 'Manual'
  >('Todos');
  const [fuelFilter, setFuelFilter] = useState<
    'Todos' | 'Flex' | 'Gasolina' | 'Híbrido'
  >('Todos');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [dbVehicles, setDbVehicles] = useState<Vehicle[] | null>(null);
  const [isLoadingStock, setIsLoadingStock] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [retryCounter, setRetryCounter] = useState(0);

  useEffect(() => {
    let active = true;

    async function fetchPublicVehicles() {
      setIsLoadingStock(true);
      setLoadError(null);
      try {
        const res = await fetch('/api/public/vehicles');
        if (!res.ok) {
          throw new Error('Não foi possível carregar os veículos disponíveis.');
        }
        const rows = (await res.json()) as ApiVehicleRow[];
        if (active && Array.isArray(rows)) {
          setDbVehicles(rows.map(mapDbVehicleToFrontend));
        }
      } catch (err: unknown) {
        if (active) {
          setLoadError(
            err instanceof Error
              ? err.message
              : 'Falha ao consultar o estoque no banco de dados.'
          );
        }
      } finally {
        if (active) {
          setIsLoadingStock(false);
        }
      }
    }

    void fetchPublicVehicles();
    return () => {
      active = false;
    };
  }, [vehicles, retryCounter]);

  // Dynamic available stock loaded from Neon (status = 'Disponivel', ordered by created_at DESC)
  const activeStock = useMemo(() => {
    if (dbVehicles !== null) return dbVehicles;
    return vehicles.filter((v) => v.status === 'Disponível');
  }, [dbVehicles, vehicles]);

  const filteredAndSorted = useMemo(() => {
    const term = search.trim().toLowerCase();

    const matched = activeStock.filter((v) => {
      const cat = inferVehicleCategory(v);
      const matchesCat = category === 'Todos' || cat === category;

      const quality = analyzeVehicleDataQuality(v);
      const matchesTrans =
        transmissionFilter === 'Todos' ||
        (transmissionFilter === 'Automático' &&
          quality.transmissionStatus === 'confirmed_auto') ||
        (transmissionFilter === 'Manual' &&
          quality.transmissionStatus === 'confirmed_manual');

      const fuelLower = v.fuel.toLowerCase();
      const matchesFuel =
        fuelFilter === 'Todos' ||
        (fuelFilter === 'Flex' && fuelLower.includes('flex')) ||
        (fuelFilter === 'Gasolina' && fuelLower.includes('gasolina')) ||
        (fuelFilter === 'Híbrido' && fuelLower.includes('híbrido'));

      const searchable = `${v.brand} ${v.model} ${v.version} ${v.color} ${cat} ${v.year} ${v.transmission} ${v.fuel}`.toLowerCase();
      const matchesSearch = !term || searchable.includes(term);

      return matchesCat && matchesTrans && matchesFuel && matchesSearch;
    });

    if (sortBy === 'recent') {
      // Preserve Neon ORDER BY created_at DESC order
      return matched;
    }

    return [...matched].sort((a, b) => {
      switch (sortBy) {
        case 'price_asc':
          return a.price - b.price;
        case 'price_desc':
          return b.price - a.price;
        case 'km_asc':
          return a.km - b.km;
        default:
          return 0;
      }
    });
  }, [activeStock, search, category, transmissionFilter, fuelFilter, sortBy]);

  const hasActiveFilters =
    search.trim() !== '' ||
    category !== 'Todos' ||
    transmissionFilter !== 'Todos' ||
    fuelFilter !== 'Todos';

  const resetFilters = () => {
    setSearch('');
    setCategory('Todos');
    setTransmissionFilter('Todos');
    setFuelFilter('Todos');
    setSortBy('recent');
  };

  const handleDirectChatClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    setMobileMenuOpen(false);
    onOpenDirectChat();
  };

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col">
      {/* Slim Top Navigation Bar (3-zone contract + responsive mobile menu) */}
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#09090B]/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto h-16 px-5 sm:px-8 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={onBackHome}
            className="flex items-center gap-3 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 rounded-md"
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
            <span className="font-display font-semibold text-base tracking-tight text-white">
              {settings.tradeName}
            </span>
          </button>

          {/* Zone 2: Concise Single-Line Nav Links */}
          <nav
            aria-label="Navegação principal"
            className="hidden md:flex items-center gap-6 text-xs font-medium text-zinc-400"
          >
            <button
              type="button"
              onClick={onBackHome}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Início
            </button>
            <span className="text-white border-b border-red-600 pb-0.5 whitespace-nowrap shrink-0">
              Estoque de Veículos
            </span>
            <a
              href="/chat"
              onClick={handleDirectChatClick}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Atendimento IA
            </a>
            <button
              type="button"
              onClick={onOpenAdmin}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Painel Admin
            </button>
          </nav>

          {/* Zone 3: Discreet Back to Home Button + Mobile Menu Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onBackHome}
              className="hidden sm:inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-zinc-400" />
              <span>Voltar ao Início</span>
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu de navegação'}
              aria-expanded={mobileMenuOpen}
              className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-white/[0.1] bg-white/[0.04] text-zinc-200 hover:text-white hover:bg-white/[0.08] transition-colors"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <nav
            aria-label="Menu mobile"
            className="md:hidden border-t border-white/[0.08] bg-[#0D0D10] px-5 py-4 space-y-2"
          >
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onBackHome();
              }}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium text-zinc-200 hover:bg-white/[0.06]"
            >
              <span>Início</span>
              <ArrowLeft className="w-4 h-4 text-zinc-400" />
            </button>
            <a
              href="/chat"
              onClick={handleDirectChatClick}
              className="flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-500"
            >
              <span>Atendimento IA</span>
              <MessageSquare className="w-4 h-4" />
            </a>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenAdmin();
              }}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/[0.06]"
            >
              <span>Painel Admin</span>
            </button>
          </nav>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-5 sm:px-8 pt-10 pb-8 space-y-8">
        {/* Page Header Title & Subtitle */}
        <section className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-white/[0.08]">
          <div className="space-y-2 max-w-2xl">
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-white">
              Estoque de Veículos
            </h1>
            <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">
              Veículos seminovos revisados, periciados e com garantia de procedência
            </p>
          </div>

          <a
            href="/chat"
            onClick={handleDirectChatClick}
            className="self-start md:self-auto inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Atendimento IA</span>
          </a>
        </section>

        {/* Search, Filters & Sorting Bar */}
        <section className="bg-[#111114] border border-white/[0.08] rounded-xl p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-center">
            {/* Search Input */}
            <div className="lg:col-span-5 relative">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por marca, modelo, SUV, cor (ex: BMW, Branco)..."
                className="w-full pl-10 pr-4 py-2.5 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none"
              />
            </div>

            {/* Transmission & Fuel Filters */}
            <div className="lg:col-span-4 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="filter-transmission" className="sr-only">
                  Câmbio
                </label>
                <select
                  id="filter-transmission"
                  value={transmissionFilter}
                  onChange={(e) =>
                    setTransmissionFilter(
                      e.target.value as 'Todos' | 'Automático' | 'Manual'
                    )
                  }
                  className="w-full px-3 py-2.5 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-xs font-medium text-zinc-200 focus:outline-none"
                >
                  <option value="Todos">Câmbio: Todos</option>
                  <option value="Automático">Câmbio: Automático</option>
                  <option value="Manual">Câmbio: Manual</option>
                </select>
              </div>

              <div>
                <label htmlFor="filter-fuel" className="sr-only">
                  Combustível
                </label>
                <select
                  id="filter-fuel"
                  value={fuelFilter}
                  onChange={(e) =>
                    setFuelFilter(
                      e.target.value as 'Todos' | 'Flex' | 'Gasolina' | 'Híbrido'
                    )
                  }
                  className="w-full px-3 py-2.5 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-xs font-medium text-zinc-200 focus:outline-none"
                >
                  <option value="Todos">Combustível: Todos</option>
                  <option value="Flex">Combustível: Flex</option>
                  <option value="Gasolina">Combustível: Gasolina</option>
                  <option value="Híbrido">Combustível: Híbrido</option>
                </select>
              </div>
            </div>

            {/* Sort Selector */}
            <div className="lg:col-span-3 relative">
              <ArrowUpDown className="w-3.5 h-3.5 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                aria-label="Ordenar veículos"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="w-full pl-9 pr-3 py-2.5 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-xs font-medium text-zinc-200 focus:outline-none"
              >
                <option value="recent">Ordenar: Mais Recentes</option>
                <option value="price_asc">Ordenar: Menor Preço</option>
                <option value="price_desc">Ordenar: Maior Preço</option>
                <option value="km_asc">Ordenar: Menor Quilometragem</option>
              </select>
            </div>
          </div>

          {/* Quick Categories + Real-Time Counter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-white/[0.06]">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    category === cat
                      ? 'bg-red-600 text-white'
                      : 'bg-[#09090B] text-zinc-400 hover:text-white border border-white/[0.08]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <p className="text-xs text-zinc-400 tabular-nums">
                Mostrando{' '}
                <strong className="text-white font-semibold">
                  {filteredAndSorted.length}
                </strong>{' '}
                de{' '}
                <strong className="text-white font-semibold">
                  {activeStock.length}
                </strong>{' '}
                veículos encontrados
              </p>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 text-xs font-medium text-red-400 hover:text-red-300 whitespace-nowrap"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Limpar</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {loadError && (
          <div className="px-4 py-3 rounded-lg bg-red-950/50 border border-red-600/40 flex flex-wrap items-center justify-between gap-3 text-xs text-red-200">
            <span className="inline-flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{loadError}</span>
            </span>
            <button
              type="button"
              onClick={() => setRetryCounter((c) => c + 1)}
              className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white font-semibold"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Vehicle Cards Grid */}
        {isLoadingStock && dbVehicles === null ? (
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="bg-[#111114] border border-white/[0.08] rounded-xl overflow-hidden animate-pulse"
              >
                <div className="aspect-[4/3] w-full bg-zinc-900" />
                <div className="p-5 space-y-3">
                  <div className="h-3 w-20 bg-zinc-800 rounded" />
                  <div className="h-5 w-3/4 bg-zinc-800 rounded" />
                  <div className="h-3 w-full bg-zinc-900 rounded" />
                  <div className="pt-4 border-t border-white/[0.06] flex justify-between">
                    <div className="h-6 w-28 bg-zinc-800 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </section>
        ) : filteredAndSorted.length === 0 ? (
          <div className="bg-[#111114] border border-white/[0.08] rounded-xl py-20 px-6 text-center space-y-3">
            <p className="font-display text-base font-semibold text-white">
              Nenhum veículo encontrado com os filtros selecionados
            </p>
            <p className="text-xs text-zinc-400 max-w-md mx-auto">
              Tente limpar os filtros ou converse com nosso Consultor Virtual para
              encomendar o modelo que você procura.
            </p>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={resetFilters}
                className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08]"
              >
                Mostrar todo o estoque
              </button>
              <a
                href="/chat"
                onClick={(e) => {
                  if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                    e.preventDefault();
                    onOpenDirectChat();
                  }
                }}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500"
              >
                Buscar sob encomenda no Chat IA
              </a>
            </div>
          </div>
        ) : (
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAndSorted.map((vehicle, idx) => {
              const cat = inferVehicleCategory(vehicle);
              const quality = analyzeVehicleDataQuality(vehicle);
              const fipe = computeFipeMetrics(vehicle);
              const displayTitle = getVehicleDisplayTitle(vehicle);
              const descriptiveAlt = [
                displayTitle,
                vehicle.year,
                vehicle.color,
                quality.displayTransmission,
              ]
                .filter(Boolean)
                .join(' · ');

              return (
                <article
                  key={vehicle.id}
                  className="bg-[#111114] border border-white/[0.08] hover:border-white/[0.18] rounded-xl overflow-hidden flex flex-col transition-all duration-150 hover:-translate-y-0.5"
                >
                  {/* 4:3 Vehicle Photo */}
                  <div
                    onClick={() => onOpenDetails(vehicle)}
                    className="aspect-[4/3] w-full bg-zinc-950 overflow-hidden cursor-pointer relative group"
                  >
                    <VehicleImage
                      src={vehicle.imageUrl}
                      alt={descriptiveAlt}
                      priority={idx < 3}
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                    />
                  </div>

                  {/* Card Content */}
                  <div className="p-5 flex-1 flex flex-col justify-between space-y-5">
                    <div>
                      <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                        <span>{cat}</span>
                        {vehicle.status === 'Reservado' ? (
                          <span className="text-amber-400 font-medium">
                            Reservado
                          </span>
                        ) : (
                          <span>{vehicle.color}</span>
                        )}
                      </div>

                      <h2 className="font-display text-lg font-semibold text-white mt-1 leading-snug">
                        {displayTitle}
                      </h2>
                      {vehicle.version &&
                        !displayTitle
                          .toLowerCase()
                          .includes(vehicle.version.trim().toLowerCase()) && (
                          <p className="text-xs text-zinc-400 truncate mt-0.5">
                            {vehicle.version}
                          </p>
                        )}

                      {/* Clean unboxed technical metadata */}
                      <p className="text-xs text-zinc-300 mt-3 tabular-nums">
                        {vehicle.year} · {formatKm(vehicle.km)} ·{' '}
                        <span
                          className={
                            quality.canonicalTransmission
                              ? 'text-zinc-300'
                              : 'text-amber-400'
                          }
                        >
                          {quality.displayTransmission}
                        </span>{' '}
                        · {vehicle.fuel}
                      </p>
                      {fipe.isConfirmedBelowFipeOffer && fipe.diffBrl ? (
                        <p className="text-[11px] text-emerald-400 mt-1.5 tabular-nums">
                          {formatBRL(fipe.diffBrl)} abaixo da FIPE ({fipe.fipeReferenceMonth})
                        </p>
                      ) : !fipe.hasFipeValue ? (
                        <p className="text-[11px] text-zinc-500 mt-1.5">
                          FIPE sob consulta
                        </p>
                      ) : null}
                    </div>

                    <div className="pt-4 border-t border-white/[0.06] space-y-4">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs text-zinc-400">À vista</span>
                        <span className="font-mono text-xl font-semibold text-white tabular-nums">
                          {formatBRL(vehicle.price)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() => onOpenDetails(vehicle)}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] transition-colors whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5 text-zinc-400" />
                          <span>Ver Detalhes</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onInterest(vehicle)}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors whitespace-nowrap"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Tenho Interesse</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </main>

      <PublicFooter
        settings={settings}
        onOpenAdmin={onOpenAdmin}
        onOpenPrivacy={onOpenPrivacy}
      />
    </div>
  );
};
