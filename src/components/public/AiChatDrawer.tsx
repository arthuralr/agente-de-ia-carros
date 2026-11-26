import React, { useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  ExternalLink,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  User,
  X,
} from 'lucide-react';
import {
  ChatMessage,
  DealershipSettings,
  Lead,
  Vehicle,
  VehicleCardData,
} from '../../types';
import { formatBRL } from '../../utils/formatters';
import { useVirtualConsultant } from '../../hooks/useVirtualConsultant';
import { ChatMarkdown } from './ChatMarkdown';
import {
  ChatComparisonBlock,
  ChatFinancingBlock,
  ChatVehicleCards,
} from './ChatVehicleCards';
import { WhatsAppHandoffModal } from './WhatsAppHandoffModal';

interface AiChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  targetVehicle: Vehicle | null;
  vehicles: Vehicle[];
  settings: DealershipSettings;
  onCaptureLead: (lead: Lead) => Promise<Lead>;
  onSyncLeadChat?: (leadId: string, chatHistory: ChatMessage[]) => Promise<void>;
  onOpenStandaloneChat?: () => void;
  onOpenPrivacy?: () => void;
}

export const AiChatDrawer: React.FC<AiChatDrawerProps> = ({
  isOpen,
  onClose,
  targetVehicle,
  vehicles,
  settings,
  onCaptureLead,
  onSyncLeadChat,
  onOpenStandaloneChat,
  onOpenPrivacy,
}) => {
  const [handoffOpen, setHandoffOpen] = useState(false);

  const {
    messages,
    input,
    setInput,
    isSending,
    hasStreamFirstToken,
    errorMsg,
    canRetry,
    retryLastMessage,
    compareVehicleIds,
    toggleCompareVehicle,
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
    active: isOpen,
    targetVehicle,
    vehicles,
    settings,
    originLabel: 'Vitrine',
    leadSourceLabel: 'Chat IA do Site',
    leadNote: 'Lead capturado pelo botão Tenho Interesse na vitrine pública.',
    onCaptureLead,
    onSyncLeadChat,
  });

  const handleOpenCardSheet = (card: VehicleCardData) => {
    onClose();
    window.history.pushState({}, '', `/veiculo/${encodeURIComponent(card.id)}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleNavigateInternal = (href: string) => {
    const match = href.match(/\/veiculo\/([^/?#]+)/i);
    if (match && match[1]) {
      onClose();
      window.history.pushState({}, '', href);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-md bg-[#111114] border-l border-white/[0.1] h-full flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-red-600/15 border border-red-600/30 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-red-500" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-sm font-semibold text-white truncate">
                {settings.aiAssistantName}
              </h2>
              <p className="text-xs text-zinc-400 truncate">
                {targetVehicle
                  ? `${targetVehicle.brand} ${targetVehicle.model} · ${formatBRL(targetVehicle.price)}`
                  : `${settings.tradeName} · Atendimento Online`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {onOpenStandaloneChat && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenStandaloneChat();
                }}
                title="Abrir página dedicada do consultor (/chat)"
                aria-label="Abrir página dedicada do consultor"
                className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/[0.05] transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar atendimento"
              className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/[0.05]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Lead Capture Form (Neon CRM Integration) */}
        <div className="px-5 py-3.5 bg-[#09090B] border-b border-white/[0.08]">
          {leadSaved ? (
            <div className="flex items-start gap-2 text-xs text-emerald-400">
              <Check className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-emerald-300">
                  Interesse registrado com sucesso!
                </p>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Nosso time comercial recebeu seu contato sobre{' '}
                  <strong className="text-zinc-200">
                    {targetVehicle
                      ? `${targetVehicle.brand} ${targetVehicle.model}`
                      : 'nosso estoque'}
                  </strong>{' '}
                  e continuará pelo WhatsApp {customerWhatsapp}.
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSaveContactToCrm} className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-zinc-200">
                  {targetVehicle
                    ? `Tenho interesse: ${targetVehicle.brand} ${targetVehicle.model}`
                    : 'Solicitar atendimento personalizado'}
                </p>
                <span className="text-[10px] text-zinc-500 whitespace-nowrap">
                  Laudo e simulação
                </span>
              </div>

              {leadSaveError && (
                <div className="px-2.5 py-1.5 rounded bg-red-950/60 border border-red-600/40 text-[11px] text-red-200 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  <span>{leadSaveError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Seu nome completo *"
                  disabled={isSavingLead}
                  className="px-2.5 py-2 bg-[#111114] border border-white/[0.1] rounded-md text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-600 disabled:opacity-60"
                />
                <input
                  type="tel"
                  required
                  value={customerWhatsapp}
                  onChange={(e) => setCustomerWhatsapp(e.target.value)}
                  placeholder="Telefone / WhatsApp *"
                  disabled={isSavingLead}
                  className="px-2.5 py-2 bg-[#111114] border border-white/[0.1] rounded-md text-xs text-white font-mono placeholder:text-zinc-500 focus:outline-none focus:border-red-600 disabled:opacity-60"
                />
              </div>

              <label className="flex items-start gap-2.5 text-[11px] text-zinc-400 leading-relaxed cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={lgpdConsent}
                  onChange={(e) => setLgpdConsent(e.target.checked)}
                  disabled={isSavingLead}
                  className="mt-0.5 h-4 w-4 rounded border-white/20 bg-[#111114] text-red-600 focus:ring-red-600 shrink-0"
                />
                <span>
                  Autorizo a coleta do meu <strong className="text-zinc-200">nome</strong> e{' '}
                  <strong className="text-zinc-200">telefone</strong> para atendimento comercial e
                  envio de ofertas de veículos pela {settings.tradeName}, conforme a{' '}
                  {onOpenPrivacy ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        onClose();
                        onOpenPrivacy();
                      }}
                      className="text-red-400 hover:text-red-300 underline underline-offset-2"
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
                className="w-full py-2 px-3 rounded-md text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
              >
                {isSavingLead ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Registrando interesse...</span>
                  </>
                ) : (
                  <span>Confirmar Interesse e Receber Contato</span>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
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
                      <span>{settings.aiAssistantName}</span>
                    </>
                  ) : (
                    <>
                      <User className="w-3 h-3 text-zinc-400" />
                      <span>Você</span>
                    </>
                  )}
                  <span>·</span>
                  <span className="font-mono tabular-nums">{msg.timestamp}</span>
                </div>

                <div
                  className={`max-w-[90%] rounded-xl px-4 py-3 ${
                    isAi
                      ? 'bg-[#18181C] text-zinc-200 border border-white/[0.08]'
                      : 'bg-red-600/20 text-zinc-100 border border-red-600/30'
                  }`}
                >
                  <ChatMarkdown
                    content={msg.text}
                    variant={isAi ? 'ai' : 'user'}
                    onNavigateInternal={handleNavigateInternal}
                  />
                  {isAi && msg.vehicleCards && msg.vehicleCards.length > 0 && (
                    <ChatVehicleCards
                      cards={msg.vehicleCards}
                      selectedCompareIds={compareVehicleIds}
                      onOpenSheet={handleOpenCardSheet}
                      onToggleCompare={(card) => toggleCompareVehicle(card.id)}
                      onSimulate={(card) =>
                        sendQuickPrompt(
                          `Quero simular financiamento do ${card.brand} ${card.model} ${card.year}`
                        )
                      }
                    />
                  )}
                  {isAi && msg.comparison && (
                    <ChatComparisonBlock
                      comparison={msg.comparison}
                      onOpenSheet={handleOpenCardSheet}
                    />
                  )}
                  {isAi && msg.financingSummary && (
                    <ChatFinancingBlock summary={msg.financingSummary} />
                  )}
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
            <div className="p-3 rounded-lg bg-red-950/50 border border-red-600/40 flex items-start gap-2 text-xs text-red-200">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p>{errorMsg}</p>
                <div className="flex flex-wrap items-center gap-2.5">
                  {canRetry && (
                    <button
                      type="button"
                      onClick={() => retryLastMessage()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-semibold"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Tentar novamente</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setHandoffOpen(true)}
                    className="inline-flex items-center gap-1.5 text-emerald-400 hover:underline font-medium"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>Falar com consultor no WhatsApp</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Consultation Actions + Input Footer */}
        <div className="border-t border-white/[0.08] bg-[#0D0D10]">
          <div className="px-4 pt-3 pb-1 flex items-center gap-1.5 overflow-x-auto">
            {[
              {
                label: 'Simular financiamento',
                prompt: targetVehicle
                  ? `Quais as opções de financiamento para o ${targetVehicle.brand} ${targetVehicle.model}?`
                  : 'Como funciona a simulação de financiamento na loja?',
              },
              {
                label: 'Avaliar troca',
                prompt: 'Vocês aceitam veículo usado na troca?',
              },
              {
                label: 'Agendar visita',
                prompt: 'Quais os horários para visita e test-drive no showroom?',
              },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={isSending}
                onClick={() => sendQuickPrompt(item.prompt)}
                className="px-2.5 py-1.5 rounded-md text-[11px] font-medium text-zinc-300 bg-white/[0.04] hover:bg-white/[0.09] hover:text-white border border-white/[0.08] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {item.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={handleSend}
            className="p-4 pt-2.5 flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pergunte sobre estoque, financiamento ou visita..."
              className="flex-1 px-3.5 py-2.5 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-xs text-white placeholder:text-zinc-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSending || !input.trim()}
              aria-label="Enviar mensagem"
              className="p-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white transition-colors shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      <WhatsAppHandoffModal
        isOpen={handoffOpen}
        onClose={() => setHandoffOpen(false)}
        settings={settings}
        purpose="sales"
        vehicleLabel={
          targetVehicle
            ? `${targetVehicle.brand} ${targetVehicle.model} ${targetVehicle.year}`
            : null
        }
        leadName={customerName}
        leadPhone={customerWhatsapp}
        messages={messages}
        vehicles={vehicles}
      />
    </div>
  );
};
