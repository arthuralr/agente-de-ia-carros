import React from 'react';
import {
  ArrowRight,
  CarFront,
  MessageSquare,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { DealershipSettings, Vehicle } from '../../types';
import { formatBRL, formatKm } from '../../utils/formatters';
import { VehicleImage } from '../VehicleImage';
import { PublicFooter } from './PublicFooter';

interface PublicHomePageProps {
  vehicles: Vehicle[];
  settings: DealershipSettings;
  onGoToCatalog: () => void;
  onOpenAdmin: () => void;
  onOpenDetails: (vehicle: Vehicle) => void;
  onInterest: (vehicle: Vehicle) => void;
  onOpenGeneralChat: () => void;
  onOpenPrivacy?: () => void;
}

export const PublicHomePage: React.FC<PublicHomePageProps> = ({
  vehicles,
  settings,
  onGoToCatalog,
  onOpenAdmin,
  onOpenDetails,
  onInterest,
  onOpenGeneralChat,
  onOpenPrivacy,
}) => {
  const activeStock = vehicles.filter((v) => v.status !== 'Vendido');
  const heroVehicle = activeStock[0];

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col">
      {/* Slim Top Bar (3-zone contract) */}
      <header className="sticky top-0 z-30 h-16 border-b border-white/[0.08] bg-[#09090B]/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto h-full px-5 sm:px-8 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
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
          </div>

          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-zinc-400">
            <span className="text-white border-b border-red-600 pb-0.5 whitespace-nowrap shrink-0">
              Início
            </span>
            <button
              type="button"
              onClick={onGoToCatalog}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Estoque de Veículos
            </button>
            <button
              type="button"
              onClick={onOpenGeneralChat}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Atendimento IA
            </button>
            <button
              type="button"
              onClick={onOpenAdmin}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Painel Admin
            </button>
          </nav>

          <button
            type="button"
            onClick={onGoToCatalog}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
          >
            <span>Ver Estoque</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-5 sm:px-8 py-12 space-y-16">
        {/* Hero Split */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <p className="text-xs font-medium text-red-400">
              Showroom {settings.city} · {settings.address}
            </p>

            <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-white leading-[1.1] max-w-xl">
              Seminovos selecionados com procedência comprovada
            </h1>

            <p className="text-base text-zinc-400 leading-relaxed max-w-xl">
              Atendimento consultivo imediato com nosso assistente de inteligência
              artificial, avaliação justa do seu usado na troca e veículos 100%
              periciados prontos para entrega.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onGoToCatalog}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors whitespace-nowrap"
              >
                <CarFront className="w-4 h-4" />
                <span>Explorar Estoque ({activeStock.length})</span>
              </button>

              <button
                type="button"
                onClick={onOpenGeneralChat}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium text-zinc-200 bg-[#111114] hover:bg-white/[0.06] border border-white/[0.1] transition-colors whitespace-nowrap"
              >
                <MessageSquare className="w-4 h-4 text-red-500" />
                <span>Atendimento com IA</span>
              </button>
            </div>
          </div>

          {heroVehicle && (
            <div className="lg:col-span-6 bg-[#111114] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col">
              <div className="aspect-[16/10] w-full bg-zinc-950 overflow-hidden">
                <VehicleImage
                  src={heroVehicle.imageUrl}
                  alt={`${heroVehicle.brand} ${heroVehicle.model}`}
                />
              </div>
              <div className="p-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-zinc-400">Destaque no Showroom</p>
                  <p className="font-display text-lg font-semibold text-white">
                    {heroVehicle.brand} {heroVehicle.model} {heroVehicle.version}
                  </p>
                  <p className="text-xs text-zinc-400 tabular-nums mt-0.5">
                    {heroVehicle.year} · {formatKm(heroVehicle.km)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xl font-semibold text-white tabular-nums">
                    {formatBRL(heroVehicle.price)}
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpenDetails(heroVehicle)}
                    className="text-xs font-medium text-red-400 hover:text-red-300 mt-1"
                  >
                    Ver ficha completa
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 3 Value Pillars */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-b border-white/[0.08] py-8">
          <div className="space-y-1.5">
            <ShieldCheck className="w-5 h-5 text-red-500" />
            <h2 className="font-display text-base font-semibold text-white">
              Laudo Cautelar Aprovado
            </h2>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Todos os automóveis passam por perícia estrutural e documental antes de
              ingressar no showroom.
            </p>
          </div>
          <div className="space-y-1.5">
            <Sparkles className="w-5 h-5 text-red-500" />
            <h2 className="font-display text-base font-semibold text-white">
              Consultoria Instantânea 24h
            </h2>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Tire dúvidas sobre histórico, financiamento e troca diretamente com o{' '}
              {settings.aiAssistantName}.
            </p>
          </div>
          <div className="space-y-1.5">
            <CarFront className="w-5 h-5 text-red-500" />
            <h2 className="font-display text-base font-semibold text-white">
              Garantia de {settings.warrantyDays} Dias (CDC)
            </h2>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Transparência total em contrato, emissão ágil de ATPV-e e cobertura
              para motor e câmbio.
            </p>
          </div>
        </section>

        {/* Featured 3 Vehicles Strip */}
        <section className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-2xl font-semibold text-white">
              Recém-chegados ao Estoque
            </h2>
            <button
              type="button"
              onClick={onGoToCatalog}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400 hover:text-red-300 whitespace-nowrap"
            >
              <span>Ver estoque completo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {activeStock.slice(0, 3).map((v) => (
              <div
                key={v.id}
                className="bg-[#111114] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col"
              >
                <div
                  onClick={() => onOpenDetails(v)}
                  className="aspect-[4/3] w-full bg-zinc-950 overflow-hidden cursor-pointer"
                >
                  <VehicleImage src={v.imageUrl} alt={`${v.brand} ${v.model}`} />
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <h3 className="font-display text-base font-semibold text-white">
                      {v.brand} {v.model}
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5 truncate">
                      {v.year} · {formatKm(v.km)} · {v.transmission}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/[0.06]">
                    <span className="font-mono text-base font-semibold text-white tabular-nums">
                      {formatBRL(v.price)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onInterest(v)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors whitespace-nowrap"
                    >
                      Tenho Interesse
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <PublicFooter
        settings={settings}
        onOpenAdmin={onOpenAdmin}
        onOpenPrivacy={onOpenPrivacy}
      />
    </div>
  );
};
