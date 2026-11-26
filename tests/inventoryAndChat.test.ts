import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeVehicleDataQuality,
  analyzeVisitIntent,
  buildVehicleComparison,
  buildVehicleSheetPath,
  computeFinancingSummary,
  computeFipeMetrics,
  extractTradeInInfo,
  parseFinancingParams,
  parseFiltersDeterministically,
  resolveVehicleReference,
  searchAndRankInventory,
} from '../src/utils/vehicleDomain';
import { guardChatReply, planChatTurn } from '../src/utils/chatOrchestrator';
import { mapDbVehicleToFrontend } from '../src/db/mappers';
import {
  buildWhatsAppHandoffUrl,
  detectHumanHandoffIntent,
  resolveWhatsAppDestination,
} from '../src/utils/whatsappHandoff';
import { DealershipSettings, Vehicle } from '../src/types';

const TEST_SETTINGS: DealershipSettings = {
  tradeName: 'Armazém do Carro',
  legalName: 'Armazém do Carro Veículos Ltda.',
  cnpj: '12.345.678/0001-90',
  stateRegistration: '123.456.789.000',
  phone: '(11) 3042-8800',
  whatsapp: '5511994821040',
  salesWhatsapp: '5511994821040',
  salesWhatsappLabel: 'Consultor de Vendas',
  financingWhatsapp: '5511988887777',
  financingWhatsappLabel: 'Financeiro / Simulação',
  financingMonthlyRatePct: null,
  email: 'contato@armazemdocarro.com.br',
  address: 'Av. Europa, 1480 - Jardim Europa',
  city: 'São Paulo',
  state: 'SP',
  hoursWeekdays: '09h às 19h',
  hoursSaturday: '09h às 14h',
  hoursSunday: 'Fechado',
  minResaleMarginPct: 12,
  aiAssistantName: 'Consultor Virtual Armazém do Carro',
  defaultSocialCta: 'Fale com nossa equipe',
  warrantyDays: 90,
  warrantyKm: 3000,
};

// Mirrors the 6 real Neon records (without mutating production data)
const NEON_FIXTURE_VEHICLES: Vehicle[] = [
  {
    id: '9',
    brand: 'Honda',
    model: 'Hyundai Veloster',
    version: '1.6 16V 140cv Aut.',
    category: 'Esportivos',
    year: '2013/2013',
    km: 124574,
    price: 49900,
    fipePrice: 0,
    fipeCode: '',
    fipeReferenceMonth: '',
    color: 'Prata',
    transmission: 'Automático',
    fuel: 'Gasolina',
    plate: '',
    renavam: '',
    chassis: '',
    status: 'Disponível',
    imageUrl: 'https://example.com/veloster.jpg',
    optionals: [],
    createdAt: '2026-01-01',
  },
  {
    id: '10',
    brand: 'Renault',
    model: 'Mégane',
    version: 'Megane Grand Tour Dynamique 2.0 16V Aut. 2016',
    category: 'Sedans',
    year: '2016/2016',
    km: 172951,
    price: 299900,
    fipePrice: 0,
    fipeCode: '',
    fipeReferenceMonth: '',
    color: 'Cinza',
    transmission: 'Automático',
    fuel: 'Flex',
    plate: '',
    renavam: '',
    chassis: '',
    status: 'Disponível',
    imageUrl: 'https://example.com/megane.jpg',
    optionals: [],
    createdAt: '2026-01-02',
  },
  {
    id: '11',
    brand: 'Peugeot',
    model: '208',
    version: 'Griffe 1.6 Flex 16V 5p Aut.',
    category: 'Hatches',
    year: '2024/2024',
    km: 106243,
    price: 38900,
    fipePrice: 0,
    fipeCode: '',
    fipeReferenceMonth: '',
    color: 'Branco',
    transmission: 'Manual',
    fuel: 'Flex',
    plate: '',
    renavam: '',
    chassis: '',
    status: 'Disponível',
    imageUrl: 'https://example.com/208.jpg',
    optionals: [],
    createdAt: '2026-01-03',
  },
  {
    id: '12',
    brand: 'Chevrolet',
    model: 'Onix',
    version: 'HATCH Joy 1.0 8V Flex 5p Mec.',
    category: 'Hatches',
    year: '2018/2018',
    km: 120173,
    price: 43900,
    fipePrice: 0,
    fipeCode: '',
    fipeReferenceMonth: '',
    color: 'Prata',
    transmission: 'Automático',
    fuel: 'Flex',
    plate: '',
    renavam: '',
    chassis: '',
    status: 'Disponível',
    imageUrl: 'https://example.com/onix2018.jpg',
    optionals: [],
    createdAt: '2026-01-04',
  },
  {
    id: '13',
    brand: 'Chevrolet',
    model: 'Onix',
    version: 'JOY Hatch 1.0 8V Black Edition Flex Mec. 2021',
    category: 'Hatches',
    year: '2021/2021',
    km: 82700,
    price: 55900,
    fipePrice: 0,
    fipeCode: '',
    fipeReferenceMonth: '',
    color: 'Preto',
    transmission: 'Manual',
    fuel: 'Flex',
    plate: '',
    renavam: '',
    chassis: '',
    status: 'Disponível',
    imageUrl: 'https://example.com/onix2021.jpg',
    optionals: [],
    createdAt: '2026-01-05',
  },
  {
    id: '14',
    brand: 'Volkswagen',
    model: 'Gol',
    version: 'Gol - 1.0 Flex 12V 5p - 2021/2021',
    category: 'Hatches',
    year: '2021/2021',
    km: 77500,
    price: 43900,
    fipePrice: 0,
    fipeCode: '',
    fipeReferenceMonth: '',
    color: 'Branco',
    transmission: 'Automático',
    fuel: 'Flex',
    plate: '',
    renavam: '',
    chassis: '',
    status: 'Disponível',
    imageUrl: 'https://example.com/gol.jpg',
    optionals: [],
    createdAt: '2026-01-06',
  },
];

test('1. Data quality detects Aut./Manual and Mec./Automático conflicts, brand mismatch, and outlier price', () => {
  const peugeot = analyzeVehicleDataQuality(NEON_FIXTURE_VEHICLES[2]); // id 11
  assert.equal(peugeot.transmissionStatus, 'conflict');
  assert.equal(peugeot.hasTransmissionConflict, true);
  assert.equal(peugeot.canonicalTransmission, null);
  assert.equal(peugeot.needsReview, true);

  const onix2018 = analyzeVehicleDataQuality(NEON_FIXTURE_VEHICLES[3]); // id 12
  assert.equal(onix2018.transmissionStatus, 'conflict');
  assert.equal(onix2018.hasTransmissionConflict, true);
  assert.equal(onix2018.canonicalTransmission, null);
  assert.equal(onix2018.needsReview, true);

  const veloster = analyzeVehicleDataQuality(NEON_FIXTURE_VEHICLES[0]); // id 9
  assert.equal(veloster.hasBrandModelMismatch, true);

  const megane = analyzeVehicleDataQuality(NEON_FIXTURE_VEHICLES[1]); // id 10
  assert.equal(megane.hasOutlierPrice, true);
});

test('2. Deterministic filter excludes conflicting records and applies inclusive price/km limits', () => {
  const parsed = parseFiltersDeterministically(
    'Quero carro automático até R$ 60 mil com no máximo 90 mil km'
  );
  assert.equal(parsed.filters.transmission, 'automatico');
  assert.equal(parsed.filters.maxPrice, 60000);
  assert.equal(parsed.filters.maxKm, 90000);

  const result = searchAndRankInventory(NEON_FIXTURE_VEHICLES, parsed.filters);
  const exactIds = result.exactMatches.map((v) => v.id);
  // Peugeot 208 (id=11) & Onix 2018 (id=12) MUST NOT satisfy mandatory automatic filter
  assert.equal(exactIds.includes('11'), false);
  assert.equal(exactIds.includes('12'), false);
  // Onix 2021 (id=13) is Manual, Veloster (id=9) has 124.574 km > 90.000
  assert.equal(exactIds.includes('13'), false);
  assert.equal(exactIds.includes('9'), false);
  // Gol 2021 (id=14) matches 43.900 <= 60.000 and 77.500 <= 90.000
  assert.deepEqual(exactIds, ['14']);

  // Inclusive boundary test: exactly 55.900 and 82.700 km for manual
  const boundary = searchAndRankInventory(NEON_FIXTURE_VEHICLES, {
    transmission: 'manual',
    maxPrice: 55900,
    maxKm: 82700,
  });
  assert.deepEqual(
    boundary.exactMatches.map((v) => v.id),
    ['13']
  );
});

test('3. Multi-turn filter preservation allows adjusting one constraint at a time', () => {
  const turn1 = parseFiltersDeterministically(
    'Quero carro automático até R$ 60 mil com até 90 mil km'
  );
  const turn2 = parseFiltersDeterministically('e até 130 mil km?', turn1.filters);
  assert.equal(turn2.filters.transmission, 'automatico');
  assert.equal(turn2.filters.maxPrice, 60000);
  assert.equal(turn2.filters.maxKm, 130000);

  const result = searchAndRankInventory(NEON_FIXTURE_VEHICLES, turn2.filters);
  const ids = result.exactMatches.map((v) => v.id);
  assert.ok(ids.includes('14'));
  assert.ok(ids.includes('9'));
  assert.equal(ids.includes('11'), false);
  assert.equal(ids.includes('12'), false);
});

test('4. No exact match reports empty exact matches and clearly labeled close alternatives with deltas', () => {
  const msg = 'Quero carro automático até R$ 35 mil com no máximo 50 mil km';
  const plan = planChatTurn({
    allVehicles: NEON_FIXTURE_VEHICLES,
    messages: [{ sender: 'cliente', text: msg }],
    latestUserUtterance: msg,
    chatContext: { baseUrl: 'http://localhost:3000' },
    dealership: TEST_SETTINGS,
  });
  assert.match(plan.deterministicReply, /não encontrei|nenhum/i);
  assert.ok(plan.vehicleCards.length > 0);
  assert.ok(plan.vehicleCards.every((c) => Boolean(c.alternativeNote)));
});

test('5. Vehicle sheet resolution handles ambiguity and generates direct /veiculo/:id link', () => {
  const ambiguous = resolveVehicleReference(
    'Manda a ficha do Onix',
    NEON_FIXTURE_VEHICLES
  );
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.candidates?.length, 2);

  const specific = resolveVehicleReference(
    'Manda a ficha do Onix 2021',
    NEON_FIXTURE_VEHICLES
  );
  assert.equal(specific.status, 'resolved');
  assert.equal(specific.vehicle?.id, '13');

  const msg = 'Manda a ficha do Onix 2021';
  const plan = planChatTurn({
    allVehicles: NEON_FIXTURE_VEHICLES,
    messages: [{ sender: 'cliente', text: msg }],
    latestUserUtterance: msg,
    chatContext: { baseUrl: 'http://localhost:3000' },
    dealership: TEST_SETTINGS,
  });
  assert.equal(plan.fichaUrl, 'http://localhost:3000/veiculo/13');
  assert.ok(plan.deterministicReply.includes(buildVehicleSheetPath('13')));
  assert.equal(plan.vehicleCards[0]?.id, '13');
});

test('6. Side-by-side comparison strictly includes only selected vehicles', () => {
  const selected = [NEON_FIXTURE_VEHICLES[4], NEON_FIXTURE_VEHICLES[5]]; // Onix 2021 & Gol 2021
  const cmp = buildVehicleComparison(selected);
  assert.ok(cmp !== null);
  assert.equal(cmp.vehicles.length, 2);
  assert.deepEqual(
    cmp.vehicles.map((v) => v.id),
    ['13', '14']
  );
  assert.ok(cmp.rows.some((r) => /preço/i.test(r.label)));
  assert.ok(cmp.rows.some((r) => /quilometragem|km/i.test(r.label)));
});

test('7. Truthful FIPE never fabricates 4% markup and requires reference month for below-FIPE offer', () => {
  // DB mapper must map null fipe_price -> 0 (NOT price * 1.04)
  const mapped = mapDbVehicleToFrontend({
    id: 13,
    brand: 'Chevrolet',
    model: 'Onix',
    version: 'JOY 2021',
    year_fab: 2021,
    year_model: 2021,
    price: '55900',
    fipe_price: null,
    fipe_code: null,
    fipe_reference_month: null,
    km: 82700,
    transmission: 'Manual',
    fuel: 'Flex',
    status: 'Disponivel',
    image_url: null,
    options: [],
    created_at: new Date().toISOString(),
  });
  assert.equal(mapped.fipePrice, 0);

  // FIPE value WITHOUT reference month -> cannot be advertised as confirmed below-FIPE offer
  const noMonth = computeFipeMetrics({
    ...NEON_FIXTURE_VEHICLES[4],
    fipePrice: 58136,
    fipeReferenceMonth: '',
  });
  assert.equal(noMonth.hasFipeValue, true);
  assert.equal(noMonth.hasReferenceMonth, false);
  assert.equal(noMonth.isConfirmedBelowFipeOffer, false);
  assert.equal(noMonth.fipeReferenceMonth, null);

  // FIPE value WITH reference month -> confirmed below-FIPE offer with exact diff
  const withMonth = computeFipeMetrics({
    ...NEON_FIXTURE_VEHICLES[4],
    fipePrice: 58136,
    fipeReferenceMonth: 'novembro de 2026',
  });
  assert.equal(withMonth.isConfirmedBelowFipeOffer, true);
  assert.equal(withMonth.diffBrl, 2236);
});

test('8. Deterministic financing math computes 55900 - 20000 = 35900 without inventing installments', () => {
  const msg = 'Quero financiar o Onix 2021 com R$ 20 mil de entrada em 48x';
  const params = parseFinancingParams(msg);
  assert.equal(params.downPayment, 20000);
  assert.equal(params.months, 48);

  const summary = computeFinancingSummary({
    vehicle: NEON_FIXTURE_VEHICLES[4],
    downPayment: params.downPayment!,
    months: params.months,
    monthlyRatePct: null,
  });
  assert.equal(summary.vehiclePrice, 55900);
  assert.equal(summary.downPayment, 20000);
  assert.equal(summary.principalBalance, 35900);
  assert.equal(summary.estimatedInstallment, null);

  const plan = planChatTurn({
    allVehicles: NEON_FIXTURE_VEHICLES,
    messages: [{ sender: 'cliente', text: msg }],
    latestUserUtterance: msg,
    chatContext: {},
    dealership: TEST_SETTINGS,
  });
  assert.equal(plan.financingSummary?.principalBalance, 35900);
  assert.ok(plan.deterministicReply.includes('35.900'));
  assert.equal(plan.financingSummary?.estimatedInstallment, null);

  // With configured illustrative rate, calculates Price installment cleanly
  const withRate = computeFinancingSummary({
    vehicle: NEON_FIXTURE_VEHICLES[4],
    downPayment: 20000,
    months: 48,
    monthlyRatePct: 1.89,
  });
  assert.ok((withRate.estimatedInstallment || 0) > 1000);
  assert.match(withRate.note, /ilustrativ/i);
});

test('9. Trade-in reuses stated vehicle info, prompts direct photo attachment, and never suggests photo link', () => {
  const msg =
    'Tenho um Sandero 2019 1.6 manual com 75 mil km para dar na troca';
  const extracted = extractTradeInInfo([msg]);
  assert.equal(extracted.year, '2019');
  assert.equal(extracted.km, '75.000 km');
  assert.equal(extracted.transmission, 'Manual');

  const plan = planChatTurn({
    allVehicles: NEON_FIXTURE_VEHICLES,
    messages: [{ sender: 'cliente', text: msg }],
    latestUserUtterance: msg,
    chatContext: {},
    dealership: TEST_SETTINGS,
  });
  assert.equal(plan.promptAttachPhotos, true);
  assert.match(plan.deterministicReply, /Sandero/i);
  assert.match(plan.deterministicReply, /75\.000/);
  assert.doesNotMatch(plan.deterministicReply, /link das fotos|envie um link/i);
});

test('10. Visit inquiry ("Não agende nada") answers Saturday hours without scheduling or handoff, and WhatsApp handoff respects opt-in & department routing', () => {
  const inquiryMsg = 'Qual o horário de sábado? Não agende nada';
  assert.equal(analyzeVisitIntent(inquiryMsg), 'inquiry_only');
  assert.equal(detectHumanHandoffIntent(inquiryMsg), false);

  const plan = planChatTurn({
    allVehicles: NEON_FIXTURE_VEHICLES,
    messages: [{ sender: 'cliente', text: inquiryMsg }],
    latestUserUtterance: inquiryMsg,
    chatContext: {},
    dealership: TEST_SETTINGS,
  });
  assert.equal(plan.isVisitInquiryOnly, true);
  assert.equal(plan.suppressHandoff, true);
  assert.ok(plan.deterministicReply.includes('09h às 14h'));

  // Explicit visit request is framed as solicitation, never confirmed
  const visitMsg = 'Quero agendar uma visita no sábado às 10h para ver o Onix 2021';
  const visitPlan = planChatTurn({
    allVehicles: NEON_FIXTURE_VEHICLES,
    messages: [{ sender: 'cliente', text: visitMsg }],
    latestUserUtterance: visitMsg,
    chatContext: {},
    dealership: TEST_SETTINGS,
  });
  assert.match(visitPlan.deterministicReply, /solicita[çc][ãa]o de visita/i);
  assert.doesNotMatch(visitPlan.deterministicReply, /visita confirmada/i);

  // WhatsApp destination routing + opt-in contact data
  const salesDest = resolveWhatsAppDestination(TEST_SETTINGS, 'sales');
  assert.equal(salesDest.normalizedNumber, '5511994821040');
  assert.equal(salesDest.label, 'Consultor de Vendas');

  const finDest = resolveWhatsAppDestination(TEST_SETTINGS, 'financing');
  assert.equal(finDest.normalizedNumber, '5511988887777');
  assert.equal(finDest.label, 'Financeiro / Simulação');

  const withoutOptIn = buildWhatsAppHandoffUrl({
    storeWhatsappNumber: salesDest.normalizedNumber,
    storeName: TEST_SETTINGS.tradeName,
    leadName: 'Maria Silva',
    leadPhone: '(11) 99999-0000',
    includeContactData: false,
    sessionId: 'sess-1234',
    vehicleLabel: 'Chevrolet Onix 2021',
  });
  assert.equal(withoutOptIn.text.includes('Maria Silva'), false);
  assert.equal(withoutOptIn.text.includes('99999-0000'), false);

  const withOptIn = buildWhatsAppHandoffUrl({
    storeWhatsappNumber: salesDest.normalizedNumber,
    storeName: TEST_SETTINGS.tradeName,
    leadName: 'Maria Silva',
    leadPhone: '(11) 99999-0000',
    includeContactData: true,
    sessionId: 'sess-1234',
    vehicleLabel: 'Chevrolet Onix 2021',
  });
  assert.equal(withOptIn.text.includes('Maria Silva'), true);
  assert.equal(withOptIn.text.includes('99999-0000'), true);
});

test('11. guardChatReply removes forbidden "link das fotos" and "visita confirmada" phrasing', () => {
  const visitPlan = planChatTurn({
    allVehicles: NEON_FIXTURE_VEHICLES,
    messages: [{ sender: 'cliente', text: 'Quero visitar sábado' }],
    latestUserUtterance: 'Quero visitar sábado',
    chatContext: {},
    dealership: TEST_SETTINGS,
  });

  const guarded = guardChatReply(
    'Sua visita confirmada para sábado! Envie o link das fotos do seu carro.',
    visitPlan
  );
  assert.doesNotMatch(guarded, /visita confirmada/i);
  assert.doesNotMatch(guarded, /link das fotos/i);
});

test('12. Real Neon brand/model formatting resolves Onix ambiguity, Onix 2021 ficha, financing and comparison', () => {
  const realShapeVehicles: Vehicle[] = [
    {
      ...NEON_FIXTURE_VEHICLES[5],
      id: '14',
      brand: 'Volkswagen Gol',
      model: 'Gol - 1.0 Flex 12V 5p - 2021/2021',
      version: '2021',
      year: '2021/2021',
      price: 43900,
      km: 77500,
      transmission: 'Automático',
    },
    {
      ...NEON_FIXTURE_VEHICLES[4],
      id: '13',
      brand: 'Chevrolet Onix',
      model: 'JOY Hatch 1.0 8V Black Edition Flex Mec.',
      version: '2021',
      year: '2021/2021',
      price: 55900,
      km: 82700,
      transmission: 'Manual',
    },
    {
      ...NEON_FIXTURE_VEHICLES[3],
      id: '12',
      brand: 'Chevrolet Onix',
      model: 'HATCH Joy 1.0 8V Flex 5p Mec.',
      version: 'HATCH Joy 1.0 8V Flex 5p Mec.',
      year: '2018/2018',
      price: 43900,
      km: 120173,
      transmission: 'Automático',
    },
    {
      ...NEON_FIXTURE_VEHICLES[2],
      id: '11',
      brand: 'Peugeot 208',
      model: 'Griffe 1.6 Flex 16V 5p Aut.',
      version: 'Griffe 1.6 Flex 16V 5p Aut.',
      year: '2024/2024',
      price: 38900,
      km: 106243,
      transmission: 'Manual',
    },
  ];

  // Ambiguous Onix -> returns both 12 and 13
  const ambPlan = planChatTurn({
    allVehicles: realShapeVehicles,
    messages: [{ sender: 'cliente', text: 'Manda a ficha do Onix' }],
    latestUserUtterance: 'Manda a ficha do Onix',
    chatContext: { baseUrl: 'http://localhost:3000' },
    dealership: TEST_SETTINGS,
  });
  assert.equal(ambPlan.intent, 'vehicle_sheet');
  assert.deepEqual(
    ambPlan.vehicleCards.map((c) => c.id).sort(),
    ['12', '13']
  );

  // Disambiguated Onix 2021 -> resolves directly to id 13
  const fichaPlan = planChatTurn({
    allVehicles: realShapeVehicles,
    messages: [{ sender: 'cliente', text: 'Manda a ficha do Onix 2021' }],
    latestUserUtterance: 'Manda a ficha do Onix 2021',
    chatContext: { baseUrl: 'http://localhost:3000' },
    dealership: TEST_SETTINGS,
  });
  assert.equal(fichaPlan.intent, 'vehicle_sheet');
  assert.equal(fichaPlan.fichaUrl, 'http://localhost:3000/veiculo/13');
  assert.deepEqual(
    fichaPlan.vehicleCards.map((c) => c.id),
    ['13']
  );

  // Financing Onix 2021 -> 55900 - 20000 = 35900 with zero invented installment
  const finPlan = planChatTurn({
    allVehicles: realShapeVehicles,
    messages: [{ sender: 'cliente', text: 'Quero financiar o Onix 2021 com R$ 20 mil de entrada em 48x' }],
    latestUserUtterance: 'Quero financiar o Onix 2021 com R$ 20 mil de entrada em 48x',
    chatContext: { baseUrl: 'http://localhost:3000' },
    dealership: TEST_SETTINGS,
  });
  assert.equal(finPlan.intent, 'financing');
  assert.equal(finPlan.financingSummary?.principalBalance, 35900);
  assert.equal(finPlan.financingSummary?.estimatedInstallment, null);

  // Comparison "Compare o Onix 2021 e o Gol 2021" -> strictly [13, 14]
  const cmpPlan = planChatTurn({
    allVehicles: realShapeVehicles,
    messages: [{ sender: 'cliente', text: 'Compare o Onix 2021 e o Gol 2021' }],
    latestUserUtterance: 'Compare o Onix 2021 e o Gol 2021',
    chatContext: { baseUrl: 'http://localhost:3000' },
    dealership: TEST_SETTINGS,
  });
  assert.equal(cmpPlan.intent, 'comparison');
  assert.deepEqual(
    cmpPlan.comparison?.vehicles.map((v) => v.id).sort(),
    ['13', '14']
  );
});

