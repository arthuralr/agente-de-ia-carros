import React, { useState } from 'react';
import {
  ArrowUpRight,
  CalendarClock,
  CarFront,
  FileCheck2,
  MessageSquare,
} from 'lucide-react';
import { ActivityLog, Lead, NavModule, Vehicle } from '../../types';
import { WEEKLY_METRICS } from '../../data/mockData';
import { formatBRL, formatKm } from '../../utils/formatters';
import { VehicleImage } from '../VehicleImage';

interface DashboardModuleProps {
  vehicles: Vehicle[];
  leads: Lead[];
  activities: ActivityLog[];
  onNavigate: (module: NavModule) => void;
  onSelectLead: (leadId: string) => void;
}

export const DashboardModule: React.FC<DashboardModuleProps> = ({
  vehicles,
  leads,
  activities,
  onNavigate,
  onSelectLead,
}) => {
  const [chartRange, setChartRange] = useState<'7d' | '30d'>('7d');
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);

  const availableVehicles = vehicles.filter((v) => v.status === 'Disponível');
  const reservedVehicles = vehicles.filter((v) => v.status === 'Reservado');
  const totalStockValue = availableVehicles.reduce((acc, v) => acc + v.price, 0);

  const newLeadsCount = leads.filter((l) => l.stage === 'Novo Lead').length;
  const chatLeadsCount = leads.filter((l) => l.source === 'Chat IA do Site').length;
  const proposals = leads.filter((l) => l.stage === 'Proposta');
  const totalProposalValue = proposals.reduce(
    (acc, l) => acc + (l.proposalValue || 0),
    0
  );
  const scheduledVisits = leads.filter((l) => Boolean(l.visitScheduled));

  const chartData =
    chartRange === '7d'
      ? WEEKLY_METRICS
      : WEEKLY_METRICS.map((item) => ({
          ...item,
          leads: Math.round(item.leads * 3.8),
          visits: Math.round(item.visits * 3.5),
          proposals: Math.round(item.proposals * 3.2),
        }));

  const maxLeads = Math.max(...chartData.map((d) => d.leads), 1);

  return (
    <div className="space-y-6">
      {/* 4 Daily KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('inventory')}
          className="text-left bg-[#111114] border border-white/[0.08] hover:border-white/[0.16] rounded-xl p-5 transition-colors group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-zinc-400">
              Carros em Estoque
            </span>
            <CarFront className="w-4 h-4 text-red-500" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-3xl font-semibold text-white tabular-nums">
              {availableVehicles.length}
            </span>
            <span className="text-xs text-zinc-400 tabular-nums">
              {reservedVehicles.length} reservado(s)
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-500 tabular-nums">
            VGV disponível: {formatBRL(totalStockValue)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('crm')}
          className="text-left bg-[#111114] border border-white/[0.08] hover:border-white/[0.16] rounded-xl p-5 transition-colors group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-zinc-400">
              Novos Leads no Chat
            </span>
            <MessageSquare className="w-4 h-4 text-red-500" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-3xl font-semibold text-white tabular-nums">
              {newLeadsCount}
            </span>
            <span className="text-xs text-emerald-400 tabular-nums">
              {chatLeadsCount} via Chat IA
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Total ativo no funil: {leads.length} contatos
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('crm')}
          className="text-left bg-[#111114] border border-white/[0.08] hover:border-white/[0.16] rounded-xl p-5 transition-colors group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-zinc-400">
              Propostas em Andamento
            </span>
            <FileCheck2 className="w-4 h-4 text-red-500" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-3xl font-semibold text-white tabular-nums">
              {proposals.length}
            </span>
            <span className="text-xs text-amber-400 tabular-nums">
              Em negociação
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-500 tabular-nums">
            Volume em mesa: {formatBRL(totalProposalValue)}
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('crm')}
          className="text-left bg-[#111114] border border-white/[0.08] hover:border-white/[0.16] rounded-xl p-5 transition-colors group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-zinc-400">
              Visitas Agendadas
            </span>
            <CalendarClock className="w-4 h-4 text-red-500" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-3xl font-semibold text-white tabular-nums">
              {scheduledVisits.length}
            </span>
            <span className="text-xs text-zinc-400">
              Showroom
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Próxima: {scheduledVisits[0]?.visitScheduled || 'Sem agendamentos'}
          </p>
        </button>
      </div>

      {/* Main Analytics + Recent Activity Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Weekly Funnel Chart */}
        <div className="lg:col-span-7 bg-[#111114] border border-white/[0.08] rounded-xl p-6 flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Desempenho de Captação e Visitas
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Leads qualificados pelo chat vs. visitas confirmadas no showroom
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#09090B] border border-white/[0.08] rounded-lg">
              <button
                type="button"
                onClick={() => setChartRange('7d')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  chartRange === '7d'
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Últimos 7 dias
              </button>
              <button
                type="button"
                onClick={() => setChartRange('30d')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  chartRange === '30d'
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Acumulado 30 dias
              </button>
            </div>
          </div>

          {/* Clean Bar Chart */}
          <div className="relative h-60 flex items-end justify-between gap-3 pt-6 pb-2 border-b border-white/[0.08]">
            {chartData.map((item) => {
              const leadHeightPct = Math.max((item.leads / maxLeads) * 100, 10);
              const visitHeightPct = Math.max((item.visits / maxLeads) * 100, 6);
              const isHovered = hoveredDay === item.day;

              return (
                <div
                  key={item.day}
                  onMouseEnter={() => setHoveredDay(item.day)}
                  onMouseLeave={() => setHoveredDay(null)}
                  className="flex-1 flex flex-col items-center h-full justify-end group relative cursor-default"
                >
                  {isHovered && (
                    <div className="absolute -top-2 z-10 bg-zinc-900 border border-white/15 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 shadow-lg whitespace-nowrap pointer-events-none">
                      <span className="font-semibold text-white">{item.day}</span>
                      <span className="mx-1.5 text-zinc-600">·</span>
                      <span className="tabular-nums">{item.leads} leads</span>
                      <span className="mx-1.5 text-zinc-600">·</span>
                      <span className="text-red-400 tabular-nums">{item.visits} visitas</span>
                    </div>
                  )}

                  <div className="w-full max-w-[44px] h-44 flex items-end justify-center gap-1.5">
                    <div
                      style={{ height: `${leadHeightPct}%` }}
                      className="w-1/2 bg-zinc-700/80 group-hover:bg-zinc-500 rounded-t-sm transition-all duration-150"
                      title={`${item.leads} leads`}
                    />
                    <div
                      style={{ height: `${visitHeightPct}%` }}
                      className="w-1/2 bg-red-600 group-hover:bg-red-500 rounded-t-sm transition-all duration-150"
                      title={`${item.visits} visitas`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 pt-2.5">
            {chartData.map((item) => (
              <span
                key={item.day}
                className="flex-1 text-center text-xs text-zinc-500 font-medium"
              >
                {item.day}
              </span>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-400">
            <div className="flex items-center gap-5">
              <span className="inline-flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-xs bg-zinc-600" />
                Leads Capturados
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-xs bg-red-600" />
                Visitas Agendadas
              </span>
            </div>
            <span className="font-mono tabular-nums text-zinc-300">
              Taxa média de visita: 31,4%
            </span>
          </div>
        </div>

        {/* Recent Activity List */}
        <div className="lg:col-span-5 bg-[#111114] border border-white/[0.08] rounded-xl p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-white">
              Atividade Recente
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('crm')}
              className="text-xs font-medium text-red-400 hover:text-red-300 inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>Ver CRM</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-white/[0.06] flex-1">
            {activities.slice(0, 5).map((act) => (
              <div key={act.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-zinc-100 leading-snug">
                    {act.title}
                  </p>
                  <span className="text-[11px] text-zinc-500 whitespace-nowrap shrink-0 tabular-nums">
                    {act.time}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  {act.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row: Showroom Showcase & Scheduled Visits */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-[#111114] border border-white/[0.08] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-white">
              Destaques em Showroom
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-medium text-zinc-300 hover:text-white inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>Gerenciar estoque</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-white/[0.06]">
            {vehicles.slice(0, 4).map((vehicle) => (
              <div
                key={vehicle.id}
                className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-16 h-12 rounded-lg overflow-hidden shrink-0 bg-zinc-900 border border-white/[0.06]">
                    <VehicleImage
                      src={vehicle.imageUrl}
                      alt={`${vehicle.brand} ${vehicle.model}`}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {vehicle.brand} {vehicle.model} {vehicle.version}
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5 tabular-nums truncate">
                      {vehicle.year} · {formatKm(vehicle.km)} · {vehicle.status}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="font-mono text-sm font-semibold text-white tabular-nums">
                    {formatBRL(vehicle.price)}
                  </p>
                  <p className="text-[11px] text-zinc-500 tabular-nums">
                    Placa {vehicle.plate}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 bg-[#111114] border border-white/[0.08] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-white">
              Visitas Agendadas
            </h2>
            <span className="text-xs text-zinc-400 tabular-nums">
              {scheduledVisits.length} confirmações
            </span>
          </div>

          {scheduledVisits.length === 0 ? (
            <p className="text-sm text-zinc-500 py-8 text-center">
              Nenhuma visita agendada no momento.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {scheduledVisits.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => onSelectLead(lead.id)}
                  className="w-full text-left py-3 first:pt-0 last:pb-0 hover:bg-white/[0.02] transition-colors flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-100 truncate">
                      {lead.name}
                    </p>
                    <p className="text-xs text-zinc-400 truncate mt-0.5">
                      {lead.vehicleInterestLabel}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-mono font-medium text-red-400 tabular-nums">
                      {lead.visitScheduled}
                    </p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      {lead.stage}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
