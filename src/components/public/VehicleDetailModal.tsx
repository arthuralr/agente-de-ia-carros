import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  MessageSquare,
  ShieldCheck,
  X,
} from 'lucide-react';
import { DealershipSettings, Vehicle } from '../../types';
import { inferVehicleCategory } from '../../data/mockData';
import { formatBRL, formatKm, formatWhatsAppLink } from '../../utils/formatters';
import { VehicleImage } from '../VehicleImage';

interface VehicleDetailModalProps {
  vehicle: Vehicle | null;
  settings: DealershipSettings;
  onClose: () => void;
  onInterest: (vehicle: Vehicle) => void;
}

export const VehicleDetailModal: React.FC<VehicleDetailModalProps> = ({
  vehicle,
  settings,
  onClose,
  onInterest,
}) => {
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  useEffect(() => {
    setActivePhotoIndex(0);
  }, [vehicle]);

  if (!vehicle) return null;

  const photos =
    vehicle.gallery && vehicle.gallery.length > 0
      ? vehicle.gallery
      : [vehicle.imageUrl];
  const category = inferVehicleCategory(vehicle);

  const handlePrev = () => {
    setActivePhotoIndex((prev) => (prev === 0 ? photos.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setActivePhotoIndex((prev) => (prev === photos.length - 1 ? 0 : prev + 1));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#111114] border border-white/[0.1] rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-zinc-400">
              {category} · {vehicle.year} · {vehicle.status}
            </p>
            <h2 className="font-display text-lg font-semibold text-white truncate">
              {vehicle.brand} {vehicle.model} {vehicle.version}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar ficha técnica"
            className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/[0.05] shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Photo Gallery */}
            <div className="lg:col-span-7 space-y-3">
              <div className="relative aspect-[4/3] w-full rounded-xl overflow-hidden bg-zinc-950 border border-white/[0.08]">
                <VehicleImage
                  src={photos[activePhotoIndex]}
                  alt={`${vehicle.brand} ${vehicle.model} — foto ${activePhotoIndex + 1}`}
                />

                {photos.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={handlePrev}
                      aria-label="Foto anterior"
                      className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-black/65 hover:bg-black/85 text-white border border-white/10 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleNext}
                      aria-label="Próxima foto"
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg bg-black/65 hover:bg-black/85 text-white border border-white/10 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>

              {/* Thumbnails */}
              {photos.length > 1 && (
                <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                  {photos.map((photo, idx) => (
                    <button
                      key={`${photo}-${idx}`}
                      type="button"
                      onClick={() => setActivePhotoIndex(idx)}
                      className={`w-24 aspect-[4/3] rounded-lg overflow-hidden shrink-0 border transition-all ${
                        idx === activePhotoIndex
                          ? 'border-red-600 ring-1 ring-red-600'
                          : 'border-white/[0.08] opacity-60 hover:opacity-100'
                      }`}
                    >
                      <VehicleImage
                        src={photo}
                        alt={`Miniatura ${idx + 1}`}
                      />
                    </button>
                  ))}
                </div>
              )}

              {/* Optionals */}
              {vehicle.optionals.length > 0 && (
                <div className="pt-4 border-t border-white/[0.08]">
                  <h3 className="font-display text-sm font-semibold text-white mb-3">
                    Principais Opcionais & Equipamentos
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {vehicle.optionals.map((opt) => (
                      <div
                        key={opt}
                        className="flex items-center gap-2 text-xs text-zinc-300"
                      >
                        <Check className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        <span>{opt}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Technical Sheet & Purchase Actions */}
            <div className="lg:col-span-5 space-y-6">
              <div className="p-5 rounded-xl bg-[#09090B] border border-white/[0.08]">
                <p className="text-xs text-zinc-400">Valor à vista</p>
                <p className="font-mono text-3xl font-semibold text-white tabular-nums mt-1">
                  {formatBRL(vehicle.price)}
                </p>
                {vehicle.fipePrice > 0 && (
                  <p className="text-xs text-zinc-500 font-mono tabular-nums mt-1">
                    Referência Tabela FIPE: {formatBRL(vehicle.fipePrice)}
                  </p>
                )}

                <div className="mt-5 space-y-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onInterest(vehicle);
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>Tenho Interesse (Chat IA)</span>
                  </button>

                  <a
                    href={formatWhatsAppLink(
                      settings.whatsapp,
                      `Olá! Vi o ${vehicle.brand} ${vehicle.model} ${vehicle.version} (${vehicle.year}) no site da ${settings.tradeName} e gostaria de agendar uma visita.`
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] transition-colors"
                  >
                    <MessageCircle className="w-4 h-4 text-emerald-400" />
                    <span>Falar no WhatsApp ({settings.whatsapp})</span>
                  </a>
                </div>
              </div>

              {/* Technical Specs */}
              <div>
                <h3 className="font-display text-sm font-semibold text-white mb-3">
                  Ficha Técnica
                </h3>
                <dl className="divide-y divide-white/[0.06] border-t border-b border-white/[0.06] text-xs">
                  <div className="py-2.5 flex justify-between gap-4">
                    <dt className="text-zinc-400">Marca / Modelo</dt>
                    <dd className="text-zinc-100 font-medium text-right">
                      {vehicle.brand} {vehicle.model}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between gap-4">
                    <dt className="text-zinc-400">Categoria</dt>
                    <dd className="text-zinc-100 font-medium text-right">
                      {category}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between gap-4">
                    <dt className="text-zinc-400">Ano Fab / Mod</dt>
                    <dd className="text-zinc-100 font-mono tabular-nums text-right">
                      {vehicle.year}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between gap-4">
                    <dt className="text-zinc-400">Quilometragem</dt>
                    <dd className="text-zinc-100 font-mono tabular-nums text-right">
                      {formatKm(vehicle.km)}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between gap-4">
                    <dt className="text-zinc-400">Câmbio</dt>
                    <dd className="text-zinc-100 text-right">
                      {vehicle.transmission}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between gap-4">
                    <dt className="text-zinc-400">Combustível</dt>
                    <dd className="text-zinc-100 text-right">{vehicle.fuel}</dd>
                  </div>
                  <div className="py-2.5 flex justify-between gap-4">
                    <dt className="text-zinc-400">Cor</dt>
                    <dd className="text-zinc-100 text-right">{vehicle.color}</dd>
                  </div>
                  <div className="py-2.5 flex justify-between gap-4">
                    <dt className="text-zinc-400">Final da Placa</dt>
                    <dd className="text-zinc-100 font-mono text-right">
                      {vehicle.plate ? vehicle.plate.slice(-1) : 'N/I'}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Assurance Block */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-[#09090B] border border-white/[0.06]">
                <ShieldCheck className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-white">
                    Laudo Cautelar 100% Aprovado
                  </p>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Veículo periciado com histórico conferido e garantia de{' '}
                    {settings.warrantyDays} dias ({settings.warrantyKm.toLocaleString('pt-BR')} km)
                    conforme o Código de Defesa do Consumidor.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
