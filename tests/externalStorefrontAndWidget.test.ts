import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DEALERSHIP_CONFIG,
  resolvePublicStorefrontLinks,
  resolveVehicleSheetLink,
} from '../src/utils/vehicleDomain';
import { buildWhatsAppHandoffUrl } from '../src/utils/whatsappHandoff';
import { planChatTurn } from '../src/utils/chatOrchestrator';
import {
  parseExternalJsonFeed,
  parseStructuredSiteHtml,
  validateExternalUrl,
} from '../src/server/externalInventoryService';
import { buildExternalWidgetScript } from '../src/server/widgetScript';
import { signSessionToken, verifySessionToken } from '../src/db/auth';
import { DealershipSettings, Vehicle } from '../src/types';

const EXTERNAL_SETTINGS: DealershipSettings = {
  ...DEFAULT_DEALERSHIP_CONFIG,
  tradeName: 'Revenda Oficial Teste',
  storefrontMode: 'external',
  publicStoreSlug: 'revenda-oficial-teste',
  externalCatalogUrl: 'https://www.revendaoficial.com.br/estoque',
  externalHomeUrl: 'https://www.revendaoficial.com.br',
  salesWhatsapp: '5511999990000',
  whatsapp: '5511999990000',
};

const SAMPLE_EXTERNAL_VEHICLES: Vehicle[] = [
  {
    id: 'ext-101',
    brand: 'Toyota',
    model: 'Corolla',
    version: 'XEi 2.0 Flex Automático',
    year: '2022/2023',
    km: 34000,
    price: 132900,
    fipePrice: 138000,
    fipeReferenceMonth: 'Novembro/2025',
    plate: 'SYNC',
    renavam: '',
    chassis: '',
    createdAt: '2026-11-25T10:00:00.000Z',
    color: 'Prata',
    fuel: 'Flex',
    transmission: 'Automático',
    status: 'Disponível',
    imageUrl: 'https://www.revendaoficial.com.br/fotos/corolla.jpg',
    optionals: ['Multimídia', 'Câmera de ré'],
    dataSource: 'external',
    externalId: '101',
    officialUrl: 'https://www.revendaoficial.com.br/veiculo/corolla-xei-101',
    priceConfirmed: true,
    availabilityConfirmed: true,
  },
  {
    id: 'ext-102',
    brand: 'Honda',
    model: 'HR-V',
    version: 'EXL Sensing',
    year: '2023/2024',
    km: 19500,
    price: 0,
    fipePrice: 0,
    plate: 'SYNC',
    renavam: '',
    chassis: '',
    createdAt: '2026-11-25T10:00:00.000Z',
    color: 'Branco',
    fuel: 'Flex',
    transmission: 'Automático',
    status: 'Disponível',
    imageUrl: '',
    optionals: [],
    dataSource: 'external',
    externalId: '102',
    officialUrl: null,
    priceConfirmed: false,
    availabilityConfirmed: false,
  },
];

test('validateExternalUrl blocks internal/private/metadata addresses and unsafe schemes', async () => {
  const blocked = [
    'http://localhost:3000/feed.json',
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/internal',
    'http://192.168.1.10/estoque.json',
    'http://[::1]/estoque',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pass@revenda.com.br/feed.json',
  ];

  for (const url of blocked) {
    const res = await validateExternalUrl(url, { skipDnsLookup: true });
    assert.equal(res.ok, false, `Expected URL to be blocked: ${url}`);
  }

  const allowed = await validateExternalUrl(
    'https://www.revendaoficial.com.br/api/estoque.json',
    { skipDnsLookup: true }
  );
  assert.equal(allowed.ok, true);
  assert.equal(
    allowed.normalizedUrl,
    'https://www.revendaoficial.com.br/api/estoque.json'
  );
});

test('parseExternalJsonFeed normalizes vehicles, strips HTML, and rejects unsafe official URLs', () => {
  const payload = JSON.stringify({
    vehicles: [
      {
        id: 'SKU-55',
        marca: '<b>Volkswagen</b>',
        modelo: 'T-Cross',
        versao: 'Highline 250 TSI <script>evil()</script>',
        ano: '2022/2023',
        km: '28.400',
        preco: 'R$ 129.900,00',
        cambio: 'Automático',
        combustivel: 'Flex',
        status: 'Disponível',
        url: 'https://www.revendaoficial.com.br/veiculo/t-cross-55',
        imagem: 'https://www.revendaoficial.com.br/img/tcross.jpg',
      },
      {
        id: 'SKU-56',
        marca: 'Jeep',
        modelo: 'Compass',
        ano: 2021,
        preco: 0,
        url: 'javascript:alert(1)',
      },
    ],
  });

  const parsed = parseExternalJsonFeed(
    payload,
    'https://www.revendaoficial.com.br/api/estoque.json'
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.vehicles.length, 2);

  const first = parsed.vehicles[0];
  assert.equal(first.externalId, 'SKU-55');
  assert.equal(first.brand, 'Volkswagen');
  assert.equal(first.model, 'T-Cross');
  assert.ok(!first.version.includes('<script>'));
  assert.equal(first.km, 28400);
  assert.equal(first.price, 129900);
  assert.equal(first.priceConfirmed, true);
  assert.equal(
    first.officialUrl,
    'https://www.revendaoficial.com.br/veiculo/t-cross-55'
  );

  const second = parsed.vehicles[1];
  assert.equal(second.priceConfirmed, false);
  assert.equal(second.officialUrl, null);
});

test('parseStructuredSiteHtml extracts JSON-LD vehicles and returns connector_required for plain HTML', () => {
  const structuredHtml = `
    <html><head>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Car",
          "sku": "LD-900",
          "brand": { "@type": "Brand", "name": "Hyundai" },
          "model": "Creta",
          "name": "Hyundai Creta Platinum 1.0 TGDI",
          "modelDate": "2023",
          "mileageFromOdometer": { "@type": "QuantitativeValue", "value": 18200 },
          "vehicleTransmission": "Automático",
          "fuelType": "Flex",
          "url": "/veiculo/creta-platinum-900",
          "offers": {
            "@type": "Offer",
            "price": "139900",
            "availability": "https://schema.org/InStock"
          }
        }
      </script>
    </head><body></body></html>
  `;

  const okRes = parseStructuredSiteHtml(
    structuredHtml,
    'https://www.revendaoficial.com.br/estoque'
  );
  assert.equal(okRes.ok, true);
  assert.equal(okRes.vehicles.length, 1);
  assert.equal(okRes.vehicles[0].brand, 'Hyundai');
  assert.equal(okRes.vehicles[0].model, 'Creta');
  assert.equal(okRes.vehicles[0].price, 139900);
  assert.equal(
    okRes.vehicles[0].officialUrl,
    'https://www.revendaoficial.com.br/veiculo/creta-platinum-900'
  );

  const plainHtml = '<html><body><h1>Carros seminovos</h1><div class="card">Carro A</div></body></html>';
  const reqConnector = parseStructuredSiteHtml(
    plainHtml,
    'https://www.revendaoficial.com.br/estoque'
  );
  assert.equal(reqConnector.ok, false);
  assert.equal(reqConnector.status, 'connector_required');
});

test('storefront links & WhatsApp handoff respect internal vs external mode', () => {
  const internalLinks = resolvePublicStorefrontLinks(DEFAULT_DEALERSHIP_CONFIG);
  assert.equal(internalLinks.isExternal, false);
  assert.equal(internalLinks.catalogUrl, '/');

  const externalLinks = resolvePublicStorefrontLinks(EXTERNAL_SETTINGS);
  assert.equal(externalLinks.isExternal, true);
  assert.equal(
    externalLinks.catalogUrl,
    'https://www.revendaoficial.com.br/estoque'
  );

  // Per-vehicle official URL when present
  const sheet1 = resolveVehicleSheetLink(
    SAMPLE_EXTERNAL_VEHICLES[0],
    'https://agente.example.com',
    EXTERNAL_SETTINGS
  );
  assert.equal(sheet1.isExternal, true);
  assert.equal(
    sheet1.fullUrl,
    'https://www.revendaoficial.com.br/veiculo/corolla-xei-101'
  );

  // Fallback to external catalog URL when per-vehicle URL is missing
  const sheet2 = resolveVehicleSheetLink(
    SAMPLE_EXTERNAL_VEHICLES[1],
    'https://agente.example.com',
    EXTERNAL_SETTINGS
  );
  assert.equal(sheet2.isExternal, true);
  assert.equal(sheet2.fullUrl, 'https://www.revendaoficial.com.br/estoque');

  // WhatsApp handoff carries officialUrl in external mode
  const handoff = buildWhatsAppHandoffUrl({
    storeWhatsappNumber: EXTERNAL_SETTINGS.salesWhatsapp || '5511999990000',
    storeName: EXTERNAL_SETTINGS.tradeName,
    dealership: EXTERNAL_SETTINGS,
    focusedVehicle: SAMPLE_EXTERNAL_VEHICLES[0],
    baseUrl: 'https://agente.example.com',
  });
  assert.ok(
    handoff.text.includes(
      'https://www.revendaoficial.com.br/veiculo/corolla-xei-101'
    ),
    `Expected official vehicle URL in WhatsApp handoff: ${handoff.text}`
  );
});

test('chat orchestrator in external mode handles synced, stale, unconfirmed price, and unavailable stock truthfully', () => {
  // 1. Synced healthy external stock
  const syncedTurn = planChatTurn({
    allVehicles: SAMPLE_EXTERNAL_VEHICLES,
    messages: [{ sender: 'cliente', text: 'Tem Corolla automático disponível?' }],
    latestUserUtterance: 'Tem Corolla automático disponível?',
    dealership: EXTERNAL_SETTINGS,
    externalSourceState: {
      health: 'ok',
      lastSuccessAt: new Date().toISOString(),
    },
  });
  assert.ok(syncedTurn.vehicleCards && syncedTurn.vehicleCards.length === 1);
  assert.equal(syncedTurn.vehicleCards[0].id, 'ext-101');
  assert.equal(syncedTurn.vehicleCards[0].isExternalUrl, true);
  assert.equal(
    syncedTurn.vehicleCards[0].sheetUrl,
    'https://www.revendaoficial.com.br/veiculo/corolla-xei-101'
  );

  // 2. Unconfirmed price discloses confirmation requirement
  const unconfirmedTurn = planChatTurn({
    allVehicles: SAMPLE_EXTERNAL_VEHICLES,
    messages: [{ sender: 'cliente', text: 'Quanto custa o HR-V?' }],
    latestUserUtterance: 'Quanto custa o HR-V?',
    dealership: EXTERNAL_SETTINGS,
    externalSourceState: {
      health: 'ok',
      lastSuccessAt: new Date().toISOString(),
    },
  });
  assert.ok(
    /confirmar|confirmação/i.test(unconfirmedTurn.deterministicReply || ''),
    `Expected price confirmation disclosure: ${unconfirmedTurn.deterministicReply}`
  );

  // 3. Stale sync still answers with cached stock AND adds staleness notice
  const staleTurn = planChatTurn({
    allVehicles: SAMPLE_EXTERNAL_VEHICLES,
    messages: [{ sender: 'cliente', text: 'Quais carros disponíveis vocês têm?' }],
    latestUserUtterance: 'Quais carros disponíveis vocês têm?',
    dealership: EXTERNAL_SETTINGS,
    externalSourceState: {
      health: 'stale',
      lastSuccessAt: '2026-11-25T10:00:00.000Z',
    },
  });
  assert.ok(staleTurn.vehicleCards && staleTurn.vehicleCards.length >= 1);
  assert.ok(
    /atualização|última sincronização|confirme preço/i.test(
      staleTurn.deterministicReply || ''
    ),
    `Expected stale catalog disclosure: ${staleTurn.deterministicReply}`
  );

  // 4. Unavailable external source with 0 vehicles NEVER invents vehicles and links official storefront
  const unavailableTurn = planChatTurn({
    allVehicles: [],
    messages: [{ sender: 'cliente', text: 'Quais SUVs automáticos vocês têm?' }],
    latestUserUtterance: 'Quais SUVs automáticos vocês têm?',
    dealership: EXTERNAL_SETTINGS,
    externalSourceState: {
      health: 'connector_required',
      lastSuccessAt: null,
    },
  });
  assert.equal(unavailableTurn.vehicleCards?.length ?? 0, 0);
  assert.ok(
    (unavailableTurn.deterministicReply || '').includes(
      'https://www.revendaoficial.com.br/estoque'
    ),
    `Expected official storefront link when unavailable: ${unavailableTurn.deterministicReply}`
  );
});

test('JWT includes tokenVersion claim and no hardcoded demo credentials exist in auth/login files', () => {
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-secret-for-unit-validation-only-32chars';
  }
  const token = signSessionToken({
    id: 42,
    email: 'admin@revenda.com.br',
    name: 'Admin Teste',
    role: 'admin',
    roleCode: 'administrador',
    avatarUrl: null,
    tokenVersion: 7,
  });
  const decoded = verifySessionToken(token);
  assert.ok(decoded);
  assert.equal(decoded.tv, 7);

  const authSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/db/auth.ts'),
    'utf8'
  );
  const loginSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/auth/AdminLoginPage.tsx'),
    'utf8'
  );
  for (const forbidden of ['admin@armazemdocarro.com', 'Armazem@2026', 'Preencher demo']) {
    assert.ok(
      !authSource.includes(forbidden),
      `Found forbidden demo credential token in auth.ts: ${forbidden}`
    );
    assert.ok(
      !loginSource.includes(forbidden),
      `Found forbidden demo credential token in AdminLoginPage.tsx: ${forbidden}`
    );
  }
});

test('external widget script prevents duplicate mounting, supports ESC/mobile, and contains no private secrets', () => {
  const js = buildExternalWidgetScript('https://agente.example.com');
  assert.ok(js.includes('__armazemAgentWidgetLoaded'));
  assert.ok(js.includes('Escape'));
  assert.ok(js.includes('/api/public/widget-config'));
  assert.ok(js.includes('embed=1'));
  assert.ok(!js.includes('JWT_SECRET'));
  assert.ok(!js.includes('authHeaderValue'));
});
