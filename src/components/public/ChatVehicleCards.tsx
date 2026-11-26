import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Calculator,
  Check,
  GitCompareArrows,
  Info,
  MessageCircle,
} from 'lucide-react';
import {
  VehicleCardData,
  VehicleComparisonData,
  VehicleFinancingSummary,
} from '../../types';
import { VehicleImage } from '../VehicleImage';
import {
  formatBrlCurrency,
  formatKmBr,
  getVehicleDisplayTitle,
} from '../../utils/vehicleDomain';

interface ChatVehicleCardsProps {
  cards: VehicleCardData[];
  selectedCompareIds?: string[];
  onOpenSheet: (card: VehicleCardData) => void;
  onToggleCompare: (card: VehicleCardData) => void;
  onSimulate: (card: VehicleCardData) => void;
  onConsult?: (card: VehicleCardData) => void;
}

export const ChatVehicleCards: React.FC<ChatVehicleCardsProps> = ({
  cards,
  selectedCompareIds = [],
  onOpenSheet,
  onToggleCompare,
  onSimulate,
  onConsult,
}) => {
  if (!cards || cards.length === 0) return null;

  return (
    <div className="mt-2.5 space-y-2.5 w-full">
      {cards.slice(0, 3).map((card) => {
        const isCompared = selectedCompareIds.includes(card.id);
        const title = getVehicleDisplayTitle(card);
        const isUnavailable = card.status !== 'Disponível';

        return (
          <article
            key={card.id}
            className="rounded-xl border border-zinc-200/90 bg-white overflow-hidden shadow-xs"
          >
            {card.alternativeNote && (
              <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-200/80 text-[11px] text-amber-900 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                <span>{card.alternativeNote}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row">
              {/* Thumbnail */}
              <div className="relative w-full sm:w-36 h-36 sm:h-auto shrink-0 bg-zinc-100">
                <VehicleImage
                  src={card.imageUrl}
                  alt={`${title} ${card.year}`}
                  className="w-full h-full object-cover"
                />
                {isUnavailable && (
                  <div className="absolute inset-0 bg-zinc-950/60 flex items-center justify-center p-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-white bg-zinc-900/90 px-2.5 py-1 rounded-md">
                      {card.status}
                    </span>
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0 p-3 flex flex-col justify-between gap-2.5">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-zinc-900 leading-snug">
                        {title}
                      </h4>
                      {card.version && (
                        <p className="text-xs text-zinc-500 line-clamp-1 mt-0.5">
                          {card.version}
                        </p>
                      )}
                    </div>
                    <p className="text-sm sm:text-base font-bold text-zinc-950 tabular-nums shrink-0">
                      {formatBrlCurrency(card.price)}
                    </p>
                  </div>

                  {/* Clean unboxed spec line */}
                  <p className="mt-1.5 text-xs text-zinc-600 tabular-nums">
                    {card.year} · {formatKmBr(card.km)} ·{' '}
                    <span
                      className={
                        card.transmissionConfirmed
                          ? 'text-zinc-700'
                          : 'text-amber-800 font-medium'
                      }
                    >
                      {card.transmission}
                    </span>
                  </p>

                  {!card.transmissionConfirmed && card.transmissionConflictNote && (
                    <p className="mt-1 text-[11px] text-amber-800 flex items-start gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>Câmbio em conferência com a loja.</span>
                    </p>
                  )}

                  {card.isConfirmedBelowFipeOffer &&
                    card.fipePrice &&
                    card.fipeReferenceMonth &&
                    card.fipeDiffBrl && (
                      <p className="mt-1 text-[11px] text-emerald-800 font-medium tabular-nums">
                        FIPE ({card.fipeReferenceMonth}): {formatBrlCurrency(card.fipePrice)} ·{' '}
                        {formatBrlCurrency(card.fipeDiffBrl)} abaixo ({card.fipeDiffPct}%)
                      </p>
                    )}
                </div>

                {/* Card actions */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-zinc-100">
                  <button
                    type="button"
                    onClick={() => onOpenSheet(card)}
                    className="inline-flex items-center justify-center gap-1 px-3 py-2 min-h-[38px] rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  >
                    <span>Ver ficha</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleCompare(card)}
                    aria-pressed={isCompared}
                    className={`inline-flex items-center justify-center gap-1 px-3 py-2 min-h-[38px] rounded-lg border text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
                      isCompared
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-semibold'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                    }`}
                  >
                    {isCompared ? (
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                    ) : (
                      <GitCompareArrows className="w-3.5 h-3.5" />
                    )}
                    <span>{isCompared ? 'Selecionado' : 'Comparar'}</span>
                  </button>

                  {!isUnavailable && (
                    <button
                      type="button"
                      onClick={() => onSimulate(card)}
                      className="inline-flex items-center justify-center gap-1 px-3 py-2 min-h-[38px] rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-400"
                    >
                      <Calculator className="w-3.5 h-3.5" />
                      <span>Simular</span>
                    </button>
                  )}

                  {!isUnavailable && onConsult && (
                    <button
                      type="button"
                      onClick={() => onConsult(card)}
                      className="inline-flex items-center justify-center gap-1 px-3 py-2 min-h-[38px] rounded-lg border border-emerald-600/35 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    >
                      <MessageCircle className="w-3.5 h-3.5 text-emerald-700" />
                      <span>WhatsApp</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
};

interface ChatComparisonBlockProps {
  comparison: VehicleComparisonData;
  onOpenSheet: (card: VehicleCardData) => void;
}

export const ChatComparisonBlock: React.FC<ChatComparisonBlockProps> = ({
  comparison,
  onOpenSheet,
}) => {
  if (!comparison || comparison.vehicles.length < 2) return null;

  return (
    <div className="mt-2.5 rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-xs">
      <div className="px-3.5 py-2.5 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-900">
          Comparativo dos veículos selecionados
        </span>
        <span className="text-[11px] text-zinc-500">
          {comparison.vehicles.length} opções
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/50">
              <th className="py-2 px-3 font-medium text-zinc-500 whitespace-nowrap">
                Campo
              </th>
              {comparison.vehicles.map((v) => (
                <th key={v.id} className="py-2 px-3 font-semibold text-zinc-900 min-w-[130px]">
                  <button
                    type="button"
                    onClick={() => onOpenSheet(v)}
                    className="text-left hover:underline text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 rounded"
                  >
                    {getVehicleDisplayTitle(v)}
                    <span className="block text-[11px] font-normal text-zinc-500">
                      {v.year}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {comparison.rows.map((row) => (
              <tr key={row.label}>
                <td className="py-2 px-3 text-zinc-500 font-medium whitespace-nowrap">
                  {row.label}
                </td>
                {row.values.map((val, idx) => (
                  <td
                    key={`${row.label}-${idx}`}
                    className="py-2 px-3 text-zinc-800 tabular-nums"
                  >
                    {val}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface ChatFinancingBlockProps {
  summary: VehicleFinancingSummary;
}

export const ChatFinancingBlock: React.FC<ChatFinancingBlockProps> = ({ summary }) => {
  return (
    <div className="mt-2.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 space-y-2">
      <p className="text-xs font-semibold text-zinc-900">
        Resumo base de financiamento · {summary.vehicleTitle}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <div className="bg-white rounded-lg border border-zinc-200/80 px-2.5 py-2">
          <span className="block text-[11px] text-zinc-500">Preço à vista</span>
          <span className="font-semibold text-zinc-900 tabular-nums">
            {formatBrlCurrency(summary.vehiclePrice)}
          </span>
        </div>
        <div className="bg-white rounded-lg border border-zinc-200/80 px-2.5 py-2">
          <span className="block text-[11px] text-zinc-500">Entrada</span>
          <span className="font-semibold text-zinc-900 tabular-nums">
            {formatBrlCurrency(summary.downPayment)}
          </span>
        </div>
        <div className="col-span-2 sm:col-span-1 bg-white rounded-lg border border-emerald-200 px-2.5 py-2">
          <span className="block text-[11px] text-emerald-800">Saldo a financiar</span>
          <span className="font-bold text-emerald-950 tabular-nums">
            {formatBrlCurrency(summary.principalBalance)}
          </span>
        </div>
      </div>

      {summary.estimatedInstallment && summary.months ? (
        <p className="text-xs text-zinc-800 tabular-nums">
          Estimativa ilustrativa ({summary.months}x):{' '}
          <strong>{formatBrlCurrency(summary.estimatedInstallment)}/mês</strong>
        </p>
      ) : null}

      <p className="text-[11px] text-zinc-500 leading-relaxed">{summary.note}</p>
    </div>
  );
};
