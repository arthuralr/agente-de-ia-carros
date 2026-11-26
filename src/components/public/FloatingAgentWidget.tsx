import React from 'react';
import { DealershipSettings, Vehicle } from '../../types';
import { getVehicleDisplayTitle } from '../../utils/vehicleDomain';

interface FloatingAgentWidgetProps {
  settings: DealershipSettings;
  activeVehicle?: Vehicle | null;
  onOpenChat: (vehicle?: Vehicle | null) => void;
  previewMode?: boolean;
}

/**
 * Modern 3D-depth floating agent button for internal public pages (never mounted on /chat).
 * Shares the exact visual language of the external dealership embed script (/widget.js).
 */
export const FloatingAgentWidget: React.FC<FloatingAgentWidgetProps> = ({
  settings,
  activeVehicle = null,
  onOpenChat,
  previewMode = false,
}) => {
  if (!previewMode && settings.widgetEnabled === false) {
    return null;
  }

  const label = (settings.widgetLabel || '').trim() || 'Fale com o agente';
  const position = settings.widgetPosition === 'bottom-left' ? 'bottom-left' : 'bottom-right';
  const vehicleTitle = activeVehicle ? getVehicleDisplayTitle(activeVehicle) : null;
  const chatHref = activeVehicle
    ? `/chat?veiculo=${encodeURIComponent(String(activeVehicle.id))}&origem=widget_flutuante`
    : '/chat?origem=widget_flutuante';

  const ariaLabel = vehicleTitle
    ? `${label} sobre ${vehicleTitle}`
    : `${label} — ${settings.tradeName}`;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (previewMode) {
      e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    onOpenChat(activeVehicle);
  };

  const triggerElement = (
    <a
      href={chatHref}
      onClick={handleClick}
      aria-label={ariaLabel}
      data-armazem-floating-agent="true"
      className="group relative inline-flex items-center gap-3 pl-2.5 pr-4 py-2 rounded-full bg-gradient-to-b from-[#18181D] to-[#0D0D10] text-white border border-white/[0.14] shadow-[0_14px_30px_-8px_rgba(0,0,0,0.68),0_4px_12px_rgba(220,38,38,0.28),inset_0_1px_0_rgba(255,255,255,0.16)] hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-8px_rgba(0,0,0,0.75),0_8px_20px_rgba(220,38,38,0.38),inset_0_1px_0_rgba(255,255,255,0.24)] active:translate-y-0 transition-all duration-200 motion-reduce:transition-none motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090B] select-none cursor-pointer"
    >
      {/* 3D Crimson Specular Orb with Original Automotive + Chat SVG Emblem */}
      <span
        aria-hidden="true"
        className="relative w-11 h-11 rounded-full shrink-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_26%,#FF5E5E_0%,#DC2626_52%,#8E1212_100%)] shadow-[inset_0_2px_4px_rgba(255,255,255,0.42),inset_0_-3px_6px_rgba(69,10,10,0.7),0_6px_14px_rgba(220,38,38,0.45)] group-hover:scale-[1.04] transition-transform duration-200 motion-reduce:transition-none motion-reduce:transform-none"
      >
        <span className="pointer-events-none absolute top-1 left-2 w-4 h-2 rounded-full bg-white/35 blur-[1px]" />
        <svg
          viewBox="0 0 28 28"
          className="relative w-6 h-6 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Sleek chat speech contour */}
          <path d="M5.5 19.5V9.5a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v5.5a4 4 0 0 1-4 4H11l-4.2 3.2c-.6.45-1.3 0-1.3-.7v-2z" />
          {/* Minimal automotive silhouette inside */}
          <path d="M8.8 14.5h10.4" strokeWidth="1.8" />
          <path d="M10.2 14.5l1.1-3.1a1.5 1.5 0 0 1 1.4-1h2.6a1.5 1.5 0 0 1 1.4 1l1.1 3.1" strokeWidth="1.7" />
          <circle cx="11.2" cy="14.7" r="1.05" fill="currentColor" stroke="none" />
          <circle cx="16.8" cy="14.7" r="1.05" fill="currentColor" stroke="none" />
        </svg>
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-[#111114]"
        />
      </span>

      <span className="flex flex-col text-left leading-tight pr-0.5">
        <span className="text-[13px] font-semibold tracking-tight text-white whitespace-nowrap">
          {label}
        </span>
        <span className="text-[11px] text-zinc-400 whitespace-nowrap max-w-[168px] truncate">
          {vehicleTitle ? `Sobre ${vehicleTitle}` : settings.tradeName}
        </span>
      </span>
    </a>
  );

  if (previewMode) {
    return (
      <div
        className={`relative w-full min-h-[120px] rounded-xl border border-white/[0.08] bg-[radial-gradient(circle_at_top,#1B1B22_0%,#0B0B0E_70%)] p-4 flex items-end ${
          position === 'bottom-left' ? 'justify-start' : 'justify-end'
        }`}
      >
        <span className="absolute top-3 left-3.5 text-[11px] font-medium text-zinc-400">
          Pré-visualização do botão flutuante ({position === 'bottom-left' ? 'inferior esquerdo' : 'inferior direito'})
        </span>
        {triggerElement}
      </div>
    );
  }

  return (
    <div
      className={`fixed z-40 bottom-[max(1.25rem,env(safe-area-inset-bottom))] ${
        position === 'bottom-left' ? 'left-4 sm:left-6' : 'right-4 sm:right-6'
      }`}
    >
      {triggerElement}
    </div>
  );
};
