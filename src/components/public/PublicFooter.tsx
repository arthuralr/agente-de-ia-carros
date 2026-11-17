import React, { useState } from 'react';
import {
  Award,
  Instagram,
  MapPin,
  MessageCircle,
  Phone,
  ShieldCheck,
  X,
} from 'lucide-react';
import { DealershipSettings } from '../../types';
import { formatWhatsAppLink } from '../../utils/formatters';

interface PublicFooterProps {
  settings: DealershipSettings;
  onOpenAdmin: () => void;
}

export const PublicFooter: React.FC<PublicFooterProps> = ({
  settings,
  onOpenAdmin,
}) => {
  const [infoModal, setInfoModal] = useState<'address' | 'social' | null>(null);

  return (
    <footer className="border-t border-white/[0.08] bg-[#0B0B0E] mt-16">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-12 space-y-10">
        {/* Top Row: Brand + Security Seals + Quick Action Buttons */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="space-y-3 max-w-md">
            <div className="flex items-center gap-3">
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
              <span className="font-display font-semibold text-lg tracking-tight text-white">
                {settings.tradeName}
              </span>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              {settings.address}, {settings.city} - {settings.state} · Atendimento:{' '}
              {settings.hoursWeekdays} (Seg–Sex) e {settings.hoursSaturday} (Sáb).
            </p>
          </div>

          {/* Security Seals */}
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#111114] border border-white/[0.08] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">
                  Veículos Periciados
                </p>
                <p className="text-[11px] text-zinc-400">
                  Laudo cautelar 100% aprovado
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#111114] border border-white/[0.08] flex items-center justify-center shrink-0">
                <Award className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">
                  Garantia e Procedência
                </p>
                <p className="text-[11px] text-zinc-400">
                  Cobertura legal de {settings.warrantyDays} dias (CDC)
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Integrated Quick-Access Buttons */}
        <div className="pt-8 border-t border-white/[0.06] flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setInfoModal('address')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium text-zinc-200 bg-[#111114] hover:bg-white/[0.06] border border-white/[0.08] transition-colors whitespace-nowrap"
            >
              <MapPin className="w-3.5 h-3.5 text-red-500" />
              <span>Endereço da Loja</span>
            </button>

            <button
              type="button"
              onClick={() => setInfoModal('social')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium text-zinc-200 bg-[#111114] hover:bg-white/[0.06] border border-white/[0.08] transition-colors whitespace-nowrap"
            >
              <Instagram className="w-3.5 h-3.5 text-red-500" />
              <span>Redes Sociais</span>
            </button>

            <a
              href={formatWhatsAppLink(
                settings.whatsapp,
                `Olá! Gostaria de mais informações sobre o estoque da ${settings.tradeName}.`
              )}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors whitespace-nowrap"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>Contatos / WhatsApp</span>
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500">
            <span>
              © {new Date().getFullYear()} {settings.tradeName}. Todos os direitos
              reservados.
            </span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={onOpenAdmin}
              className="text-zinc-400 hover:text-white transition-colors underline underline-offset-4 whitespace-nowrap"
            >
              Painel Administrativo
            </button>
          </div>
        </div>
      </div>

      {/* Showroom Address / Social Modal */}
      {infoModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#111114] border border-white/[0.1] rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-white">
                {infoModal === 'address'
                  ? 'Endereço do Showroom'
                  : 'Redes Sociais & Canais'}
              </h3>
              <button
                type="button"
                onClick={() => setInfoModal(null)}
                className="p-2 text-zinc-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-sm">
              {infoModal === 'address' ? (
                <>
                  <div className="space-y-1">
                    <p className="font-semibold text-white">{settings.tradeName}</p>
                    <p className="text-xs text-zinc-300">{settings.address}</p>
                    <p className="text-xs text-zinc-400">
                      {settings.city} - {settings.state}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-lg bg-[#09090B] border border-white/[0.08] text-xs text-zinc-300 space-y-1">
                    <p>Segunda a Sexta: {settings.hoursWeekdays}</p>
                    <p>Sábados: {settings.hoursSaturday}</p>
                    <p>Domingos: {settings.hoursSunday}</p>
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <a
                      href={`https://maps.google.com/?q=${encodeURIComponent(
                        `${settings.address}, ${settings.city} - ${settings.state}`
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Abrir no Google Maps</span>
                    </a>
                    <a
                      href={`tel:${settings.phone.replace(/\D/g, '')}`}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08]"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Ligar</span>
                    </a>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-zinc-400">
                    Acompanhe as novidades diárias do showroom, avaliações em vídeo e
                    oportunidades exclusivas:
                  </p>
                  <div className="space-y-2">
                    <a
                      href="https://instagram.com"
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between p-3.5 rounded-lg bg-[#09090B] border border-white/[0.08] hover:border-red-600/40 text-xs text-white transition-colors"
                    >
                      <span>Instagram Oficial</span>
                      <span className="font-mono text-zinc-400">@armazemdocarro</span>
                    </a>
                    <a
                      href="https://tiktok.com"
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between p-3.5 rounded-lg bg-[#09090B] border border-white/[0.08] hover:border-red-600/40 text-xs text-white transition-colors"
                    >
                      <span>TikTok Showroom</span>
                      <span className="font-mono text-zinc-400">@armazemdocarro.sp</span>
                    </a>
                    <a
                      href={formatWhatsAppLink(settings.whatsapp)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between p-3.5 rounded-lg bg-[#09090B] border border-white/[0.08] hover:border-emerald-500/40 text-xs text-white transition-colors"
                    >
                      <span>WhatsApp Comercial</span>
                      <span className="font-mono text-emerald-400">
                        {settings.whatsapp}
                      </span>
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </footer>
  );
};
