import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  MessageCircle,
  Phone,
  ShieldCheck,
  X,
} from 'lucide-react';
import { ChatMessage, DealershipSettings, Vehicle } from '../../types';
import {
  buildWhatsAppHandoffUrl,
  HandoffPurpose,
  resolveWhatsAppDestination,
} from '../../utils/whatsappHandoff';
import {
  formatPhoneDisplay,
  getVehicleDisplayTitle,
} from '../../utils/vehicleDomain';

interface WhatsAppHandoffModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: DealershipSettings;
  fallbackWhatsapp?: string;
  purpose?: HandoffPurpose;
  focusedVehicle?: Vehicle | null;
  recentVehicles?: Vehicle[];
  baseUrl?: string;
  vehicleLabel?: string | null;
  contextSummary?: string | null;
  sessionId?: string | null;
  leadName?: string | null;
  leadPhone?: string | null;
  messages?: ChatMessage[];
  vehicles?: Vehicle[];
  onBeforeOpenWhatsApp?: (payload: {
    purpose: HandoffPurpose;
    text: string;
    destinationPhone: string;
    includeContactData: boolean;
  }) => void;
}

export const WhatsAppHandoffModal: React.FC<WhatsAppHandoffModalProps> = ({
  isOpen,
  onClose,
  settings,
  fallbackWhatsapp,
  purpose = 'sales',
  focusedVehicle = null,
  recentVehicles = [],
  baseUrl,
  vehicleLabel,
  contextSummary,
  sessionId,
  leadName,
  leadPhone,
  messages,
  vehicles,
  onBeforeOpenWhatsApp,
}) => {
  const [selectedPurpose, setSelectedPurpose] = useState<HandoffPurpose>(purpose);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(
    focusedVehicle?.id ? String(focusedVehicle.id) : ''
  );
  const [includeContactData, setIncludeContactData] = useState(false);
  const [customMessage, setCustomMessage] = useState('');
  const [isEdited, setIsEdited] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasSeparateFinancing = Boolean((settings.financingWhatsapp || '').trim());
  const selectableRecentVehicles = useMemo(() => {
    const seen = new Set<string>();
    const list: Vehicle[] = [];
    for (const v of recentVehicles) {
      if (!v || seen.has(String(v.id))) continue;
      seen.add(String(v.id));
      list.push(v);
    }
    return list;
  }, [recentVehicles]);
  const showVehicleSelector =
    !focusedVehicle && !vehicleLabel && selectableRecentVehicles.length >= 2;

  useEffect(() => {
    if (isOpen) {
      setSelectedPurpose(purpose);
      setSelectedVehicleId(focusedVehicle?.id ? String(focusedVehicle.id) : '');
      setIncludeContactData(false);
      setIsEdited(false);
      setCopied(false);
    }
  }, [isOpen, purpose, contextSummary, vehicleLabel, focusedVehicle]);

  const effectiveFocusedVehicle = useMemo(() => {
    if (focusedVehicle) return focusedVehicle;
    if (selectedVehicleId) {
      return (
        selectableRecentVehicles.find(
          (v) => String(v.id) === String(selectedVehicleId)
        ) ||
        (vehicles || []).find(
          (v) => String(v.id) === String(selectedVehicleId)
        ) ||
        null
      );
    }
    return null;
  }, [focusedVehicle, selectedVehicleId, selectableRecentVehicles, vehicles]);

  const destination = useMemo(
    () => resolveWhatsAppDestination(settings, selectedPurpose, fallbackWhatsapp),
    [settings, selectedPurpose, fallbackWhatsapp]
  );

  const computedHandoff = useMemo(
    () =>
      buildWhatsAppHandoffUrl({
        storeWhatsappNumber: destination.normalizedNumber,
        storeName: settings.tradeName,
        leadName,
        leadPhone,
        includeContactData,
        sessionId,
        contextSummary,
        vehicleLabel: effectiveFocusedVehicle ? null : vehicleLabel,
        focusedVehicle: effectiveFocusedVehicle,
        baseUrl:
          baseUrl ||
          (typeof window !== 'undefined' ? window.location.origin : ''),
        purpose: selectedPurpose,
        destinationLabel: destination.label,
        messages: showVehicleSelector && !selectedVehicleId ? [] : messages,
        vehicles,
      }),
    [
      destination.normalizedNumber,
      destination.label,
      settings.tradeName,
      leadName,
      leadPhone,
      includeContactData,
      sessionId,
      contextSummary,
      vehicleLabel,
      effectiveFocusedVehicle,
      baseUrl,
      selectedPurpose,
      showVehicleSelector,
      selectedVehicleId,
      messages,
      vehicles,
    ]
  );

  useEffect(() => {
    if (!isEdited) {
      setCustomMessage(computedHandoff.text);
    }
  }, [computedHandoff.text, isEdited]);

  const finalMessage = customMessage.trim() || computedHandoff.text;
  const finalUrl = destination.normalizedNumber
    ? `https://wa.me/${destination.normalizedNumber}?text=${encodeURIComponent(finalMessage)}`
    : `https://wa.me/?text=${encodeURIComponent(finalMessage)}`;

  const hasOptionalContact = Boolean((leadName || '').trim() || (leadPhone || '').trim());

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(finalMessage);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wa-handoff-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-white text-zinc-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="wa-handoff-modal-title"
              className="text-base font-semibold text-zinc-900 truncate"
            >
              Revisar mensagem antes de abrir o WhatsApp
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">
              {settings.tradeName} · Você decide o que enviar ao consultor
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela de contato"
            className="w-10 h-10 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-600 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Department selector when a separate financing WhatsApp is configured */}
          {hasSeparateFinancing && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-600">Destino do atendimento</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPurpose(purpose === 'visit' ? 'visit' : 'sales');
                    setIsEdited(false);
                  }}
                  className={`px-3 py-2.5 rounded-lg border text-left text-xs transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
                    selectedPurpose !== 'financing'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-semibold'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                  }`}
                >
                  <span className="block truncate">
                    {settings.salesWhatsappLabel || 'Consultor de Vendas'}
                  </span>
                  <span className="block text-[11px] font-normal text-zinc-500 tabular-nums mt-0.5">
                    {formatPhoneDisplay(settings.salesWhatsapp || settings.whatsapp)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPurpose('financing');
                    setIsEdited(false);
                  }}
                  className={`px-3 py-2.5 rounded-lg border text-left text-xs transition-colors min-h-[44px] focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
                    selectedPurpose === 'financing'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-950 font-semibold'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                  }`}
                >
                  <span className="block truncate">
                    {settings.financingWhatsappLabel || 'Financeiro / Simulação'}
                  </span>
                  <span className="block text-[11px] font-normal text-zinc-500 tabular-nums mt-0.5">
                    {formatPhoneDisplay(settings.financingWhatsapp)}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Optional vehicle picker when user discussed multiple vehicles with no single focus */}
          {showVehicleSelector && (
            <div className="space-y-1.5">
              <label
                htmlFor="wa-handoff-vehicle"
                className="block text-xs font-medium text-zinc-700"
              >
                Veículo de interesse na mensagem (opcional)
              </label>
              <select
                id="wa-handoff-vehicle"
                value={selectedVehicleId}
                onChange={(e) => {
                  setSelectedVehicleId(e.target.value);
                  setIsEdited(false);
                }}
                className="w-full min-h-[42px] rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
              >
                <option value="">Atendimento geral (sem veículo específico)</option>
                {selectableRecentVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {getVehicleDisplayTitle(v)} {v.year} (Ref. #{v.id})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Destination summary */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
                Canal configurado
              </p>
              <p className="text-sm font-semibold text-zinc-900 truncate">
                {destination.label}
              </p>
              <p className="text-xs text-zinc-600 tabular-nums flex items-center gap-1.5 mt-0.5">
                <Phone className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span>{formatPhoneDisplay(destination.normalizedNumber)}</span>
              </p>
            </div>
            {sessionId && (
              <span className="text-xs font-mono text-zinc-500 shrink-0">
                Ref #{computedHandoff.shortRef}
              </span>
            )}
          </div>

          {/* Editable message preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="wa-handoff-message"
                className="text-xs font-medium text-zinc-700"
              >
                Mensagem que será levada para o WhatsApp
              </label>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 px-2 py-1 rounded-md hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Copiada</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar texto</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              id="wa-handoff-message"
              rows={4}
              value={customMessage}
              onChange={(e) => {
                setCustomMessage(e.target.value);
                setIsEdited(true);
              }}
              className="w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 resize-y"
            />
          </div>

          {/* Opt-in for personal contact data */}
          {hasOptionalContact && (
            <label className="flex items-start gap-2.5 text-xs text-zinc-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeContactData}
                onChange={(e) => {
                  setIncludeContactData(e.target.checked);
                  setIsEdited(false);
                }}
                className="mt-0.5 w-4 h-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-600"
              />
              <span>
                Incluir meu nome/telefone informado na conversa (
                {[leadName, leadPhone].filter(Boolean).join(' · ')}) nesta mensagem
              </span>
            </label>
          )}

          <p className="text-[11px] text-zinc-500 flex items-start gap-1.5 leading-relaxed">
            <ShieldCheck className="w-3.5 h-3.5 text-zinc-400 shrink-0 mt-0.5" />
            <span>
              Nenhuma mensagem é enviada automaticamente. O WhatsApp só abrirá quando você clicar no botão abaixo.
            </span>
          </p>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-zinc-200 bg-zinc-50 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 min-h-[44px] rounded-xl border border-zinc-300 bg-white text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400"
          >
            Voltar
          </button>
          <a
            href={finalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              onBeforeOpenWhatsApp?.({
                purpose: selectedPurpose,
                text: finalMessage,
                destinationPhone: destination.normalizedNumber,
                includeContactData,
              });
              onClose();
            }}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
          >
            <MessageCircle className="w-4 h-4 shrink-0" />
            <span>Abrir WhatsApp</span>
            <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-85" />
          </a>
        </div>
      </div>
    </div>
  );
};
