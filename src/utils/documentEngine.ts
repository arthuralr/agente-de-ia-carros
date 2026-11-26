import type {
  DealershipSettings,
  DocumentFieldSchema,
  DocumentTemplateRecord,
  DocumentTypeSlug,
  IssuedDocumentRecord,
  StaffRole,
  TradeInRecord,
  Vehicle,
} from '../types';
import { formatBRL, formatKm } from './formatters';
import {
  formatDealershipAddress,
  formatDealershipHours,
  formatPhoneDisplay,
} from './vehicleDomain';
import { generateDealershipPdf, PdfDocumentPayload, PdfSection } from './pdfGenerator';

export interface DocumentPrefillContext {
  dealership: DealershipSettings;
  vehicle?: Vehicle | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerCpf?: string | null;
  customerEmail?: string | null;
  downPayment?: number | null;
  installments?: number | null;
  tradeIn?: Partial<TradeInRecord> | null;
  visitDate?: string | null;
  visitTime?: string | null;
  salespersonName?: string | null;
}

export interface DocumentCalculatedTotals {
  vehiclePrice: number;
  downPayment: number;
  tradeInValue: number;
  principalBalance: number;
  installments: number | null;
  monthlyRatePct: number | null;
  estimatedInstallment: number | null;
  calculationType: 'saldo_antes_de_encargos' | 'estimativa_taxa_configurada' | 'a_vista';
  note: string;
}

export interface DefaultTemplateSeed {
  slug: string;
  name: string;
  docType: DocumentTypeSlug;
  version: number;
  status: 'ativo' | 'rascunho' | 'arquivado';
  isExampleTemplate: boolean;
  allowedRoles: StaffRole[];
  fieldsSchema: DocumentFieldSchema[];
  bodyTemplate: string;
}

export const DEFAULT_DOCUMENT_TEMPLATES: DefaultTemplateSeed[] = [
  {
    slug: 'proposta-comercial',
    name: 'Proposta Comercial',
    docType: 'proposta_comercial',
    version: 1,
    status: 'ativo',
    isExampleTemplate: false,
    allowedRoles: ['vendedor', 'assistente', 'gestor', 'administrador'],
    fieldsSchema: [
      { key: 'customer_name', label: 'Nome do cliente', type: 'text', required: true, source: 'session' },
      { key: 'customer_phone', label: 'WhatsApp / Telefone do cliente', type: 'text', required: true, source: 'session' },
      { key: 'customer_cpf', label: 'CPF do cliente', type: 'text', required: false, source: 'lead' },
      { key: 'vehicle_title', label: 'Veículo de interesse', type: 'text', required: true, source: 'vehicle' },
      { key: 'vehicle_year', label: 'Ano/Modelo', type: 'text', required: true, source: 'vehicle' },
      { key: 'vehicle_km', label: 'Quilometragem', type: 'text', required: false, source: 'vehicle' },
      { key: 'vehicle_price', label: 'Valor anunciado do veículo (R$)', type: 'currency', required: true, source: 'vehicle' },
      { key: 'payment_mode', label: 'Forma de pagamento', type: 'select', required: true, options: ['Financiamento', 'À vista (PIX / TED)', 'Financiamento + Troca', 'À vista + Troca'] },
      { key: 'down_payment', label: 'Valor de entrada (R$)', type: 'currency', required: true, source: 'financing' },
      { key: 'installments', label: 'Prazo desejado (parcelas)', type: 'number', required: false, source: 'financing' },
      { key: 'has_trade_in', label: 'Inclui veículo na troca?', type: 'boolean', required: false, source: 'trade_in' },
      { key: 'trade_in_vehicle', label: 'Veículo na troca (marca/modelo/ano)', type: 'text', required: true, showWhen: { field: 'has_trade_in', equals: true }, source: 'trade_in' },
      { key: 'trade_in_km', label: 'Quilometragem do usado', type: 'text', required: false, showWhen: { field: 'has_trade_in', equals: true }, source: 'trade_in' },
      { key: 'trade_in_value', label: 'Valor pré-aprovado da troca (R$)', type: 'currency', required: false, showWhen: { field: 'has_trade_in', equals: true }, source: 'trade_in' },
      { key: 'validity_days', label: 'Validade da proposta (dias)', type: 'number', required: true },
      { key: 'observations', label: 'Observações comerciais', type: 'textarea', required: false },
    ],
    bodyTemplate:
      'Esta proposta comercial apresenta as condições negociadas para aquisição do veículo identificado acima. Valores de financiamento correspondem ao saldo principal antes de juros, IOF e tarifas bancárias, sujeitos à análise de crédito e vistoria presencial em caso de troca.',
  },
  {
    slug: 'pre-avaliacao-troca',
    name: 'Ficha de Pré-Avaliação de Troca',
    docType: 'pre_avaliacao_troca',
    version: 1,
    status: 'ativo',
    isExampleTemplate: false,
    allowedRoles: ['vendedor', 'assistente', 'gestor', 'administrador'],
    fieldsSchema: [
      { key: 'customer_name', label: 'Nome do proprietário', type: 'text', required: true, source: 'session' },
      { key: 'customer_phone', label: 'Telefone / WhatsApp', type: 'text', required: true, source: 'session' },
      { key: 'trade_in_vehicle', label: 'Veículo oferecido na troca', type: 'text', required: true, source: 'trade_in' },
      { key: 'trade_in_year', label: 'Ano/Modelo do usado', type: 'text', required: true, source: 'trade_in' },
      { key: 'trade_in_km', label: 'Quilometragem atual', type: 'text', required: true, source: 'trade_in' },
      { key: 'trade_in_transmission', label: 'Câmbio', type: 'text', required: false, source: 'trade_in' },
      { key: 'trade_in_plate', label: 'Placa', type: 'text', required: false, source: 'trade_in' },
      { key: 'trade_in_condition', label: 'Estado geral / pendências informadas', type: 'textarea', required: true, source: 'trade_in' },
      { key: 'trade_in_value', label: 'Valor de pré-avaliação aprovado (R$)', type: 'currency', required: false, source: 'trade_in' },
      { key: 'vehicle_title', label: 'Veículo de interesse na loja', type: 'text', required: false, source: 'vehicle' },
    ],
    bodyTemplate:
      'Pré-avaliação sujeita à inspeção presencial, laudo cautelar e conferência documental (CRLV, débitos, multas e gravames). O valor definitivo só é confirmado após vistoria física.',
  },
  {
    slug: 'ficha-visita-test-drive',
    name: 'Ficha de Visita e Test-Drive',
    docType: 'ficha_visita',
    version: 1,
    status: 'ativo',
    isExampleTemplate: false,
    allowedRoles: ['vendedor', 'assistente', 'gestor', 'administrador'],
    fieldsSchema: [
      { key: 'customer_name', label: 'Nome do visitante', type: 'text', required: true, source: 'session' },
      { key: 'customer_phone', label: 'WhatsApp / Telefone', type: 'text', required: true, source: 'session' },
      { key: 'customer_cnh', label: 'Número da CNH (se houver test-drive)', type: 'text', required: false },
      { key: 'vehicle_title', label: 'Veículo reservado para visita', type: 'text', required: true, source: 'vehicle' },
      { key: 'visit_date', label: 'Data da visita', type: 'date', required: true },
      { key: 'visit_time', label: 'Horário combinado', type: 'text', required: true },
      { key: 'observations', label: 'Observações da visita', type: 'textarea', required: false },
    ],
    bodyTemplate:
      'Registro de visita ao showroom e acompanhamento de test-drive. O condutor declara estar regularmente habilitado (CNH vigente) e compromete-se a respeitar as normas de trânsito durante o percurso acompanhado.',
  },
  {
    slug: 'checklist-termo-entrega',
    name: 'Checklist e Termo de Entrega',
    docType: 'termo_entrega',
    version: 1,
    status: 'ativo',
    isExampleTemplate: false,
    allowedRoles: ['assistente', 'gestor', 'administrador'],
    fieldsSchema: [
      { key: 'customer_name', label: 'Nome do comprador', type: 'text', required: true, source: 'session' },
      { key: 'customer_cpf', label: 'CPF do comprador', type: 'text', required: true, source: 'lead' },
      { key: 'vehicle_title', label: 'Veículo entregue', type: 'text', required: true, source: 'vehicle' },
      { key: 'vehicle_plate', label: 'Placa', type: 'text', required: true, source: 'vehicle' },
      { key: 'vehicle_km', label: 'Quilometragem na entrega', type: 'text', required: true, source: 'vehicle' },
      { key: 'has_manual_key', label: 'Manual e chave reserva conferidos?', type: 'boolean', required: false },
      { key: 'delivery_date', label: 'Data da entrega', type: 'date', required: true },
      { key: 'observations', label: 'Itens conferidos / ressalvas', type: 'textarea', required: false },
    ],
    bodyTemplate:
      'O comprador declara ter recebido o veículo descrito em perfeitas condições de uso e conservação, vistoriado no ato da entrega, com garantia legal de motor e câmbio conforme Código de Defesa do Consumidor.',
  },
  {
    slug: 'recibo-sinal-exemplo',
    name: 'Recibo de Sinal / Reserva (Modelo de Exemplo — Revisar)',
    docType: 'recibo',
    version: 1,
    status: 'rascunho',
    isExampleTemplate: true,
    allowedRoles: ['assistente', 'gestor', 'administrador'],
    fieldsSchema: [
      { key: 'customer_name', label: 'Nome do pagador', type: 'text', required: true, source: 'session' },
      { key: 'customer_cpf', label: 'CPF', type: 'text', required: true, source: 'lead' },
      { key: 'vehicle_title', label: 'Veículo reservado', type: 'text', required: true, source: 'vehicle' },
      { key: 'down_payment', label: 'Valor recebido (R$)', type: 'currency', required: true },
      { key: 'payment_mode', label: 'Meio de pagamento', type: 'select', required: true, options: ['PIX', 'TED', 'Cartão de Crédito', 'Cartão de Débito'] },
      { key: 'observations', label: 'Condições da reserva', type: 'textarea', required: false },
    ],
    bodyTemplate:
      '[MODELO DE EXEMPLO PARA AMBIENTE DE TESTE — SUBSTITUIR PELO TEXTO JURÍDICO OFICIAL DA REVENDA ANTES DE ATIVAR] Declaramos ter recebido a importância acima a título de sinal/reserva para o veículo especificado.',
  },
  {
    slug: 'contrato-compra-venda-exemplo',
    name: 'Contrato de Compra e Venda (Modelo de Exemplo — Revisar)',
    docType: 'contrato',
    version: 1,
    status: 'rascunho',
    isExampleTemplate: true,
    allowedRoles: ['assistente', 'gestor', 'administrador'],
    fieldsSchema: [
      { key: 'customer_name', label: 'Comprador', type: 'text', required: true, source: 'session' },
      { key: 'customer_cpf', label: 'CPF', type: 'text', required: true, source: 'lead' },
      { key: 'vehicle_title', label: 'Veículo objeto', type: 'text', required: true, source: 'vehicle' },
      { key: 'vehicle_plate', label: 'Placa', type: 'text', required: true, source: 'vehicle' },
      { key: 'vehicle_price', label: 'Preço total acordado (R$)', type: 'currency', required: true, source: 'vehicle' },
      { key: 'payment_mode', label: 'Condição de pagamento', type: 'text', required: true },
      { key: 'observations', label: 'Cláusulas adicionais', type: 'textarea', required: false },
    ],
    bodyTemplate:
      '[MODELO DE EXEMPLO PARA AMBIENTE DE TESTE — SUBSTITUIR PELO CONTRATO OFICIAL APROVADO PELO JURÍDICO DA REVENDA] As partes celebram a compra e venda do veículo identificado acima, mediante pagamento integral nas condições acordadas.',
  },
];

function toLooseBoolean(val: string | number | boolean | null | undefined): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const norm = val
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    if (!norm || norm === 'false' || norm === 'nao' || norm === '0' || norm === 'no') {
      return false;
    }
    return true;
  }
  return false;
}

export function isFieldVisible(
  field: DocumentFieldSchema,
  values: Record<string, string | number | boolean | null | undefined>
): boolean {
  if (!field.showWhen) return true;
  const currentVal = values[field.showWhen.field];
  if (typeof field.showWhen.equals === 'boolean') {
    return toLooseBoolean(currentVal) === field.showWhen.equals;
  }
  return String(currentVal ?? '').trim().toLowerCase() === String(field.showWhen.equals).trim().toLowerCase();
}

export function buildPrefilledDocumentValues(
  template: Pick<DocumentTemplateRecord, 'docType' | 'fieldsSchema'>,
  ctx: DocumentPrefillContext
): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
  const v = ctx.vehicle;
  const vehicleTitle = v
    ? `${v.brand} ${v.model}${v.version && !v.model.toLowerCase().includes(v.version.toLowerCase()) ? ` ${v.version}` : ''}`.trim()
    : '';
  const hasTradeIn = Boolean(ctx.tradeIn?.brandModel);

  const todayIso = new Date().toISOString().slice(0, 10);

  for (const field of template.fieldsSchema) {
    switch (field.key) {
      case 'customer_name':
        values[field.key] = ctx.customerName?.trim() || '';
        break;
      case 'customer_phone':
        values[field.key] = ctx.customerPhone?.trim() || '';
        break;
      case 'customer_cpf':
        values[field.key] = ctx.customerCpf?.trim() || '';
        break;
      case 'vehicle_title':
        values[field.key] = vehicleTitle;
        break;
      case 'vehicle_year':
        values[field.key] = v?.year || '';
        break;
      case 'vehicle_km':
        values[field.key] = v ? formatKm(v.km) : '';
        break;
      case 'vehicle_plate':
        values[field.key] = v?.plate || '';
        break;
      case 'vehicle_price':
        values[field.key] = v && v.price > 0 ? v.price : 0;
        break;
      case 'payment_mode':
        if (ctx.downPayment && ctx.downPayment > 0) {
          values[field.key] = hasTradeIn ? 'Financiamento + Troca' : 'Financiamento';
        } else {
          values[field.key] = hasTradeIn ? 'À vista + Troca' : 'Financiamento';
        }
        break;
      case 'down_payment':
        values[field.key] = typeof ctx.downPayment === 'number' && ctx.downPayment >= 0 ? ctx.downPayment : '';
        break;
      case 'installments':
        values[field.key] = typeof ctx.installments === 'number' && ctx.installments > 0 ? ctx.installments : '';
        break;
      case 'has_trade_in':
        values[field.key] = hasTradeIn;
        break;
      case 'trade_in_vehicle':
        values[field.key] = ctx.tradeIn?.brandModel || '';
        break;
      case 'trade_in_year':
        values[field.key] = ctx.tradeIn?.yearText || '';
        break;
      case 'trade_in_km':
        values[field.key] = ctx.tradeIn?.km ? formatKm(ctx.tradeIn.km) : '';
        break;
      case 'trade_in_transmission':
        values[field.key] = ctx.tradeIn?.transmission || '';
        break;
      case 'trade_in_plate':
        values[field.key] = ctx.tradeIn?.plate || '';
        break;
      case 'trade_in_condition':
        values[field.key] = ctx.tradeIn?.conditionNotes || '';
        break;
      case 'trade_in_value':
        values[field.key] =
          typeof ctx.tradeIn?.approvedValue === 'number' && ctx.tradeIn.approvedValue > 0
            ? ctx.tradeIn.approvedValue
            : '';
        break;
      case 'validity_days':
        values[field.key] = 3;
        break;
      case 'visit_date':
        values[field.key] = ctx.visitDate || todayIso;
        break;
      case 'visit_time':
        values[field.key] = ctx.visitTime || '';
        break;
      case 'delivery_date':
        values[field.key] = todayIso;
        break;
      case 'has_manual_key':
        values[field.key] = true;
        break;
      default:
        values[field.key] = field.type === 'boolean' ? false : '';
    }
  }

  return values;
}

export function getMissingRequiredFields(
  fieldsSchema: DocumentFieldSchema[],
  values: Record<string, string | number | boolean | null | undefined>
): DocumentFieldSchema[] {
  return fieldsSchema.filter((field) => {
    if (!field.required) return false;
    if (!isFieldVisible(field, values)) return false;
    const raw = values[field.key];
    if (raw === null || raw === undefined) return true;
    if (field.type === 'currency' || field.type === 'number') {
      const n = Number(raw);
      return raw === '' || !Number.isFinite(n) || n < 0;
    }
    if (field.type === 'boolean') return false;
    return String(raw).trim().length === 0;
  });
}

export function computeDocumentFinancials(
  values: Record<string, string | number | boolean | null | undefined>,
  dealership: DealershipSettings
): DocumentCalculatedTotals {
  const vehiclePrice = Math.max(0, Number(values.vehicle_price) || 0);
  const downPayment = Math.max(0, Number(values.down_payment) || 0);
  const hasTradeIn = Boolean(values.has_trade_in);
  const tradeInValue = hasTradeIn ? Math.max(0, Number(values.trade_in_value) || 0) : 0;
  const principalBalance = Math.max(0, vehiclePrice - downPayment - tradeInValue);
  const rawInstallments = Number(values.installments);
  const installments =
    Number.isFinite(rawInstallments) && rawInstallments > 0
      ? Math.round(rawInstallments)
      : null;

  const rate =
    typeof dealership.financingMonthlyRatePct === 'number' &&
    dealership.financingMonthlyRatePct > 0
      ? dealership.financingMonthlyRatePct
      : null;

  if (principalBalance === 0 && vehiclePrice > 0) {
    return {
      vehiclePrice,
      downPayment,
      tradeInValue,
      principalBalance: 0,
      installments: null,
      monthlyRatePct: null,
      estimatedInstallment: null,
      calculationType: 'a_vista',
      note: 'Quitação integral sem saldo a financiar.',
    };
  }

  if (rate && installments && principalBalance > 0) {
    const i = rate / 100;
    const factor = Math.pow(1 + i, installments);
    const pmt = (principalBalance * i * factor) / (factor - 1);
    return {
      vehiclePrice,
      downPayment,
      tradeInValue,
      principalBalance,
      installments,
      monthlyRatePct: rate,
      estimatedInstallment: Math.round(pmt * 100) / 100,
      calculationType: 'estimativa_taxa_configurada',
      note: `Estimativa ilustrativa com taxa de referência configurada (${rate.toFixed(2)}% a.m.), sujeita à aprovação bancária e IOF.`,
    };
  }

  return {
    vehiclePrice,
    downPayment,
    tradeInValue,
    principalBalance,
    installments,
    monthlyRatePct: null,
    estimatedInstallment: null,
    calculationType: 'saldo_antes_de_encargos',
    note: 'Cálculo determinístico do saldo principal antes de juros, IOF e tarifas bancárias. Parcela final depende da taxa aprovada no CPF.',
  };
}

export function renderDocumentPreviewText(params: {
  template: Pick<DocumentTemplateRecord, 'name' | 'version' | 'docType' | 'fieldsSchema' | 'bodyTemplate' | 'isExampleTemplate'>;
  dealership: DealershipSettings;
  values: Record<string, string | number | boolean | null | undefined>;
  totals: DocumentCalculatedTotals;
  issuedByName: string;
  documentNumber?: string;
}): string {
  const { template, dealership, values, totals, issuedByName, documentNumber } = params;
  const addr = formatDealershipAddress(dealership);
  const hours = formatDealershipHours(dealership);
  const lines: string[] = [];

  lines.push(`${dealership.tradeName.toUpperCase()} — ${template.name.toUpperCase()}`);
  if (documentNumber) lines.push(`Documento Nº ${documentNumber} · Modelo v${template.version}`);
  if (template.isExampleTemplate) {
    lines.push('AVISO: Modelo de exemplo para ambiente de teste — validar texto jurídico oficial no Admin.');
  }
  lines.push(`Endereço oficial: ${addr || 'Confirme o endereço com a revenda'}`);
  if (hours.hasAny) lines.push(`Horários: ${hours.summaryLine}`);
  if (dealership.cnpj) lines.push(`CNPJ: ${dealership.cnpj}`);
  lines.push('');

  for (const field of template.fieldsSchema) {
    if (!isFieldVisible(field, values)) continue;
    const raw = values[field.key];
    if (raw === '' || raw === null || raw === undefined) continue;
    let formatted = String(raw);
    if (field.type === 'currency') {
      formatted = formatBRL(Number(raw) || 0);
    } else if (field.type === 'boolean') {
      formatted = raw ? 'Sim' : 'Não';
    }
    lines.push(`${field.label}: ${formatted}`);
  }

  if (template.docType === 'proposta_comercial' && totals.vehiclePrice > 0) {
    lines.push('');
    lines.push('RESUMO FINANCEIRO (CÁLCULO DETERMINÍSTICO)');
    lines.push(`Valor do veículo: ${formatBRL(totals.vehiclePrice)}`);
    lines.push(`Entrada informada: ${formatBRL(totals.downPayment)}`);
    if (totals.tradeInValue > 0) {
      lines.push(`Troca pré-aprovada: ${formatBRL(totals.tradeInValue)}`);
    }
    lines.push(`Saldo principal antes de encargos: ${formatBRL(totals.principalBalance)}`);
    if (totals.installments) {
      if (totals.estimatedInstallment && totals.monthlyRatePct) {
        lines.push(
          `Parcela estimada (${totals.installments}x a ${totals.monthlyRatePct.toFixed(2)}% a.m.): ${formatBRL(totals.estimatedInstallment)}`
        );
      } else {
        lines.push(`Prazo solicitado: ${totals.installments}x (parcela a confirmar mediante taxa bancária)`);
      }
    }
    lines.push(totals.note);
  }

  lines.push('');
  lines.push(template.bodyTemplate);
  lines.push('');
  lines.push(`Emissor: ${issuedByName}`);
  return lines.join('\n');
}

export function buildPdfBytesFromIssuedDocument(doc: IssuedDocumentRecord): Uint8Array {
  const dealership = doc.dealershipSnapshot;
  const addr = formatDealershipAddress(dealership);
  const phone = formatPhoneDisplay(dealership.salesWhatsapp || dealership.whatsapp || dealership.phone);
  const issuedDate = new Date(doc.createdAt).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const sections: PdfSection[] = [];

  const customerRows: Array<{ label: string; value: string }> = [];
  if (doc.values.customer_name) customerRows.push({ label: 'Cliente', value: String(doc.values.customer_name) });
  if (doc.values.customer_phone) customerRows.push({ label: 'WhatsApp / Telefone', value: String(doc.values.customer_phone) });
  if (doc.values.customer_cpf) customerRows.push({ label: 'CPF', value: String(doc.values.customer_cpf) });
  if (doc.values.customer_cnh) customerRows.push({ label: 'CNH', value: String(doc.values.customer_cnh) });
  if (customerRows.length > 0) {
    sections.push({ title: 'Identificação do Cliente', rows: customerRows });
  }

  const vehicleRows: Array<{ label: string; value: string }> = [];
  if (doc.values.vehicle_title) vehicleRows.push({ label: 'Veículo', value: String(doc.values.vehicle_title) });
  if (doc.values.vehicle_year) vehicleRows.push({ label: 'Ano / Modelo', value: String(doc.values.vehicle_year) });
  if (doc.values.vehicle_km) vehicleRows.push({ label: 'Quilometragem', value: String(doc.values.vehicle_km) });
  if (doc.values.vehicle_plate) vehicleRows.push({ label: 'Placa', value: String(doc.values.vehicle_plate) });
  if (doc.values.payment_mode) vehicleRows.push({ label: 'Forma de pagamento', value: String(doc.values.payment_mode) });
  if (doc.values.visit_date) {
    vehicleRows.push({
      label: 'Visita agendada',
      value: `${doc.values.visit_date}${doc.values.visit_time ? ` às ${doc.values.visit_time}` : ''}`,
    });
  }
  if (doc.values.validity_days) {
    vehicleRows.push({ label: 'Validade da proposta', value: `${doc.values.validity_days} dia(s)` });
  }
  if (vehicleRows.length > 0) {
    sections.push({ title: 'Dados da Operação e Veículo', rows: vehicleRows });
  }

  // Trade-in section if present
  if (doc.values.has_trade_in || doc.docType === 'pre_avaliacao_troca') {
    const tradeRows: Array<{ label: string; value: string }> = [];
    if (doc.values.trade_in_vehicle) tradeRows.push({ label: 'Usado na troca', value: String(doc.values.trade_in_vehicle) });
    if (doc.values.trade_in_year) tradeRows.push({ label: 'Ano/Modelo', value: String(doc.values.trade_in_year) });
    if (doc.values.trade_in_km) tradeRows.push({ label: 'Quilometragem', value: String(doc.values.trade_in_km) });
    if (doc.values.trade_in_transmission) tradeRows.push({ label: 'Câmbio', value: String(doc.values.trade_in_transmission) });
    if (doc.values.trade_in_plate) tradeRows.push({ label: 'Placa', value: String(doc.values.trade_in_plate) });
    if (doc.values.trade_in_condition) tradeRows.push({ label: 'Estado / Pendências', value: String(doc.values.trade_in_condition) });
    if (Number(doc.values.trade_in_value) > 0) {
      tradeRows.push({ label: 'Valor pré-aprovado', value: formatBRL(Number(doc.values.trade_in_value)) });
    }
    if (tradeRows.length > 0) {
      sections.push({ title: 'Veículo Oferecido na Troca', rows: tradeRows });
    }
  }

  // Financial highlight box for Proposta Comercial
  const totals = doc.calculatedTotals;
  if (totals && totals.vehiclePrice > 0 && (doc.docType === 'proposta_comercial' || doc.docType === 'recibo' || doc.docType === 'contrato')) {
    const finLines: Array<{ label: string; value: string; bold?: boolean }> = [
      { label: 'Valor do veículo', value: formatBRL(totals.vehiclePrice) },
      { label: 'Entrada informada', value: `- ${formatBRL(totals.downPayment)}` },
    ];
    if (totals.tradeInValue > 0) {
      finLines.push({ label: 'Troca pré-aprovada', value: `- ${formatBRL(totals.tradeInValue)}` });
    }
    finLines.push({
      label: 'Saldo principal antes de encargos',
      value: formatBRL(totals.principalBalance),
      bold: true,
    });
    if (totals.installments) {
      finLines.push({
        label:
          totals.estimatedInstallment && totals.monthlyRatePct
            ? `Estimativa (${totals.installments}x · ${totals.monthlyRatePct.toFixed(2)}% a.m.)`
            : `Prazo solicitado (${totals.installments}x)`,
        value:
          totals.estimatedInstallment && totals.monthlyRatePct
            ? formatBRL(totals.estimatedInstallment)
            : 'Taxa sob análise de crédito',
      });
    }
    sections.push({
      title: 'Resumo Financeiro',
      highlightBox: {
        title: 'Demonstrativo de Valores (Cálculo exato sem estimativa arbitrária)',
        lines: finLines,
        footnote: totals.note,
      },
    });
  }

  // Observations & Terms
  const paragraphs: string[] = [];
  if (doc.values.observations) {
    paragraphs.push(`Observações: ${String(doc.values.observations)}`);
  }
  const bodyLines = doc.renderedText
    .split('\n\n')
    .filter((block) => !block.startsWith('RESUMO FINANCEIRO') && !block.startsWith('Emissor:'))
    .slice(-1);
  if (bodyLines[0]) {
    paragraphs.push(bodyLines[0]);
  }
  if (paragraphs.length > 0) {
    sections.push({ title: 'Condições Gerais e Observações', paragraphs });
  }

  const payload: PdfDocumentPayload = {
    documentNumber: `#${String(doc.id).padStart(5, '0')}`,
    title: doc.templateName,
    subtitle: doc.supersedesDocumentId
      ? `Documento revisado (substitui emissão #${String(doc.supersedesDocumentId).padStart(5, '0')})`
      : 'Documento emitido com registro histórico imutável pela Central da Revenda',
    dealershipName: dealership.tradeName || 'Armazém do Carro',
    dealershipLegalLine: [dealership.legalName, dealership.cnpj ? `CNPJ ${dealership.cnpj}` : '']
      .filter(Boolean)
      .join(' · '),
    dealershipAddress: addr || 'Endereço oficial a confirmar com a revenda',
    dealershipContact: [phone ? `WhatsApp ${phone}` : '', dealership.email || '']
      .filter(Boolean)
      .join(' · '),
    issuedAtFormatted: issuedDate,
    issuedByName: doc.issuedByName,
    templateMeta: `Modelo: ${doc.templateSlug} v${doc.templateVersion}`,
    sections,
    signatures: [
      { label: dealership.tradeName || 'Revenda', sublabel: `Emissor: ${doc.issuedByName}` },
      {
        label: String(doc.values.customer_name || 'Cliente / Proponente'),
        sublabel: doc.values.customer_cpf ? `CPF: ${String(doc.values.customer_cpf)}` : 'Assinatura de ciência',
      },
    ],
    footerNote:
      'Registro histórico preservado. Alterações futuras no endereço, preço ou modelo não alteram este documento.',
  };

  return generateDealershipPdf(payload);
}
