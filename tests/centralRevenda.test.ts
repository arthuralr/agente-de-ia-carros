import assert from 'node:assert/strict';
import test from 'node:test';
import type { DealershipSettings, IssuedDocumentRecord, Vehicle } from '../src/types';
import {
  canAccessModule,
  canEmitTemplateForRole,
  getAllowedModules,
  hasPermission,
  normalizeStaffRole,
} from '../src/utils/rbac';
import {
  buildDeterministicMarketingOutput,
  buildTrackedVehicleSheetUrl,
  revalidateMarketingDraft,
} from '../src/utils/marketingTemplates';
import {
  buildPdfBytesFromIssuedDocument,
  buildPrefilledDocumentValues,
  computeDocumentFinancials,
  DEFAULT_DOCUMENT_TEMPLATES,
  getMissingRequiredFields,
  isFieldVisible,
  renderDocumentPreviewText,
} from '../src/utils/documentEngine';

const SAMPLE_DEALERSHIP: DealershipSettings = {
  tradeName: 'Armazém do Carro',
  legalName: 'Armazém do Carro Veículos Ltda',
  cnpj: '12.345.678/0001-90',
  stateRegistration: '123456789',
  phone: '(48) 3333-4444',
  whatsapp: '5548999990000',
  salesWhatsapp: '5548999990000',
  salesWhatsappLabel: 'Consultor de Vendas',
  financingWhatsapp: '',
  financingWhatsappLabel: 'Financeiro',
  email: 'contato@armazemdocarro.com.br',
  address: 'Rua Oficial do Showroom, 500 — Centro',
  city: 'Florianópolis',
  state: 'SC',
  hoursWeekdays: '08h30 às 18h30',
  hoursSaturday: '09h às 13h',
  hoursSunday: 'Fechado',
  minResaleMarginPct: 12,
  defaultSocialCta: 'Fale com nossa equipe no WhatsApp',
  aiAssistantName: 'Consultor Virtual',
  warrantyDays: 90,
  warrantyKm: 3000,
  financingMonthlyRatePct: null,
};

const ONIX_VEHICLE: Vehicle = {
  id: '13',
  brand: 'Chevrolet',
  model: 'Onix JOY Hatch 1.0 8V Black Edition Flex Mec.',
  version: '1.0 8V Black Edition',
  category: 'Hatches',
  year: '2021/2021',
  km: 58000,
  price: 55900,
  fipePrice: 58500,
  fipeCode: '004519-5',
  fipeReferenceMonth: 'novembro de 2026',
  color: 'Preto',
  transmission: 'Manual',
  fuel: 'Flex',
  plate: 'ABC1D23',
  renavam: '',
  chassis: '',
  status: 'Disponível',
  imageUrl: 'https://example.com/onix.jpg',
  gallery: ['https://example.com/onix.jpg', 'https://example.com/onix-2.jpg'],
  optionals: ['Ar-condicionado', 'Direção elétrica', 'Airbag duplo'],
  createdAt: '2026-01-10',
};

test('RBAC: enforces canonical 4-role matrix and legacy admin compatibility', () => {
  assert.equal(normalizeStaffRole(null, 'Gerente Comercial'), 'administrador');
  assert.equal(normalizeStaffRole('vendedor', 'Vendedor'), 'vendedor');
  assert.equal(normalizeStaffRole('assistente', null), 'assistente');
  assert.equal(normalizeStaffRole('gestor', null), 'gestor');

  // Vendedor: can view/claim/reply own sessions, read stock, create marketing, emit commercial docs; CANNOT edit stock, view gestão, or edit settings/team
  assert.equal(hasPermission('vendedor', 'sessions:claim'), true);
  assert.equal(hasPermission('vendedor', 'marketing:create'), true);
  assert.equal(hasPermission('vendedor', 'documents:emit_commercial'), true);
  assert.equal(hasPermission('vendedor', 'inventory:edit'), false);
  assert.equal(hasPermission('vendedor', 'management:view'), false);
  assert.equal(hasPermission('vendedor', 'settings:edit_dealership'), false);
  assert.equal(hasPermission('vendedor', 'team:manage'), false);
  assert.equal(canAccessModule('vendedor', 'gestao'), false);
  assert.equal(canAccessModule('vendedor', 'configuracoes'), false);

  // Assistente: can edit stock & emit operational docs; CANNOT manage team/settings or view gestão
  assert.equal(hasPermission('assistente', 'inventory:edit'), true);
  assert.equal(hasPermission('assistente', 'documents:emit_operational'), true);
  assert.equal(hasPermission('assistente', 'sessions:view_all'), false);
  assert.equal(hasPermission('assistente', 'team:manage'), false);
  assert.equal(canAccessModule('assistente', 'atendimentos'), false);
  assert.equal(canAccessModule('assistente', 'estoque'), true);

  // Gestor: can see all sessions, reassign, view gestão, approve trade-ins; CANNOT change dealership settings or team
  assert.equal(hasPermission('gestor', 'sessions:view_all'), true);
  assert.equal(hasPermission('gestor', 'sessions:assign_others'), true);
  assert.equal(hasPermission('gestor', 'management:view'), true);
  assert.equal(hasPermission('gestor', 'trade_ins:approve_value'), true);
  assert.equal(hasPermission('gestor', 'settings:edit_dealership'), false);
  assert.equal(hasPermission('gestor', 'team:manage'), false);

  // Administrador: full access to all 8 modules
  assert.equal(getAllowedModules('administrador').length, 8);
  assert.equal(hasPermission('administrador', 'team:manage'), true);
  assert.equal(hasPermission('administrador', 'documents:manage_templates'), true);

  // Template role restriction
  const entregaTpl = DEFAULT_DOCUMENT_TEMPLATES.find((t) => t.slug === 'checklist-termo-entrega')!;
  assert.equal(canEmitTemplateForRole('vendedor', entregaTpl.allowedRoles), false);
  assert.equal(canEmitTemplateForRole('assistente', entregaTpl.allowedRoles), true);
});

test('Divulgação (zero tokens): generates tracked URL, copy, carousel and detects price/status drift', () => {
  const tracked = buildTrackedVehicleSheetUrl('13', 'stories', 'https://armazem.exemplo.com');
  assert.equal(tracked.trackingSource, 'divulgacao_stories');
  assert.equal(tracked.path, '/veiculo/13?origem=divulgacao_stories');
  assert.equal(tracked.fullUrl, 'https://armazem.exemplo.com/veiculo/13?origem=divulgacao_stories');

  const kit = buildDeterministicMarketingOutput({
    vehicle: ONIX_VEHICLE,
    dealership: SAMPLE_DEALERSHIP,
    format: 'carrossel',
    baseUrl: 'https://armazem.exemplo.com',
  });

  assert.equal(kit.carouselSlides.length, 4);
  assert.match(kit.caption, /55\.900/);
  assert.match(kit.caption, /\/veiculo\/13\?origem=divulgacao_carrossel/);
  assert.match(kit.caption, /Rua Oficial do Showroom, 500/);
  assert.match(kit.classifiedText, /FICHA TÉCNICA:/);
  assert.equal(kit.dataWarnings.length, 0);

  // Price change revalidation
  const priceDrift = revalidateMarketingDraft(55900, 'Disponível', {
    ...ONIX_VEHICLE,
    price: 53900,
  });
  assert.equal(priceDrift.priceChanged, true);
  assert.equal(priceDrift.priceDelta, -2000);
  assert.equal(priceDrift.canExportActiveOffer, true);

  // Sold vehicle blocks exporting as active offer
  const soldCheck = revalidateMarketingDraft(55900, 'Disponível', {
    ...ONIX_VEHICLE,
    status: 'Vendido',
  });
  assert.equal(soldCheck.isUnavailable, true);
  assert.equal(soldCheck.canExportActiveOffer, false);
  assert.ok(soldCheck.warnings.some((w) => w.includes('bloqueada')));
});

test('Documentos (zero tokens): deterministic financing math, conditional fields, PDF bytes and snapshot immutability', () => {
  const propostaTpl = DEFAULT_DOCUMENT_TEMPLATES.find((t) => t.slug === 'proposta-comercial')!;
  assert.ok(propostaTpl);

  const prefilled = buildPrefilledDocumentValues(propostaTpl, {
    dealership: SAMPLE_DEALERSHIP,
    vehicle: ONIX_VEHICLE,
    customerName: 'Lucas Ferreira',
    customerPhone: '(48) 99888-7766',
    downPayment: 20000,
    installments: 48,
    salespersonName: 'Ricardo',
  });

  // Conditional trade-in field hidden when has_trade_in is false
  const tradeVehicleField = propostaTpl.fieldsSchema.find((f) => f.key === 'trade_in_vehicle')!;
  assert.equal(isFieldVisible(tradeVehicleField, prefilled), false);
  assert.equal(getMissingRequiredFields(propostaTpl.fieldsSchema, prefilled).length, 0);

  // Enabling has_trade_in makes trade_in_vehicle visible & required
  const withTradeEnabled = { ...prefilled, has_trade_in: true };
  assert.equal(isFieldVisible(tradeVehicleField, withTradeEnabled), true);
  const missingWhenTrade = getMissingRequiredFields(propostaTpl.fieldsSchema, withTradeEnabled);
  assert.ok(missingWhenTrade.some((f) => f.key === 'trade_in_vehicle'));

  // Exact deterministic principal balance: 55.900 - 20.000 = 35.900
  const totals = computeDocumentFinancials(prefilled, SAMPLE_DEALERSHIP);
  assert.equal(totals.vehiclePrice, 55900);
  assert.equal(totals.downPayment, 20000);
  assert.equal(totals.principalBalance, 35900);
  assert.equal(totals.estimatedInstallment, null);
  assert.equal(totals.calculationType, 'saldo_antes_de_encargos');

  // With configured dealership rate, calculates illustrative installment
  const totalsWithRate = computeDocumentFinancials(prefilled, {
    ...SAMPLE_DEALERSHIP,
    financingMonthlyRatePct: 1.89,
  });
  assert.equal(totalsWithRate.principalBalance, 35900);
  assert.ok(totalsWithRate.estimatedInstallment && totalsWithRate.estimatedInstallment > 1000);

  const renderedText = renderDocumentPreviewText({
    template: propostaTpl,
    dealership: SAMPLE_DEALERSHIP,
    values: prefilled,
    totals,
    issuedByName: 'Ricardo',
    documentNumber: '#00042',
  });
  assert.match(renderedText, /35\.900/);
  assert.match(renderedText, /Rua Oficial do Showroom, 500/);

  // Real PDF binary generation & snapshot immutability check
  const issuedSnapshot: IssuedDocumentRecord = {
    id: 42,
    idempotencyKey: 'doc-test-42',
    templateId: 1,
    templateSlug: propostaTpl.slug,
    templateName: propostaTpl.name,
    templateVersion: 1,
    docType: 'proposta_comercial',
    sessionId: 'sess-demo',
    leadId: null,
    vehicleId: 13,
    supersedesDocumentId: null,
    issuedById: 1,
    issuedByName: 'Ricardo',
    dealershipSnapshot: { ...SAMPLE_DEALERSHIP },
    vehicleSnapshot: { id: '13', brand: ONIX_VEHICLE.brand, model: ONIX_VEHICLE.model, price: 55900 },
    values: { ...prefilled },
    calculatedTotals: totals,
    renderedText,
    createdAt: '2026-11-25T15:00:00.000Z',
  };

  const pdfBytes = buildPdfBytesFromIssuedDocument(issuedSnapshot);
  assert.ok(pdfBytes instanceof Uint8Array);
  assert.ok(pdfBytes.length > 800);
  const pdfAscii = Buffer.from(pdfBytes).toString('latin1');
  assert.ok(pdfAscii.startsWith('%PDF-1.4'));
  assert.ok(pdfAscii.includes('%%EOF'));
  assert.ok(pdfAscii.includes('35.900'));
  assert.ok(pdfAscii.includes('Rua Oficial do Showroom, 500'));
});
