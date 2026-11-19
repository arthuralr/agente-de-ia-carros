import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  Copy,
  Loader2,
  MapPin,
  MessageCircle,
  Send,
  ShieldCheck,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import {
  ChatMessage,
  DealershipSettings,
  Lead,
  Vehicle,
} from '../../types';
import { formatWhatsAppLink } from '../../utils/formatters';
import { useVirtualConsultant } from '../../hooks/useVirtualConsultant';
import { ChatMarkdown } from './ChatMarkdown';

interface StandaloneChatPageProps {
  vehicles: Vehicle[];
  settings: DealershipSettings;
  showBackToCatalog?: boolean;
  onCaptureLead: (lead: Lead) => Promise<Lead>;
  onSyncLeadChat?: (leadId: string, chatHistory: ChatMessage[]) => Promise<void>;
  onOpenCatalog: () => void;
  onOpenPrivacy?: () => void;
}

export const StandaloneChatPage: React.FC<StandaloneChatPageProps> = ({
  vehicles,
  settings,
  showBackToCatalog = true,
  onCaptureLead,
  onSyncLeadChat,
  onOpenCatalog,
  onOpenPrivacy,
}) => {
  // Permite personalização leve via query string (ex.: ?loja=Parceiro) para uso B2B em links externos
  const effectiveSettings = useMemo(() => {
    if (typeof window === 'undefined') return settings;
    const params = new URLSearchParams(window.location.search);
    const partnerStore = params.get('loja')?.trim();
    if (!partnerStore) return settings;
    return {
      ...settings,
      tradeName: partnerStore,
    };
  }, [settings]);

  const [leadPanelOpen, setLeadPanelOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const {
    messages,
    input,
    setInput,
    isSending,
    hasStreamFirstToken,
    errorMsg,
    customerName,
    setCustomerName,
    customerWhatsapp,
    setCustomerWhatsapp,
    lgpdConsent,
    setLgpdConsent,
    isSavingLead,
    leadSaveError,
    leadSaved,
    messagesEndRef,
    sendQuickPrompt,
    handleSend,
    handleSaveContactToCrm,
  } = useVirtualConsultant({
    active: true,
    targetVehicle: null,
    vehicles,
    settings: effectiveSettings,
    originLabel: '/chat',
    leadSourceLabel: 'Chat IA do Site',
    leadNote: 'Lead capturado pela página dedicada (/chat) estilo WhatsApp.',
    onCaptureLead,
    onSyncLeadChat,
  });

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const quickChips = [
    {
      label: 'Ver modelos disponíveis',
      prompt: 'Quais modelos vocês têm disponíveis no estoque hoje?',
    },
    {
      label: 'Simular financiamento',
      prompt: 'Como funciona o financiamento e quais as condições?',
    },
    {
      label: 'Avaliar troca',
      prompt: 'Vocês aceitam veículo usado na troca?',
    },
    {
      label: 'Agendar visita',
      prompt: 'Quais os horários e endereço para visita no showroom?',
    },
  ];

  const renderLeadFormBody = () => (
    <div className="space-y-4">
      {leadSaved ? (
        <div className="p-4 rounded-xl bg-[#E7FCEB] border border-[#00A884]/30 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[#00A884] text-white flex items-center justify-center shrink-0">
            <Check className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#111B21]">
              Contato confirmado!
            </p>
            <p className="text-xs text-[#3B4A54] mt-1 leading-relaxed">
              Registramos seu WhatsApp{' '}
              <strong className="font-mono text-[#111B21]">
                {customerWhatsapp}
              </strong>
              . Nossa equipe comercial continuará seu atendimento com todo o
              histórico desta conversa.
            </p>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSaveContactToCrm} className="space-y-3">
          <div className="space-y-1">
            <h3 className="font-display text-sm font-semibold text-[#111B21]">
              Receber Simulação & Laudo Cautelar
            </h3>
            <p className="text-xs text-[#54656F] leading-relaxed">
              Informe apenas seu nome e WhatsApp para receber atendimento
              prioritário do nosso time comercial.
            </p>
          </div>

          {leadSaveError && (
            <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{leadSaveError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#3B4A54] mb-1">
              Seu nome *
            </label>
            <input
              type="text"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Nome completo"
              disabled={isSavingLead}
              className="w-full min-h-[44px] px-3.5 py-2 bg-white border border-[#D1D7DB] focus:border-[#00A884] rounded-xl text-sm text-[#111B21] placeholder:text-[#8696A0] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#3B4A54] mb-1">
              WhatsApp *
            </label>
            <input
              type="tel"
              required
              value={customerWhatsapp}
              onChange={(e) => setCustomerWhatsapp(e.target.value)}
              placeholder="(11) 99999-9999"
              disabled={isSavingLead}
              className="w-full min-h-[44px] px-3.5 py-2 bg-white border border-[#D1D7DB] focus:border-[#00A884] rounded-xl text-sm text-[#111B21] font-mono placeholder:text-[#8696A0] focus:outline-none"
            />
          </div>

          <label className="flex items-start gap-2.5 pt-1 text-xs text-[#54656F] leading-relaxed cursor-pointer select-none">
            <input
              type="checkbox"
              checked={lgpdConsent}
              onChange={(e) => setLgpdConsent(e.target.checked)}
              disabled={isSavingLead}
              className="mt-0.5 h-4 w-4 rounded border-[#8696A0] text-[#00A884] focus:ring-[#00A884] shrink-0 accent-[#00A884]"
            />
            <span>
              Autorizo o uso do meu{' '}
              <strong className="text-[#111B21]">nome</strong> e{' '}
              <strong className="text-[#111B21]">WhatsApp</strong> para
              atendimento comercial e envio de ofertas de veículos, conforme a{' '}
              {onOpenPrivacy ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenPrivacy();
                  }}
                  className="text-[#008069] hover:underline font-medium"
                >
                  Política de Privacidade (LGPD)
                </button>
              ) : (
                <span>Política de Privacidade (LGPD)</span>
              )}
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={
              isSavingLead ||
              !customerName.trim() ||
              !customerWhatsapp.trim() ||
              !lgpdConsent
            }
            className="w-full min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-[#00A884] hover:bg-[#008F72] disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
          >
            {isSavingLead ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Salvando contato...</span>
              </>
            ) : (
              <span>Confirmar WhatsApp para Atendimento</span>
            )}
          </button>
        </form>
      )}

      {/* Dealership Assurance Info */}
      <div className="pt-4 border-t border-[#E9EDEF] space-y-3 text-xs text-[#54656F]">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-[#008069] shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-[#111B21]">
              Laudo Cautelar 100% Aprovado
            </p>
            <p className="text-[11px] text-[#667781] mt-0.5">
              Seminovos selecionados com garantia legal de{' '}
              {effectiveSettings.warrantyDays} dias (CDC).
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <MapPin className="w-4 h-4 text-[#008069] shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-[#111B21]">Showroom & Horários</p>
            <p className="text-[11px] text-[#667781] mt-0.5">
              {effectiveSettings.address} · {effectiveSettings.city}/
              {effectiveSettings.state}
            </p>
            <p className="text-[11px] text-[#667781] mt-0.5">
              Seg–Sex {effectiveSettings.hoursWeekdays} · Sáb{' '}
              {effectiveSettings.hoursSaturday}
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-dvh w-full bg-[#DADBD3] text-[#111B21] relative flex flex-col items-center justify-center overflow-hidden lg:py-5 lg:px-6">
      {/* Classic WhatsApp Web Top Green Strip on Desktop */}
      <div
        aria-hidden="true"
        className="hidden lg:block fixed top-0 inset-x-0 h-[128px] bg-[#00A884] z-0"
      />

      {/* Main WhatsApp App Container (100% Native Fullscreen on Mobile, Centered WhatsApp Web Frame on Desktop) */}
      <div className="relative z-10 w-full h-full lg:max-w-[1100px] lg:max-h-[920px] lg:rounded-lg lg:shadow-[0_12px_32px_rgba(11,20,26,0.18)] flex overflow-hidden bg-[#EFEAE2]">
        {/* Primary WhatsApp Conversation Column */}
        <div className="flex-1 min-w-0 h-full flex flex-col">
          {/* Official WhatsApp Dark Green Fixed Header (#075E54) */}
          <header className="h-[60px] shrink-0 bg-[#075E54] text-white px-2.5 sm:px-4 flex items-center justify-between gap-2 shadow-xs z-20">
            <div className="flex items-center gap-2 min-w-0">
              {showBackToCatalog && (
                <button
                  type="button"
                  onClick={onOpenCatalog}
                  aria-label="Voltar à vitrine"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-white/90 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}

              {/* Round Store Avatar + Green Online Dot */}
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-full bg-[#111B21] border border-white/25 flex items-center justify-center text-white shadow-xs">
                  <svg
                    viewBox="0 0 24 24"
                    className="w-5 h-5 text-white"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 16h18" />
                    <path d="M5 16l2.2-6.5A2 2 0 0 1 9.1 8h5.8a2 2 0 0 1 1.9 1.5L19 16" />
                    <circle cx="7.5" cy="16" r="1.5" fill="currentColor" />
                    <circle cx="16.5" cy="16" r="1.5" fill="currentColor" />
                  </svg>
                </div>
                <span
                  aria-label="Status online"
                  className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#25D366] ring-2 ring-[#075E54]"
                />
              </div>

              <div className="min-w-0 ml-1">
                <h1 className="font-display text-[15px] font-semibold leading-tight text-white truncate">
                  {effectiveSettings.tradeName}
                </h1>
                <p className="text-[12px] leading-tight text-[#D9FDD3] truncate">
                  {isSending ? 'digitando...' : 'online'}
                </p>
              </div>
            </div>

            {/* Header Right Actions: Lead Capture Trigger + Copy Direct Link */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setLeadPanelOpen((prev) => !prev)}
                className={`min-h-[40px] px-3 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                  leadSaved
                    ? 'bg-[#25D366]/20 text-[#D9FDD3] hover:bg-[#25D366]/30'
                    : 'bg-white/12 text-white hover:bg-white/20'
                }`}
              >
                {leadSaved ? (
                  <>
                    <UserCheck className="w-3.5 h-3.5 text-[#25D366]" />
                    <span className="hidden sm:inline">Contato salvo</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Simulação / Contato</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleCopyShareLink()}
                aria-label="Copiar link direto do atendimento"
                title="Copiar link direto"
                className="min-h-[40px] px-2.5 rounded-full text-xs font-medium text-white/90 hover:text-white hover:bg-white/10 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-4 h-4 text-[#25D366]" />
                    <span className="hidden md:inline">Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span className="hidden md:inline">Link</span>
                  </>
                )}
              </button>
            </div>
          </header>

          {/* Subtle Compact Lead Confirmation / Quick Trigger Banner (when lead not yet saved) */}
          {leadSaved && (
            <div className="shrink-0 bg-[#E7FCEB] border-b border-[#00A884]/20 px-4 py-1.5 flex items-center justify-between gap-2 text-[11px] text-[#075E54]">
              <span className="inline-flex items-center gap-1.5 truncate">
                <Check className="w-3.5 h-3.5 text-[#00A884] shrink-0" />
                <span className="truncate">
                  Atendimento vinculado ao WhatsApp{' '}
                  <strong className="font-mono">{customerWhatsapp}</strong>
                </span>
              </span>
            </div>
          )}

          {/* Scrollable Messages Area with Classic WhatsApp Wallpaper (#EFEAE2) */}
          <div className="flex-1 overflow-y-auto wa-chat-wallpaper px-3 sm:px-6 lg:px-10 py-4 space-y-2.5">
            {/* Classic Date Divider */}
            <div className="flex justify-center pb-1">
              <span className="px-3 py-1 rounded-lg bg-white/90 shadow-[0_1px_1px_rgba(11,20,26,0.1)] text-[11px] font-medium text-[#54656F] uppercase tracking-wide">
                Hoje
              </span>
            </div>

            {/* Subtle Encryption / Official Channel Notice */}
            <div className="flex justify-center pb-2">
              <p className="max-w-md text-center px-3.5 py-1.5 rounded-lg bg-[#FFF5C4]/95 shadow-[0_1px_1px_rgba(11,20,26,0.08)] text-[11.5px] text-[#54656F] leading-snug">
                Canal oficial de atendimento da{' '}
                <strong className="text-[#111B21]">
                  {effectiveSettings.tradeName}
                </strong>
                . Estoque atualizado em tempo real com laudo cautelar aprovado.
              </p>
            </div>

            {messages.map((msg) => {
              const isAi = msg.sender === 'ia';
              return (
                <div
                  key={msg.id}
                  className={`flex w-full ${
                    isAi ? 'justify-start' : 'justify-end'
                  }`}
                >
                  <div
                    className={`relative max-w-[88%] sm:max-w-[78%] lg:max-w-[72%] px-3 pt-2 pb-1.5 shadow-[0_1px_1px_rgba(11,20,26,0.13)] ${
                      isAi
                        ? 'bg-white text-[#111B21] rounded-lg rounded-tl-none ml-2'
                        : 'bg-[#D9FDD3] text-[#111B21] rounded-lg rounded-tr-none mr-2'
                    }`}
                  >
                    {/* Top Corner WhatsApp Bubble Tail */}
                    {isAi ? (
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 8 13"
                        width="8"
                        height="13"
                        className="absolute top-0 -left-[8px] text-white fill-current"
                      >
                        <path d="M1.533 3.568L8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z" />
                      </svg>
                    ) : (
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 8 13"
                        width="8"
                        height="13"
                        className="absolute top-0 -right-[8px] text-[#D9FDD3] fill-current"
                      >
                        <path d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" />
                      </svg>
                    )}

                    <div className="pr-1">
                      <ChatMarkdown
                        content={msg.text}
                        variant={isAi ? 'ai' : 'user'}
                        theme="whatsapp"
                      />
                    </div>

                    {/* Bottom-Right Timestamp + Blue Double Check on User Messages */}
                    <div className="mt-1 flex items-center justify-end gap-1 select-none">
                      <span className="text-[11px] leading-none text-[#667781] font-mono tabular-nums">
                        {msg.timestamp}
                      </span>
                      {!isAi && (
                        <CheckCheck
                          aria-label="Visualizada"
                          className="w-3.5 h-3.5 text-[#53BDEB] shrink-0"
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {isSending && !hasStreamFirstToken && (
              <div className="flex justify-start">
                <div className="relative bg-white text-[#54656F] rounded-lg rounded-tl-none ml-2 px-3.5 py-2.5 shadow-[0_1px_1px_rgba(11,20,26,0.13)] inline-flex items-center gap-2 text-xs">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 8 13"
                    width="8"
                    height="13"
                    className="absolute top-0 -left-[8px] text-white fill-current"
                  >
                    <path d="M1.533 3.568L8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z" />
                  </svg>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00A884]" />
                  <span>Digitando resposta...</span>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="flex justify-center">
                <div className="max-w-md p-3 rounded-lg bg-white border border-red-200 shadow-xs flex items-start gap-2.5 text-xs text-red-700">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <p>{errorMsg}</p>
                    <a
                      href={formatWhatsAppLink(
                        effectiveSettings.whatsapp,
                        `Olá! Gostaria de falar com um consultor da ${effectiveSettings.tradeName}.`
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[#008069] hover:underline font-semibold"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>Continuar no WhatsApp da loja</span>
                    </a>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Composer Dock (#F0F2F5) with Quick Suggestion Chips + Rounded Input + Circular Green Send */}
          <div className="shrink-0 bg-[#F0F2F5] border-t border-[#D1D7DB]/70 pb-[env(safe-area-inset-bottom)]">
            {/* Horizontal Scrollable Quick Chips */}
            <div className="px-3 sm:px-4 pt-2 pb-1 flex items-center gap-2 overflow-x-auto">
              {quickChips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  disabled={isSending}
                  onClick={() => sendQuickPrompt(chip.prompt)}
                  className="min-h-[36px] px-3.5 py-1.5 rounded-full text-xs font-medium text-[#111B21] bg-white hover:bg-[#E7FCEB] hover:text-[#075E54] border border-[#D1D7DB] shadow-[0_1px_1px_rgba(11,20,26,0.06)] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  {chip.label}
                </button>
              ))}
              {!leadSaved && (
                <button
                  type="button"
                  onClick={() => setLeadPanelOpen(true)}
                  className="min-h-[36px] px-3.5 py-1.5 rounded-full text-xs font-semibold text-[#075E54] bg-[#D9FDD3] hover:bg-[#C7F5C0] border border-[#00A884]/30 transition-colors whitespace-nowrap shrink-0"
                >
                  Deixar meu WhatsApp
                </button>
              )}
            </div>

            {/* WhatsApp Rounded White Input + Circular #00A884 Send Button */}
            <form
              onSubmit={handleSend}
              className="px-3 sm:px-4 py-2.5 flex items-center gap-2.5"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Mensagem"
                className="flex-1 min-h-[44px] px-4 py-2 bg-white border border-transparent focus:border-[#00A884]/50 rounded-full text-[15px] text-[#111B21] placeholder:text-[#667781] shadow-[0_1px_1px_rgba(11,20,26,0.08)] focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSending || !input.trim()}
                aria-label="Enviar mensagem"
                className="w-[44px] h-[44px] rounded-full bg-[#00A884] hover:bg-[#008F72] disabled:bg-[#8696A0] text-white shadow-xs transition-colors shrink-0 inline-flex items-center justify-center active:scale-95"
              >
                <Send className="w-4 h-4 translate-x-[1px]" />
              </button>
            </form>
          </div>
        </div>

        {/* Desktop Collapsible Side Panel for LGPD Lead Capture (keeps WhatsApp Web aesthetic intact) */}
        {leadPanelOpen && (
          <aside className="hidden lg:flex w-[340px] shrink-0 h-full bg-[#F8F9FA] border-l border-[#D1D7DB] flex-col">
            <div className="h-[60px] shrink-0 px-4 bg-[#075E54] text-white flex items-center justify-between gap-2 border-l border-white/10">
              <span className="text-sm font-semibold">Dados do Atendimento</span>
              <button
                type="button"
                onClick={() => setLeadPanelOpen(false)}
                aria-label="Fechar painel de contato"
                className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center text-white/90"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">{renderLeadFormBody()}</div>
          </aside>
        )}
      </div>

      {/* Mobile Compact Bottom Sheet Modal for LGPD Lead Capture */}
      {leadPanelOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/55 flex items-end justify-center"
          onClick={() => setLeadPanelOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-[#F8F9FA] rounded-t-3xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-h-[88dvh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 rounded-full bg-[#D1D7DB] mx-auto mb-3" />
            <div className="flex items-center justify-between mb-3">
              <span className="font-display text-sm font-semibold text-[#111B21]">
                Atendimento & Simulação
              </span>
              <button
                type="button"
                onClick={() => setLeadPanelOpen(false)}
                aria-label="Fechar formulário"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-[#54656F] hover:bg-black/5"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderLeadFormBody()}
          </div>
        </div>
      )}
    </div>
  );
};
