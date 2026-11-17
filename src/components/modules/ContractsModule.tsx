import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  FileCheck2,
  FileText,
  History,
  Loader2,
  Printer,
  RefreshCw,
} from 'lucide-react';
import {
  ContractRecord,
  DealershipSettings,
  DocumentType,
  Lead,
  Vehicle,
} from '../../types';
import { ApiContractRow, mapDbContractToFrontend } from '../../db/mappers';
import { formatBRL, formatKm, formatTodayFullDate } from '../../utils/formatters';
import { adminFetch } from '../../utils/authSession';

interface ContractsModuleProps {
  leads: Lead[];
  vehicles: Vehicle[];
  settings: DealershipSettings;
  preselectedLeadId: string | null;
  preselectedVehicleId: string | null;
  onClearPreselection: () => void;
  onContractCreated?: (record: ContractRecord) => void;
  onUnauthorized?: () => void;
}

const DOC_TYPES: { id: DocumentType; label: string; short: string }[] = [
  {
    id: 'contrato',
    label: 'Contrato de Compra e Venda (CDC)',
    short: 'Compra e Venda',
  },
  {
    id: 'garantia',
    label: 'Termo de Garantia Legal (90 Dias — CDC)',
    short: 'Garantia 90 Dias',
  },
  {
    id: 'recibo',
    label: 'Recibo / ATPV-e Digital',
    short: 'Recibo / ATPV-e',
  },
  {
    id: 'vistoria',
    label: 'Termo de Vistoria / Laudo Cautelar',
    short: 'Laudo / Vistoria',
  },
];

export const ContractsModule: React.FC<ContractsModuleProps> = ({
  leads,
  vehicles,
  settings,
  preselectedLeadId,
  preselectedVehicleId,
  onClearPreselection,
  onContractCreated,
  onUnauthorized,
}) => {
  const availableVehicles = useMemo(
    () => vehicles.filter((v) => v.status === 'Disponível'),
    [vehicles]
  );

  const selectableVehicles = useMemo(() => {
    if (availableVehicles.length > 0) {
      if (
        preselectedVehicleId &&
        !availableVehicles.some((v) => v.id === preselectedVehicleId)
      ) {
        const extra = vehicles.find((v) => v.id === preselectedVehicleId);
        return extra ? [extra, ...availableVehicles] : availableVehicles;
      }
      return availableVehicles;
    }
    return vehicles;
  }, [availableVehicles, vehicles, preselectedVehicleId]);

  const [docType, setDocType] = useState<DocumentType>('contrato');
  const [selectedLeadId, setSelectedLeadId] = useState<string>('');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(
    () => selectableVehicles[0]?.id || ''
  );

  const [buyerName, setBuyerName] = useState('');
  const [buyerCpf, setBuyerCpf] = useState('');
  const [buyerRg, setBuyerRg] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [plateOverride, setPlateOverride] = useState('');
  const [renavamOverride, setRenavamOverride] = useState('');
  const [negotiatedPrice, setNegotiatedPrice] = useState<string>(
    () => String(selectableVehicles[0]?.price || '')
  );
  const [paymentMethod, setPaymentMethod] = useState(
    'Transferência TED/PIX à vista na assinatura'
  );
  const [tradeInNote, setTradeInNote] = useState('Sem veículo na troca');
  const [vistoriaNotes, setVistoriaNotes] = useState(
    'Estrutura íntegra sem indícios de sinistro ou leilão. Numeração de chassi e motor conferem com o padrão original de fábrica. Pintura aferida com micrômetro dentro dos parâmetros originais.'
  );

  const [copied, setCopied] = useState(false);
  const [savingContract, setSavingContract] = useState(false);
  const [savedContractNotice, setSavedContractNotice] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);

  const [contractsHistory, setContractsHistory] = useState<ContractRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const documentRef = useRef<HTMLDivElement>(null);

  const fetchContractsHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const res = await adminFetch('/api/contracts');
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
      if (res.ok) {
        const rows = (await res.json()) as ApiContractRow[];
        setContractsHistory(rows.map(mapDbContractToFrontend));
      }
    } catch {
      // Ignore silent background fetch failure
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    void fetchContractsHistory();
  }, []);

  useEffect(() => {
    if (!selectedVehicleId && selectableVehicles[0]?.id) {
      setSelectedVehicleId(selectableVehicles[0].id);
    }
  }, [selectableVehicles, selectedVehicleId]);

  useEffect(() => {
    if (preselectedLeadId) setSelectedLeadId(preselectedLeadId);
    if (preselectedVehicleId) setSelectedVehicleId(preselectedVehicleId);
    if (preselectedLeadId || preselectedVehicleId) {
      onClearPreselection();
    }
  }, [preselectedLeadId, preselectedVehicleId, onClearPreselection]);

  useEffect(() => {
    if (!selectedLeadId) return;
    const lead = leads.find((l) => l.id === selectedLeadId);
    if (lead) {
      setBuyerName(lead.name);
      setBuyerCpf(lead.cpf || '');
      setBuyerRg(lead.rg || '');
      setBuyerAddress(
        lead.address
          ? `${lead.address}${lead.city ? ` — ${lead.city}` : ''}`
          : lead.city || ''
      );
    }
  }, [selectedLeadId, leads]);

  const vehicle =
    vehicles.find((v) => v.id === selectedVehicleId) || selectableVehicles[0];

  useEffect(() => {
    if (vehicle) {
      setNegotiatedPrice(String(vehicle.price));
      setPlateOverride(vehicle.plate || '');
      setRenavamOverride(vehicle.renavam || '');
    }
  }, [vehicle?.id]);

  const parsedNegotiatedValue = Number(negotiatedPrice);
  const finalValueDisplay =
    Number.isFinite(parsedNegotiatedValue) && parsedNegotiatedValue > 0
      ? parsedNegotiatedValue
      : vehicle?.price || 0;

  const displayPlate = plateOverride.trim() || vehicle?.plate || 'A conferir';
  const displayRenavam =
    renavamOverride.trim() || vehicle?.renavam || 'A conferir';
  const todayFull = formatTodayFullDate();

  const handleSelectLeadPreset = (leadId: string) => {
    setSelectedLeadId(leadId);
    if (!leadId) {
      setBuyerName('');
      setBuyerCpf('');
      setBuyerRg('');
      setBuyerAddress('');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportDocument = () => {
    if (!documentRef.current) return;
    const slug = docType === 'contrato'
      ? 'contrato-compra-e-venda'
      : docType === 'garantia'
        ? 'termo-garantia-90-dias-cdc'
        : docType === 'recibo'
          ? 'recibo-atpve'
          : 'termo-vistoria-cautelar';
    const buyerSlug = (buyerName.trim() || 'comprador')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-');

    const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${slug} - ${settings.tradeName}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #18181b; padding: 32px; line-height: 1.6; font-size: 13px; max-width: 820px; margin: 0 auto; }
    h3 { text-align: center; text-transform: uppercase; font-size: 15px; margin: 24px 0; }
    p { margin: 10px 0; text-align: justify; }
    .box { border: 1px solid #d4d4d8; background: #fafafa; padding: 14px; border-radius: 6px; margin: 16px 0; }
    .header { border-bottom: 2px solid #18181b; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; }
    .sigs { margin-top: 48px; display: flex; justify-content: space-between; gap: 32px; }
    .sig-line { flex: 1; border-top: 1px solid #27272a; padding-top: 6px; text-align: center; font-size: 12px; }
  </style>
</head>
<body>
  ${documentRef.current.innerHTML}
</body>
</html>`;

    const blob = new Blob(['\ufeff', htmlContent], {
      type: 'application/msword;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slug}-${buyerSlug}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyText = async () => {
    if (!documentRef.current) return;
    try {
      await navigator.clipboard.writeText(documentRef.current.innerText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  const handleRegisterContractInDb = async () => {
    setContractError(null);
    if (!vehicle) {
      setContractError('Selecione um veículo do estoque disponível.');
      return;
    }
    if (!buyerName.trim()) {
      setContractError('Preencha o nome completo do comprador.');
      return;
    }
    if (!buyerCpf.trim()) {
      setContractError('Preencha o CPF do comprador.');
      return;
    }
    if (!Number.isFinite(finalValueDisplay) || finalValueDisplay <= 0) {
      setContractError('Informe um preço final negociado válido.');
      return;
    }

    setSavingContract(true);
    try {
      const res = await adminFetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: buyerName.trim(),
          client_cpf: buyerCpf.trim(),
          vehicle_id: vehicle.id,
          final_price: finalValueDisplay,
          payment_method: paymentMethod.trim() || 'À vista',
        }),
      });

      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao salvar contrato no banco.');
      }

      const mapped = mapDbContractToFrontend(data as ApiContractRow);
      setContractsHistory((prev) => [mapped, ...prev]);
      onContractCreated?.(mapped);
      setSavedContractNotice(true);
      setTimeout(() => setSavedContractNotice(false), 3500);
    } catch (err: unknown) {
      setContractError(
        err instanceof Error
          ? err.message
          : 'Não foi possível salvar o contrato no banco Neon.'
      );
    } finally {
      setSavingContract(false);
    }
  };

  const handleLoadContractIntoEditor = (record: ContractRecord) => {
    setSelectedLeadId('');
    setBuyerName(record.clientName);
    setBuyerCpf(record.clientCpf);
    setPaymentMethod(record.paymentMethod);
    setNegotiatedPrice(String(record.finalPrice));
    if (record.vehicleId && vehicles.some((v) => v.id === record.vehicleId)) {
      setSelectedVehicleId(record.vehicleId);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Configuration Panel */}
        <div className="no-print xl:col-span-4 bg-[#111114] border border-white/[0.08] rounded-xl p-5 space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold text-white">
              Parâmetros do Documento
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Escolha o veículo disponível, preencha os dados do comprador e gere as minutas.
            </p>
          </div>

          {/* Document Type Selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-300">
              Tipo de Documento
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {DOC_TYPES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDocType(item.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium text-left border transition-colors ${
                    docType === item.id
                      ? 'bg-red-600/15 border-red-600/40 text-white'
                      : 'bg-[#09090B] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <FileText
                    className={`w-3.5 h-3.5 shrink-0 ${
                      docType === item.id ? 'text-red-500' : 'text-zinc-500'
                    }`}
                  />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Vehicle & Optional CRM Quick Selectors */}
          <div className="space-y-3 pt-2 border-t border-white/[0.06]">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Veículo do Estoque Disponível *
              </label>
              <select
                value={selectedVehicleId}
                onChange={(e) => setSelectedVehicleId(e.target.value)}
                className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none focus:border-red-600"
              >
                {selectableVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.brand} {v.model} ({v.year}) — {formatBRL(v.price)}
                    {v.status !== 'Disponível' ? ` [${v.status}]` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Importar Dados de Lead do CRM (opcional)
              </label>
              <select
                value={selectedLeadId}
                onChange={(e) => handleSelectLeadPreset(e.target.value)}
                className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none focus:border-red-600"
              >
                <option value="">Preenchimento manual (novo comprador)</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.stage}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Buyer Details & Vehicle/Deal Overrides */}
          <div className="space-y-3 pt-2 border-t border-white/[0.06]">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Nome Completo do Comprador *
              </label>
              <input
                type="text"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder="Ex: João Carlos da Silva"
                className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  CPF *
                </label>
                <input
                  type="text"
                  value={buyerCpf}
                  onChange={(e) => setBuyerCpf(e.target.value)}
                  placeholder="000.000.000-00"
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  RG
                </label>
                <input
                  type="text"
                  value={buyerRg}
                  onChange={(e) => setBuyerRg(e.target.value)}
                  placeholder="00.000.000-0 SSP/SP"
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-red-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Endereço Completo do Comprador
              </label>
              <input
                type="text"
                value={buyerAddress}
                onChange={(e) => setBuyerAddress(e.target.value)}
                placeholder="Rua, número, bairro, cidade - UF"
                className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-red-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Placa do Veículo
                </label>
                <input
                  type="text"
                  value={plateOverride}
                  onChange={(e) => setPlateOverride(e.target.value.toUpperCase())}
                  placeholder="ABC1D23"
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white font-mono uppercase placeholder:text-zinc-600 focus:outline-none focus:border-red-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  RENAVAM
                </label>
                <input
                  type="text"
                  value={renavamOverride}
                  onChange={(e) => setRenavamOverride(e.target.value)}
                  placeholder="00000000000"
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-red-600"
                />
              </div>
            </div>

            {docType !== 'vistoria' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Preço Final Negociado (R$) *
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={negotiatedPrice}
                    onChange={(e) => setNegotiatedPrice(e.target.value)}
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white font-mono tabular-nums focus:outline-none focus:border-red-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Forma de Pagamento
                  </label>
                  <input
                    type="text"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none focus:border-red-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    Veículo na Troca (se houver)
                  </label>
                  <input
                    type="text"
                    value={tradeInNote}
                    onChange={(e) => setTradeInNote(e.target.value)}
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none focus:border-red-600"
                  />
                </div>
              </>
            )}

            {docType === 'vistoria' && (
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Parecer Técnico do Laudo Cautelar
                </label>
                <textarea
                  rows={3}
                  value={vistoriaNotes}
                  onChange={(e) => setVistoriaNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-white focus:outline-none focus:border-red-600"
                />
              </div>
            )}
          </div>

          {contractError && (
            <div className="px-3 py-2.5 rounded-lg bg-red-950/50 border border-red-600/40 text-xs text-red-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{contractError}</span>
            </div>
          )}

          {/* Export, Print & Save Actions */}
          <div className="pt-3 border-t border-white/[0.08] space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Imprimir / PDF</span>
              </button>

              <button
                type="button"
                onClick={handleExportDocument}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Exportar (.doc)</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={savingContract || !vehicle}
                onClick={() => void handleRegisterContractInDb()}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-[#09090B] hover:bg-white/[0.06] border border-white/[0.12] transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {savingContract ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" />
                    <span>Salvando contrato...</span>
                  </>
                ) : savedContractNotice ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">
                      Contrato salvo no histórico!
                    </span>
                  </>
                ) : (
                  <>
                    <FileCheck2 className="w-3.5 h-3.5 text-red-500" />
                    <span>Salvar Contrato no Histórico</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleCopyText()}
                title="Copiar texto da minuta"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors whitespace-nowrap"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copied ? 'Copiado' : 'Copiar'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right A4 Formal Document Preview */}
        <div className="xl:col-span-8">
          <div
            ref={documentRef}
            className="print-only-sheet bg-white text-zinc-900 rounded-xl border border-zinc-300 p-8 sm:p-12 shadow-sm max-w-[820px] mx-auto text-[13px] leading-relaxed"
          >
            {/* Letterhead */}
            <div className="border-b-2 border-zinc-900 pb-4 mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <p className="text-lg font-bold tracking-tight uppercase text-zinc-950">
                  {settings.tradeName}
                </p>
                <p className="text-xs text-zinc-600">{settings.legalName}</p>
                <p className="text-xs text-zinc-600 font-mono">
                  CNPJ: {settings.cnpj} · IE: {settings.stateRegistration}
                </p>
              </div>
              <div className="sm:text-right text-xs text-zinc-600">
                <p>
                  {settings.address}, {settings.city} - {settings.state}
                </p>
                <p>
                  Tel: {settings.phone} · WhatsApp: {settings.whatsapp}
                </p>
              </div>
            </div>

            {!vehicle ? (
              <p className="text-zinc-500 py-8 text-center">
                Cadastre ao menos um veículo disponível no estoque para preencher o documento.
              </p>
            ) : (
              <>
                {/* Title */}
                <h3 className="text-center font-bold text-base uppercase tracking-wide text-zinc-950 mb-6">
                  {docType === 'contrato' &&
                    'Contrato Particular de Compra e Venda de Veículo Automotor'}
                  {docType === 'recibo' &&
                    'Recibo de Quitação e Autorização para Transferência (ATPV-e)'}
                  {docType === 'vistoria' &&
                    'Termo de Vistoria Veicular e Conferência Cautelar'}
                  {docType === 'garantia' &&
                    'Certificado e Termo de Garantia Legal de 90 Dias (Lei nº 8.078/90 — CDC)'}
                </h3>

                {/* Parties */}
                <div className="space-y-3 mb-5">
                  <p>
                    <strong>VENDEDORA:</strong> {settings.legalName}, pessoa jurídica de
                    direito privado inscrita no CNPJ sob nº{' '}
                    <span className="font-mono">{settings.cnpj}</span>, com sede na{' '}
                    {settings.address}, {settings.city}/{settings.state}.
                  </p>
                  <p>
                    <strong>COMPRADOR(A):</strong>{' '}
                    {buyerName.trim() || '_______________________________________'},
                    inscrito(a) no CPF sob nº{' '}
                    <span className="font-mono">
                      {buyerCpf.trim() || '___.___.___-__'}
                    </span>
                    , portador(a) do RG nº{' '}
                    <span className="font-mono">
                      {buyerRg.trim() || '______________'}
                    </span>
                    , residente e domiciliado(a) na{' '}
                    {buyerAddress.trim() ||
                      '________________________________________________'}
                    .
                  </p>
                </div>

                {/* Vehicle Identification Box */}
                <div className="border border-zinc-300 rounded-md p-4 mb-6 bg-zinc-50">
                  <p className="font-bold text-xs uppercase tracking-wider text-zinc-700 mb-2">
                    Identificação Técnica do Veículo Objeto
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4 text-xs">
                    <div>
                      <span className="text-zinc-500">Marca / Modelo:</span>{' '}
                      <strong>
                        {vehicle.brand} {vehicle.model}
                      </strong>
                    </div>
                    <div>
                      <span className="text-zinc-500">Versão:</span>{' '}
                      <strong>{vehicle.version || 'Original'}</strong>
                    </div>
                    <div>
                      <span className="text-zinc-500">Ano Fab/Mod:</span>{' '}
                      <strong className="font-mono">{vehicle.year}</strong>
                    </div>
                    <div>
                      <span className="text-zinc-500">Combustível / Câmbio:</span>{' '}
                      <strong>
                        {vehicle.fuel} · {vehicle.transmission}
                      </strong>
                    </div>
                    <div>
                      <span className="text-zinc-500">Placa:</span>{' '}
                      <strong className="font-mono">{displayPlate}</strong>
                    </div>
                    <div>
                      <span className="text-zinc-500">Hodômetro:</span>{' '}
                      <strong className="font-mono">{formatKm(vehicle.km)}</strong>
                    </div>
                    <div>
                      <span className="text-zinc-500">RENAVAM:</span>{' '}
                      <strong className="font-mono">{displayRenavam}</strong>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-zinc-500">Chassi:</span>{' '}
                      <strong className="font-mono">
                        {vehicle.chassis || 'Conforme CRLV-e'}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Document-Specific Clauses */}
                {docType === 'contrato' && (
                  <div className="space-y-3 text-justify">
                    <p>
                      <strong>CLÁUSULA 1ª — DO OBJETO E PROCEDÊNCIA:</strong> A VENDEDORA
                      vende e transfere ao(à) COMPRADOR(A) a posse e propriedade do veículo
                      automotor acima identificado, livre e desembaraçado de quaisquer ônus
                      judiciais, alienações fiduciárias, bloqueios RENAJUD, multas anteriores à
                      entrega ou restrições financeiras, com laudo cautelar e histórico de
                      procedência devidamente verificados.
                    </p>
                    <p>
                      <strong>CLÁUSULA 2ª — DO PREÇO FINAL E FORMA DE PAGAMENTO:</strong> O preço
                      certo, final e ajustado entre as partes para a presente compra e venda é
                      de{' '}
                      <strong className="font-mono">
                        {formatBRL(finalValueDisplay)}
                      </strong>
                      , a ser quitado da seguinte forma: {paymentMethod}. Observação sobre
                      veículo dado na troca: {tradeInNote}.
                    </p>
                    <p>
                      <strong>CLÁUSULA 3ª — DA GARANTIA LEGAL (ART. 26, II DO CDC):</strong> Nos
                      termos do Código de Defesa do Consumidor (Lei nº 8.078/90, Art. 26, inciso
                      II e Art. 24), por tratar-se de bem durável seminovo, a VENDEDORA concede
                      garantia legal obrigatória de{' '}
                      <strong>
                        {settings.warrantyDays} (
                        {settings.warrantyDays === 90
                          ? 'noventa'
                          : settings.warrantyDays}
                        ) dias ou {settings.warrantyKm.toLocaleString('pt-BR')} km
                      </strong>{' '}
                      (o que ocorrer primeiro), contados da entrega efetiva das chaves,
                      cobrindo especificamente motor e caixa de câmbio (componentes internos
                      lubrificados), excluindo-se peças de desgaste natural e manutenção
                      preventiva periódica.
                    </p>
                    <p>
                      <strong>CLÁUSULA 4ª — DA TRADIÇÃO E TRANSFERÊNCIA NO DETRAN:</strong> A
                      partir da entrega efetiva do veículo e assinatura deste instrumento, passam
                      ao(à) COMPRADOR(A) todas as responsabilidades civis, criminais e
                      administrativas por infrações de trânsito, tributos futuros e guarda do
                      bem, obrigando-se este(a) a concluir a transferência de propriedade junto
                      ao DETRAN-{settings.state} no prazo legal de 30 (trinta) dias, sob pena de
                      comunicação de venda compulsória.
                    </p>
                    <p>
                      <strong>CLÁUSULA 5ª — DO FORO:</strong> Fica eleito o foro da Comarca de{' '}
                      {settings.city}/{settings.state} para dirimir quaisquer controvérsias
                      oriundas deste contrato, com renúncia expressa a qualquer outro.
                    </p>
                  </div>
                )}

                {docType === 'garantia' && (
                  <div className="space-y-3 text-justify">
                    <p>
                      A <strong>{settings.tradeName}</strong> ({settings.legalName}) confere
                      ao(à) COMPRADOR(A) acima qualificado(a) o presente{' '}
                      <strong>Certificado de Garantia Legal</strong> pelo prazo irredutível de{' '}
                      <strong>
                        {settings.warrantyDays} (
                        {settings.warrantyDays === 90
                          ? 'noventa'
                          : settings.warrantyDays}
                        ) dias
                      </strong>{' '}
                      ou <strong>{settings.warrantyKm.toLocaleString('pt-BR')} km</strong> (o
                      que ocorrer primeiro), a contar da data da efetiva entrega do veículo, em
                      estrito cumprimento aos artigos 18, 24 e 26, inciso II, do Código de
                      Defesa do Consumidor (Lei Federal nº 8.078/90).
                    </p>
                    <p>
                      <strong>1. ITENS E SISTEMAS COBERTOS:</strong> Componentes internos
                      lubrificados do bloco do motor (pistões, anéis, bielas, virabrequim,
                      bronzinas, comando de válvulas e bomba de óleo) e conjunto interno da
                      caixa de transmissão/câmbio (engrenagens, eixos, sincronizadores,
                      conversor de torque e unidade mecatrônica).
                    </p>
                    <p>
                      <strong>2. ITENS EXCLUÍDOS POR DESGASTE NATURAL:</strong> Conforme
                      natureza de veículo seminovo e jurisprudência aplicável ao CDC, não
                      integram esta garantia itens sujeitos a desgaste natural de rodagem e
                      manutenção periódica, tais como pneus, pastilhas e discos de freio,
                      embreagem, amortecedores, bateria, velas, correias, lâmpadas, palhetas,
                      filtros e fluidos lubrificantes.
                    </p>
                    <p>
                      <strong>3. PROCEDIMENTO E PRAZO DE ATENDIMENTO (ART. 18 DO CDC):</strong>{' '}
                      Constatado qualquer vício oculto ou anomalia mecânica dentro do prazo
                      vigente, o(a) COMPRADOR(A) deverá comunicar imediatamente a oficina técnica
                      credenciada da revenda pelo telefone/WhatsApp{' '}
                      <span className="font-mono">{settings.whatsapp}</span> antes de
                      autorizar qualquer intervenção ou desmontagem por terceiros, garantindo à
                      VENDEDORA o prazo legal de até 30 (trinta) dias para diagnóstico e reparo.
                    </p>
                    <p>
                      <strong>4. CAUSAS DE PERDA DA GARANTIA:</strong> Violação ou adulteração do
                      hodômetro, realização de reparos sem autorização prévia da VENDEDORA,
                      utilização do automóvel em competições/track-days, instalação de
                      reprogramação eletrônica (remap) ou uso de combustível adulterado.
                    </p>
                  </div>
                )}

                {docType === 'recibo' && (
                  <div className="space-y-4 text-justify">
                    <p>
                      Recebemos de{' '}
                      <strong>{buyerName.trim() || '___________________'}</strong>, CPF nº{' '}
                      <span className="font-mono">
                        {buyerCpf.trim() || '___.___.___-__'}
                      </span>
                      , a importância total de{' '}
                      <strong className="font-mono">
                        {formatBRL(finalValueDisplay)}
                      </strong>{' '}
                      ({paymentMethod}), referente à quitação integral pela aquisição do veículo
                      descrito no quadro técnico acima.
                    </p>
                    <p>
                      Declaramos que a Autorização para Transferência de Propriedade de Veículo
                      em meio digital (<strong>ATPV-e</strong>) encontra-se emitida junto ao
                      sistema SENATRAN/DETRAN-{settings.state}, cabendo ao(à) COMPRADOR(A)
                      comparecer ao cartório para reconhecimento de firma por autenticidade ou
                      realizar a assinatura eletrônica via aplicativo Carteira Digital de
                      Trânsito (CDT/Gov.br).
                    </p>
                    <p>Veículo em troca / observações adicionais: {tradeInNote}.</p>
                  </div>
                )}

                {docType === 'vistoria' && (
                  <div className="space-y-4 text-justify">
                    <p>
                      Pelo presente Termo de Vistoria, as partes atestam que o veículo foi
                      inspecionado fisicamente no pátio da{' '}
                      <strong>{settings.tradeName}</strong> na presente data, registrando a
                      quilometragem exata de{' '}
                      <strong className="font-mono">{formatKm(vehicle.km)}</strong>.
                    </p>
                    <div className="border border-zinc-300 rounded p-3 text-xs space-y-1.5">
                      <p>
                        [X] Conferência visual de Chassi, Motor e Vidros —{' '}
                        <strong>Aprovado</strong>
                      </p>
                      <p>
                        [X] Estrutura (longarinas, colunas A/B/C e painel traseiro) —{' '}
                        <strong>Íntegra</strong>
                      </p>
                      <p>
                        [X] Entrega de Manual do Proprietário e Chave Reserva —{' '}
                        <strong>Conferido</strong>
                      </p>
                      <p>
                        [X] Equipamentos obrigatórios (estepe, macaco, chave de roda,
                        triângulo) — <strong>Completos</strong>
                      </p>
                    </div>
                    <p>
                      <strong>Parecer Técnico:</strong> {vistoriaNotes}
                    </p>
                  </div>
                )}

                {/* Signatures */}
                <div className="mt-10 pt-4">
                  <p className="text-right text-xs text-zinc-700 mb-12">
                    {settings.city} - {settings.state}, {todayFull}.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
                    <div className="border-t border-zinc-800 pt-2 text-center">
                      <p className="font-semibold text-xs text-zinc-900">
                        {settings.tradeName}
                      </p>
                      <p className="text-[11px] text-zinc-600 font-mono">
                        CNPJ {settings.cnpj} · VENDEDORA
                      </p>
                    </div>

                    <div className="border-t border-zinc-800 pt-2 text-center">
                      <p className="font-semibold text-xs text-zinc-900">
                        {buyerName.trim() || 'COMPRADOR(A)'}
                      </p>
                      <p className="text-[11px] text-zinc-600 font-mono">
                        CPF {buyerCpf.trim() || '___.___.___-__'} · COMPRADOR(A)
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Persisted Contract History (Neon contracts table) */}
      <section className="no-print bg-[#111114] border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <History className="w-4 h-4 text-red-500 shrink-0" />
            <div>
              <h3 className="font-display text-sm font-semibold text-white">
                Histórico de Contratos Emitidos
              </h3>
              <p className="text-xs text-zinc-400">
                Registro permanente de contratos e transações salvos na loja.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void fetchContractsHistory()}
            disabled={isLoadingHistory}
            className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors disabled:opacity-60"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`}
            />
            <span>Atualizar</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] text-xs font-medium text-zinc-400 bg-white/[0.01]">
                <th className="py-3 px-5">Registro</th>
                <th className="py-3 px-4">Comprador</th>
                <th className="py-3 px-4">Veículo</th>
                <th className="py-3 px-4">Pagamento</th>
                <th className="py-3 px-4 text-right">Valor Negociado</th>
                <th className="py-3 px-5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-xs">
              {isLoadingHistory && contractsHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    Carregando histórico de contratos...
                  </td>
                </tr>
              ) : contractsHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    Nenhum contrato registrado ainda. Preencha os dados acima e clique em
                    &quot;Salvar Contrato no Histórico&quot;.
                  </td>
                </tr>
              ) : (
                contractsHistory.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3.5 px-5 whitespace-nowrap">
                      <span className="font-mono text-zinc-300 font-medium">
                        #{item.id}
                      </span>
                      <p className="text-[11px] text-zinc-500 mt-0.5 tabular-nums">
                        {item.createdAt}
                      </p>
                    </td>
                    <td className="py-3.5 px-4">
                      <p className="font-medium text-white">{item.clientName}</p>
                      <p className="text-[11px] font-mono text-zinc-400 tabular-nums">
                        CPF: {item.clientCpf}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-zinc-200">
                      {item.vehicleLabel}
                    </td>
                    <td className="py-3.5 px-4 text-zinc-400 max-w-[220px] truncate">
                      {item.paymentMethod}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-semibold text-white tabular-nums whitespace-nowrap">
                      {formatBRL(item.finalPrice)}
                    </td>
                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleLoadContractIntoEditor(item)}
                        className="text-xs font-medium text-red-400 hover:text-red-300"
                      >
                        Carregar no Editor
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
