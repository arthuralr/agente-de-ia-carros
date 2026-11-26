import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConsolidatedHandoffSummary,
  DEFAULT_DEALERSHIP_CONFIG,
  extractTradeInInfo,
  getVehicleDisplayTitle,
  mergeTradeInSessionState,
} from '../src/utils/vehicleDomain';
import { guardChatReply, planChatTurn } from '../src/utils/chatOrchestrator';
import { buildWhatsAppHandoffUrl } from '../src/utils/whatsappHandoff';
import { buildRouteSeoPayload, injectSeoIntoHtml } from '../src/utils/seo';
import { resolveAdminBootstrapEnv } from '../src/db/auth';
import type { DealershipSettings, Vehicle } from '../src/types';

const SAMPLE_SETTINGS: DealershipSettings = {
  ...DEFAULT_DEALERSHIP_CONFIG,
  tradeName: 'Armazém do Carro',
  address: 'Travessa Herbert, 32',
  city: 'Gravataí',
  state: 'RS',
  phone: '51982892257',
  whatsapp: '5511994821040',
  salesWhatsapp: '5511994821040',
  hoursWeekdays: '09h às 18h',
  hoursSaturday: '09h às 13h',
  hoursSunday: 'Fechado',
};

const SAMPLE_VEHICLES: Vehicle[] = [
  {
    id: '9',
    brand: 'Hyundai',
    model: 'Veloster',
    version: '1.6 16V 140cv Aut.',
    year: '2013/2013',
    km: 124574,
    price: 49900,
    fipePrice: 0,
    fipeCode: '',
    fipeReferenceMonth: null,
    color: 'Prata',
    transmission: 'Automático',
    fuel: 'Gasolina',
    plate: 'IXX0009',
    renavam: '',
    chassis: '',
    status: 'Disponível',
    imageUrl: 'https://example.com/veloster.jpg',
    optionals: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '13',
    brand: 'Chevrolet Onix',
    model: 'JOY Hatch 1.0 8V Black Edition Flex Mec.',
    version: '2021',
    year: '2021/2021',
    km: 82700,
    price: 55900,
    fipePrice: 0,
    fipeCode: '',
    fipeReferenceMonth: null,
    color: 'Preto',
    transmission: 'Manual',
    fuel: 'Flex',
    plate: 'IXX0013',
    renavam: '',
    chassis: '',
    status: 'Disponível',
    imageUrl: 'https://example.com/onix2021.jpg',
    optionals: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

test('getVehicleDisplayTitle removes duplicated brand/model words and dangling separators', () => {
  assert.equal(
    getVehicleDisplayTitle({
      brand: 'Volkswagen Gol',
      model: 'Gol - 1.0 Flex 12V 5p - 2021/2021',
      version: '2021',
    }),
    'Volkswagen Gol 1.0 Flex 12V 5p - 2021/2021'
  );
  assert.equal(
    getVehicleDisplayTitle({
      brand: 'Renault Mégane',
      model: 'Megane Grand Tour Dynamique 2.0 16V Aut.',
      version: '2016',
    }),
    'Renault Mégane Grand Tour Dynamique 2.0 16V Aut.'
  );
  assert.equal(
    getVehicleDisplayTitle({
      brand: 'Hyundai',
      model: 'Veloster',
      version: '1.6 16V 140cv Aut.',
    }),
    'Hyundai Veloster'
  );
});

test('mergeTradeInSessionState protects confirmed trade-in specs from silent overwrite and requests confirmation on conflict', () => {
  const first = mergeTradeInSessionState(
    null,
    extractTradeInInfo(['Quero dar meu Sandero Expression 2019 1.6 manual com 85.000 km na troca']),
    'Quero dar meu Sandero Expression 2019 1.6 manual com 85.000 km na troca'
  );
  assert.equal(first.conflicts.length, 0);
  assert.equal(first.state.brandModel, 'Sandero');
  assert.equal(first.state.yearText, '2019');
  assert.equal(first.state.transmission, 'Manual');
  assert.equal(first.state.kmText, '85.000 km');

  // Ambiguous follow-up mentioning a different model/year MUST NOT overwrite
  const ambiguous = mergeTradeInSessionState(
    first.state,
    extractTradeInInfo(['meu carro na troca é um HB20 2021 automático']),
    'meu carro na troca é um HB20 2021 automático'
  );
  assert.ok(ambiguous.conflicts.length >= 1);
  assert.equal(ambiguous.state.brandModel, 'Sandero');
  assert.equal(ambiguous.state.yearText, '2019');
  assert.equal(ambiguous.state.transmission, 'Manual');

  // Explicit correction updates cleanly
  const corrected = mergeTradeInSessionState(
    first.state,
    extractTradeInInfo(['Na verdade corrigindo, o meu carro na troca é 2020 automático']),
    'Na verdade corrigindo, o meu carro na troca é 2020 automático'
  );
  assert.equal(corrected.conflicts.length, 0);
  assert.equal(corrected.wasExplicitCorrection, true);
  assert.equal(corrected.state.yearText, '2020');
  assert.equal(corrected.state.transmission, 'Automático');
});

test('planChatTurn keeps interest vehicle separate from trade-in and asks confirmation on conflicting trade-in turn', () => {
  const plan = planChatTurn({
    allVehicles: SAMPLE_VEHICLES,
    messages: [
      { sender: 'cliente', text: 'Quero simular o Onix 2021' },
      { sender: 'cliente', text: 'Meu carro na troca é um HB20 2022 automático' },
    ],
    latestUserUtterance: 'Meu carro na troca é um HB20 2022 automático',
    chatContext: {
      focusedVehicleId: '13',
      confirmedTradeIn: {
        brandModel: 'Sandero',
        version: 'Expression',
        yearText: '2019',
        transmission: 'Manual',
        kmText: '85.000 km',
        photosCount: 2,
      },
    },
    dealership: SAMPLE_SETTINGS,
  });

  assert.equal(plan.intent, 'trade_in');
  assert.equal(plan.useDeterministicDirectly, true);
  assert.equal(plan.focusedVehicleId, '13');
  assert.equal(plan.tradeInSummary?.brandModel, 'Sandero');
  assert.match(plan.deterministicReply, /Mantive os dados já confirmados/i);
  assert.match(plan.deterministicReply, /Sandero/i);
  assert.match(plan.handoffSummary || '', /Interesse:.*Onix/i);
  assert.match(plan.handoffSummary || '', /Troca:.*Sandero/i);
});

test('consolidated handoff summary and WhatsApp URL include vehicle of interest, financing, and trade-in', () => {
  const financingSummary = {
    vehicleId: '13',
    vehicleTitle: 'Chevrolet Onix JOY Hatch 1.0 8V Black Edition Flex Mec. 2021/2021',
    vehiclePrice: 55900,
    downPayment: 15000,
    principalBalance: 40900,
    months: 48,
    monthlyRatePct: null,
    estimatedInstallment: null,
    isIllustrativeOnly: false,
    note: 'Saldo base',
  };
  const confirmedTradeIn = {
    brandModel: 'Sandero',
    yearText: '2019',
    transmission: 'Manual',
    kmText: '85.000 km',
    photosCount: 3,
  };

  const summary = buildConsolidatedHandoffSummary({
    focusedVehicle: SAMPLE_VEHICLES[1],
    financingSummary,
    tradeInSummary: confirmedTradeIn,
  });
  assert.ok(summary);
  assert.match(summary!, /Interesse:.*Onix/i);
  assert.match(summary!, /entrada R\$\s*15\.000/i);
  assert.match(summary!, /saldo R\$\s*40\.900/i);
  assert.match(summary!, /Troca:.*Sandero.*2019.*3 fotos anexadas/i);

  const wa = buildWhatsAppHandoffUrl({
    storeWhatsappNumber: '5511994821040',
    focusedVehicle: SAMPLE_VEHICLES[1],
    financingSummary,
    confirmedTradeIn,
    sessionId: 'sess-abcdef123456',
    baseUrl: 'https://agente-de-ia-carros.vercel.app',
  });
  assert.match(wa.text, /Onix/i);
  assert.match(wa.text, /entrada R\$\s*15\.000/i);
  assert.match(wa.text, /saldo a financiar R\$\s*40\.900/i);
  assert.match(wa.text, /Usado na troca:.*Sandero/i);
});

test('guardChatReply blocks hallucinated missing address and fabricated FIPE values', () => {
  const plan = planChatTurn({
    allVehicles: SAMPLE_VEHICLES,
    messages: [{ sender: 'cliente', text: 'Me fala do Hyundai Veloster' }],
    latestUserUtterance: 'Me fala do Hyundai Veloster',
    dealership: SAMPLE_SETTINGS,
  });

  const badAddrReply = guardChatReply(
    'Infelizmente não há endereço cadastrado para nossa loja.',
    plan,
    SAMPLE_SETTINGS
  );
  assert.equal(badAddrReply, plan.deterministicReply);

  const badFipeReply = guardChatReply(
    'O Veloster está R$ 4.000 abaixo da Tabela FIPE de R$ 53.900!',
    plan,
    SAMPLE_SETTINGS
  );
  assert.equal(badFipeReply, plan.deterministicReply);
});

test('SEO payload sets route-specific titles, noindex on private routes, and AutoDealer/Car JSON-LD on public routes', () => {
  const origin = 'https://agente-de-ia-carros.vercel.app';

  const catalogSeo = buildRouteSeoPayload({
    viewMode: 'catalog',
    settings: SAMPLE_SETTINGS,
    origin,
    vehicles: SAMPLE_VEHICLES,
  });
  assert.equal(catalogSeo.robots, 'index, follow');
  assert.match(catalogSeo.title, /Estoque de Veículos Seminovos/i);
  assert.equal(catalogSeo.canonicalUrl, `${origin}/`);
  assert.ok(catalogSeo.jsonLd.some((n) => n['@type'] === 'AutoDealer'));
  assert.ok(catalogSeo.jsonLd.some((n) => n['@type'] === 'ItemList'));

  const vehicleSeo = buildRouteSeoPayload({
    viewMode: 'vehicle_detail',
    settings: SAMPLE_SETTINGS,
    origin,
    vehicle: SAMPLE_VEHICLES[0],
  });
  assert.equal(vehicleSeo.robots, 'index, follow');
  assert.match(vehicleSeo.title, /Hyundai Veloster 2013\/2013/i);
  assert.equal(vehicleSeo.canonicalUrl, `${origin}/veiculo/9`);
  const carNode = vehicleSeo.jsonLd.find((n) => Array.isArray(n['@type']) && n['@type'].includes('Car'));
  assert.ok(carNode);
  assert.equal((carNode.offers as Record<string, unknown>).price, 49900);

  const loginSeo = buildRouteSeoPayload({
    viewMode: 'login',
    settings: SAMPLE_SETTINGS,
    origin,
  });
  assert.equal(loginSeo.robots, 'noindex, nofollow');
  assert.match(loginSeo.title, /Entrar na Central da Revenda/i);
  assert.equal(loginSeo.jsonLd.length, 0);

  const adminSeo = buildRouteSeoPayload({
    viewMode: 'admin',
    activeModule: 'hoje',
    settings: SAMPLE_SETTINGS,
    origin,
  });
  assert.equal(adminSeo.robots, 'noindex, nofollow');
  assert.match(adminSeo.title, /Central da Revenda — Hoje/i);

  const injected = injectSeoIntoHtml(
    '<html><head><title>Old</title><meta name="description" content="old" /></head><body></body></html>',
    vehicleSeo
  );
  assert.match(injected, /<title>Hyundai Veloster 2013\/2013 à Venda \| Armazém do Carro<\/title>/);
  assert.match(injected, /application\/ld\+json/);
  assert.match(injected, /<link rel="canonical" href="https:\/\/agente-de-ia-carros\.vercel\.app\/veiculo\/9" \/>/);
});

test('resolveAdminBootstrapEnv standardizes ADMIN_BOOTSTRAP_PASSWORD and supports legacy ADMIN_BOOTSTRAP_PASSWC fallback', () => {
  const canonical = resolveAdminBootstrapEnv({
    ADMIN_BOOTSTRAP_EMAIL: 'Admin@Loja.com',
    ADMIN_BOOTSTRAP_PASSWORD: 'StrongPassword123',
    ADMIN_BOOTSTRAP_PASSWC: 'OldTypoPassword999',
    ADMIN_BOOTSTRAP_NAME: 'Gestor Principal',
  });
  assert.equal(canonical.email, 'admin@loja.com');
  assert.equal(canonical.password, 'StrongPassword123');
  assert.equal(canonical.usedLegacyPasswordAlias, false);

  const legacyFallback = resolveAdminBootstrapEnv({
    ADMIN_BOOTSTRAP_EMAIL: 'admin@loja.com',
    ADMIN_BOOTSTRAP_PASSWC: 'FallbackPassword123',
  });
  assert.equal(legacyFallback.password, 'FallbackPassword123');
  assert.equal(legacyFallback.usedLegacyPasswordAlias, true);
});
