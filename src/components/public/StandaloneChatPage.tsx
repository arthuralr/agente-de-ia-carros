import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  MapPin,
  MessageCircle,
  Send,
  ShieldCheck,
  User,
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
  onCaptureLead: (lead: Lead) => Promise<Lead>;
  onSyncLeadChat?: (leadId: string, chatHistory: ChatMessage[]) => Promise<void>;
  onOpenCatalog: () => void;
}

export const StandaloneChatPage: React.FC<StandaloneChatPageProps> = ({
  vehicles,
  settings,
  onCaptureLead,
  onSyncLeadChat,
  onOpenCatalog,
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

  const [mobileLeadOpen, setMobileLeadOpen] = useState(false);
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
    leadSourceLabel: 'Chat IA do Site',
    leadNote: 'Lead capturado pela página dedicada (/chat).',
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

  return (
    <div className="h-dvh bg-[#09090B] text-zinc-100 flex flex-col overflow-hidden">
      {/* Compact Top App Bar (56px, <=15% sticky height cap) */}
      <header className="h-14 shrink-0 border-b border-white/[0.08] bg-[#0B0B0E]/95 backdrop-blur-md px-3 sm:px-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onOpenCatalog}
            aria-label="Voltar à vitrine"
            className="min-h-[44px] min-w-[44px] lg:min-w-0 lg:px-3 flex items-center justify-center gap-2 rounded-xl text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span className="hidden lg:inline whitespace-nowrap">Vitrine</span>
          </button>

          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-red-600/15 border border-red-600/30 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-red-500" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-sm font-semibold text-white truncate">
                {effectiveSettings.tradeName}
              </h1>
              <p className="text-[11px] text-zinc-400 truncate">
                {effectiveSettings.aiAssistantName} · Atendimento Direto
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void handleCopyShareLink()}
            className="min-h-[44px] px-3 rounded-xl text-xs font-medium text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {copiedLink ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Link copiado</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-zinc-400" />
                <span className="hidden sm:inline">Copiar link</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Responsive Workspace: Single-Column Mobile-First -> 2-Column Executive Workspace on Desktop */}
      <div className="flex-1 min-h-0 max-w-6xl w-full mx-auto lg:p-6 lg:grid lg:grid-cols-[340px_1fr] lg:gap-6 flex flex-col">
        {/* Desktop Sidebar Column: Dealership Guarantees + Direct Lead Capture */}
        <aside className="hidden lg:flex flex-col gap-4 min-h-0">
          <div className="bg-[#111114] border border-white/[0.08] rounded-2xl p-6 space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-medium text-red-500">
                Consultor Virtual Oficial
              </p>
              <h2 className="font-display text-xl font-semibold text-white tracking-tight">
                Atendimento Especializado em Seminovos
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Consulte disponibilidade em tempo real, simule financiamento e
                agende sua visita sem precisar navegar pelo catálogo.
              </p>
            </div>

            <div className="space-y-3 pt-4 border-t border-white/[0.08] text-xs text-zinc-300">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-white">
                    Laudo Cautelar 100% Aprovado
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    Garantia legal de {effectiveSettings.warrantyDays} dias (CDC)
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-white">Showroom & Horários</p>
                  <p className="text-[11px] text-zinc-400">
                    {effectiveSettings.address}, {effectiveSettings.city}/
                    {effectiveSettings.state}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Seg–Sex {effectiveSettings.hoursWeekdays} · Sáb{' '}
                    {effectiveSettings.hoursSaturday}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#111114] border border-white/[0.08] rounded-2xl p-6">
            {leadSaved ? (
              <div className="flex items-start gap-2.5 text-xs text-emerald-400">
                <Check className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-emerald-300">
                    Atendimento vinculado ao CRM!
                  </p>
                  <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                    Recebemos seu contato ({customerWhatsapp}). A conversa com o
                    Consultor Virtual continua sincronizada com nossa equipe.
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveContactToCrm} className="space-y-3">
                <div>
                  <h3 className="font-display text-sm font-semibold text-white">
                    Receber Simulação & Laudo
                  </h3>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Deixe seu contato para retorno prioritário via WhatsApp.
                  </p>
                </div>

                {leadSaveError && (
                  <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-600/40 text-[11px] text-red-200 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span>{leadSaveError}</span>
                  </div>
                )}

                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Seu nome completo *"
                  disabled={isSavingLead}
                  className="w-full px-3 py-2.5 bg-[#09090B] border border-white/[0.1] rounded-xl text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-600"
                />
                <input
                  type="tel"
                  required
                  value={customerWhatsapp}
                  onChange={(e) => setCustomerWhatsapp(e.target.value)}
                  placeholder="WhatsApp (11) 99999-9999 *"
                  disabled={isSavingLead}
                  className="w-full px-3 py-2.5 bg-[#09090B] border border-white/[0.1] rounded-xl text-xs text-white font-mono placeholder:text-zinc-500 focus:outline-none focus:border-red-600"
                />

                <button
                  type="submit"
                  disabled={
                    isSavingLead ||
                    !customerName.trim() ||
                    !customerWhatsapp.trim()
                  }
                  className="w-full min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
                >
                  {isSavingLead ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Enviando...</span>
                    </>
                  ) : (
                    <span>Solicitar Contato Prioritário</span>
                  )}
                </button>
              </form>
            )}
          </div>
        </aside>

        {/* Conversation Surface (Full-Screen Mobile + Elevated Panel on Desktop) */}
        <section className="flex-1 min-h-0 flex flex-col bg-[#09090B] lg:bg-[#111114] lg:border lg:border-white/[0.08] lg:rounded-2xl overflow-hidden">
          {/* Mobile Collapsible Lead Capture Strip (keeps >=85% screen open for chat) */}
          <div className="lg:hidden shrink-0 border-b border-white/[0.08] bg-[#111114]">
            {leadSaved ? (
              <div className="px-4 py-2.5 flex items-center gap-2 text-xs text-emerald-300">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="truncate">
                  Contato registrado para retorno no WhatsApp {customerWhatsapp}.
                </span>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setMobileLeadOpen((prev) => !prev)}
                  className="w-full min-h-[44px] px-4 py-2 flex items-center justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white truncate">
                      Receber simulação e laudo no WhatsApp
                    </p>
                    <p className="text-[11px] text-zinc-400 truncate">
                      Toque para informar seu nome e número
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400 shrink-0">
                    <span>{mobileLeadOpen ? 'Fechar' : 'Informar'}</span>
                    {mobileLeadOpen ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </span>
                </button>

                {mobileLeadOpen && (
                  <form
                    onSubmit={handleSaveContactToCrm}
                    className="px-4 pb-4 pt-1 space-y-2.5 border-t border-white/[0.06]"
                  >
                    {leadSaveError && (
                      <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-600/40 text-[11px] text-red-200 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        <span>{leadSaveError}</span>
                      </div>
                    )}
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Seu nome completo *"
                      disabled={isSavingLead}
                      className="w-full min-h-[44px] px-3.5 py-2 bg-[#09090B] border border-white/[0.1] rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-600"
                    />
                    <input
                      type="tel"
                      required
                      value={customerWhatsapp}
                      onChange={(e) => setCustomerWhatsapp(e.target.value)}
                      placeholder="WhatsApp (11) 99999-9999 *"
                      disabled={isSavingLead}
                      className="w-full min-h-[44px] px-3.5 py-2 bg-[#09090B] border border-white/[0.1] rounded-xl text-sm text-white font-mono placeholder:text-zinc-500 focus:outline-none focus:border-red-600"
                    />
                    <button
                      type="submit"
                      disabled={
                        isSavingLead ||
                        !customerName.trim() ||
                        !customerWhatsapp.trim()
                      }
                      className="w-full min-h-[44px] py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
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
              </>
            )}
          </div>

          {/* Scrollable Messages Feed */}
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 space-y-4">
            {messages.map((msg) => {
              const isAi = msg.sender === 'ia';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isAi ? 'items-start' : 'items-end'}`}
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mb-1">
                    {isAi ? (
                      <>
                        <Bot className="w-3 h-3 text-red-500" />
                        <span>{effectiveSettings.aiAssistantName}</span>
                      </>
                    ) : (
                      <>
                        <User className="w-3 h-3 text-zinc-400" />
                        <span>Você</span>
                      </>
                    )}
                    <span>·</span>
                    <span className="font-mono tabular-nums">
                      {msg.timestamp}
                    </span>
                  </div>

                  <div
                    className={`max-w-[92%] sm:max-w-[82%] rounded-2xl px-4 py-3 ${
                      isAi
                        ? 'bg-[#18181C] text-zinc-200 border border-white/[0.08]'
                        : 'bg-red-600/20 text-zinc-100 border border-red-600/30'
                    }`}
                  >
                    <ChatMarkdown
                      content={msg.text}
                      variant={isAi ? 'ai' : 'user'}
                    />
                  </div>
                </div>
              );
            })}

            {isSending && !hasStreamFirstToken && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" />
                <span>Consultor digitando...</span>
              </div>
            )}

            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-red-950/50 border border-red-600/40 flex items-start gap-2.5 text-xs text-red-200">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <p>{errorMsg}</p>
                  <a
                    href={formatWhatsAppLink(
                      effectiveSettings.whatsapp,
                      `Olá! Gostaria de falar com um consultor da ${effectiveSettings.tradeName}.`
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-emerald-400 hover:underline font-medium"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>Continuar diretamente pelo WhatsApp</span>
                  </a>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Thumb-Zone Bottom Dock (44px+ interactive touch targets) */}
          <div className="shrink-0 border-t border-white/[0.08] bg-[#0D0D10] pb-[env(safe-area-inset-bottom)]">
            <div className="px-3 sm:px-5 pt-2.5 pb-1 flex items-center gap-2 overflow-x-auto">
              {[
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
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  disabled={isSending}
                  onClick={() => sendQuickPrompt(item.prompt)}
                  className="min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-medium text-zinc-300 bg-white/[0.04] hover:bg-white/[0.09] hover:text-white border border-white/[0.08] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  {item.label}
                </button>
              ))}
            </div>

            <form
              onSubmit={handleSend}
              className="p-3 sm:px-5 sm:py-3.5 flex items-center gap-2.5"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Digite o modelo ou dúvida sobre financiamento..."
                className="flex-1 min-h-[46px] px-4 py-2.5 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-xl text-sm text-white placeholder:text-zinc-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSending || !input.trim()}
                aria-label="Enviar mensagem"
                className="min-h-[46px] min-w-[46px] px-4 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white transition-colors shrink-0 inline-flex items-center justify-center active:scale-[0.98]"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
};
