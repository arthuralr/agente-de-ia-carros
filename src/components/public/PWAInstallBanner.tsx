import React, { useEffect, useState } from 'react';
import { Download, PlusSquare, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

interface PWAInstallBannerProps {
  variant?: 'whatsapp' | 'storefront';
  appName?: string;
  suppressed?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

export const PWAInstallBanner: React.FC<PWAInstallBannerProps> = ({
  variant = 'whatsapp',
  appName = 'Armazém do Carro',
  suppressed = false,
  onVisibilityChange,
}) => {
  const {
    canPromptNative,
    isIosSafari,
    canShowBanner,
    promptInstall,
    dismissBanner,
  } = usePWAInstall();
  const [iosGuideOpen, setIosGuideOpen] = useState(false);

  const isVisible = !suppressed && canShowBanner;

  useEffect(() => {
    onVisibilityChange?.(isVisible);
  }, [isVisible, onVisibilityChange]);

  if (!isVisible) return null;

  const isWhatsapp = variant === 'whatsapp';

  const handleActionClick = () => {
    if (canPromptNative) {
      void promptInstall();
    } else if (isIosSafari) {
      setIosGuideOpen((prev) => !prev);
    }
  };

  return (
    <div
      className={
        isWhatsapp
          ? 'shrink-0 bg-[#E7FCEB] border-b border-[#00A884]/25 px-3 sm:px-4 py-2 text-[#111B21]'
          : 'fixed bottom-4 inset-x-3 sm:left-auto sm:right-5 sm:max-w-sm z-40 rounded-2xl bg-[#111114]/95 backdrop-blur-md border border-white/[0.12] shadow-2xl p-3.5 text-zinc-100'
      }
    >
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
              isWhatsapp
                ? 'bg-[#075E54] text-white'
                : 'bg-emerald-600/20 border border-emerald-500/35 text-emerald-400'
            }`}
          >
            <Smartphone className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p
              className={`text-xs font-semibold leading-tight truncate ${
                isWhatsapp ? 'text-[#111B21]' : 'text-white'
              }`}
            >
              Instale o app {appName}
            </p>
            <p
              className={`text-[11px] leading-snug truncate ${
                isWhatsapp ? 'text-[#3B4A54]' : 'text-zinc-400'
              }`}
            >
              Acesso rápido ao consultor direto na tela inicial
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleActionClick}
            className={`min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              isWhatsapp
                ? 'bg-[#00A884] hover:bg-[#008F72] text-white shadow-xs'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>{canPromptNative ? 'Instalar App' : 'Como Instalar'}</span>
          </button>

          <button
            type="button"
            onClick={dismissBanner}
            aria-label="Fechar aviso de instalação do app"
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
              isWhatsapp
                ? 'text-[#54656F] hover:bg-black/5'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.08]'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isIosSafari && iosGuideOpen && (
        <div
          className={`mt-2.5 pt-2.5 border-t text-[11.5px] leading-relaxed flex flex-col gap-1.5 ${
            isWhatsapp
              ? 'border-[#00A884]/20 text-[#3B4A54]'
              : 'border-white/[0.08] text-zinc-300'
          }`}
        >
          <p className="inline-flex items-center gap-1.5 flex-wrap">
            <span>1. Toque no ícone</span>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold ${
                isWhatsapp
                  ? 'bg-white text-[#075E54] border border-[#D1D7DB]'
                  : 'bg-white/10 text-white'
              }`}
            >
              <Share className="w-3 h-3" />
              Compartilhar
            </span>
            <span>na barra do Safari.</span>
          </p>
          <p className="inline-flex items-center gap-1.5 flex-wrap">
            <span>2. Escolha</span>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold ${
                isWhatsapp
                  ? 'bg-white text-[#075E54] border border-[#D1D7DB]'
                  : 'bg-white/10 text-white'
              }`}
            >
              <PlusSquare className="w-3 h-3" />
              Adicionar à Tela de Início
            </span>
            <span>e toque em Adicionar.</span>
          </p>
        </div>
      )}
    </div>
  );
};
