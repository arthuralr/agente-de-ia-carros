import { pool } from './pool';

export interface DbVehicleRow {
  id: number;
  brand: string;
  model: string;
  version: string | null;
  year_fab: number;
  year_model: number;
  km: number;
  price: string;
  fipe_code?: string | null;
  fipe_price?: string | null;
  status: string | null;
  fuel: string | null;
  transmission: string | null;
  image_url: string | null;
  options: string[] | null;
  created_at: Date;
}

export interface DbLeadRow {
  id: number;
  name: string;
  phone: string;
  vehicle_interest: string | null;
  stage: string | null;
  chat_history: string | null;
  lgpd_consent?: boolean | null;
  lgpd_consent_at?: Date | null;
  chat_session_id?: string | null;
  tag?: string | null;
  notes?: string | null;
  created_at: Date;
}

export interface DbContractRow {
  id: number;
  client_name: string;
  client_cpf: string;
  vehicle_id: number | null;
  final_price: string;
  payment_method: string | null;
  created_at: Date;
}

export interface DbChatSessionRow {
  id: number;
  session_id: string;
  lead_name: string | null;
  lead_phone: string | null;
  origem: string;
  tag?: string | null;
  ai_summary?: string | null;
  ai_summary_updated_at?: Date | null;
  created_at: Date;
  updated_at: Date;
  message_count?: number;
  last_message?: string | null;
  last_sender?: 'user' | 'assistant' | null;
}

export interface DbChatMessageRow {
  id: number;
  session_id: string;
  sender: 'user' | 'assistant';
  content: string;
  reply_to_id?: string | null;
  reply_to_preview?: string | null;
  reply_to_sender?: 'user' | 'assistant' | null;
  audio_url?: string | null;
  transcription?: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  created_at: Date;
}

export async function seedNeonDatabaseIfEmpty(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "UPDATE vehicles SET status = 'Disponivel' WHERE status = 'Disponível'"
    );
    await client.query(`
      ALTER TABLE vehicles
      ADD COLUMN IF NOT EXISTS fipe_code VARCHAR(32),
      ADD COLUMN IF NOT EXISTS fipe_price NUMERIC
    `);
    await client.query(`
      ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS lgpd_consent BOOLEAN NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS lgpd_consent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS chat_session_id VARCHAR(128),
      ADD COLUMN IF NOT EXISTS tag VARCHAR(64),
      ADD COLUMN IF NOT EXISTS notes TEXT
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(128) UNIQUE NOT NULL,
        lead_name VARCHAR(255),
        lead_phone VARCHAR(64),
        origem VARCHAR(64) NOT NULL DEFAULT '/chat',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE chat_sessions
      ADD COLUMN IF NOT EXISTS tag VARCHAR(64),
      ADD COLUMN IF NOT EXISTS ai_summary TEXT,
      ADD COLUMN IF NOT EXISTS ai_summary_updated_at TIMESTAMPTZ
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(128) NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
        sender VARCHAR(32) NOT NULL CHECK (sender IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE chat_messages
      ADD COLUMN IF NOT EXISTS reply_to_id VARCHAR(128),
      ADD COLUMN IF NOT EXISTS reply_to_preview TEXT,
      ADD COLUMN IF NOT EXISTS reply_to_sender VARCHAR(32),
      ADD COLUMN IF NOT EXISTS audio_url TEXT,
      ADD COLUMN IF NOT EXISTS transcription TEXT,
      ADD COLUMN IF NOT EXISTS attachment_url TEXT,
      ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS attachment_mime VARCHAR(128)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id
      ON chat_messages(session_id, id)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(64) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const vehCount = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM vehicles'
    );
    let insertedVehicles: { id: number; label: string }[] = [];

    if ((vehCount.rows[0]?.count ?? 0) === 0) {
      const seedVehicles = [
        {
          brand: 'Porsche',
          model: 'Macan',
          version: 'GTS 2.9 V6 Bi-Turbo PDK',
          year_fab: 2023,
          year_model: 2023,
          km: 14200,
          price: 549900,
          status: 'Disponivel',
          fuel: 'Gasolina',
          transmission: 'Automático PDK 7M',
          image_url: '/src/assets/images/car_porsche_macan_1794944464647.jpg',
          options: [
            'Pacote Sport Chrono',
            'Teto Solar Panorâmico',
            'Som BOSE Surround',
            'Suspensão Pneumática PASM',
            'Escapamento Esportivo',
            'Rodas RS Spyder 21"',
          ],
        },
        {
          brand: 'BMW',
          model: '320i',
          version: '2.0 16V Turbo M Sport',
          year_fab: 2023,
          year_model: 2024,
          km: 19800,
          price: 314900,
          status: 'Disponivel',
          fuel: 'Flex',
          transmission: 'Automático Steptronic 8M',
          image_url: '/src/assets/images/car_bmw_320i_1794944463154.jpg',
          options: [
            'BMW Live Cockpit Curved',
            'Harman Kardon',
            'Teto Solar Elétrico',
            'Assistente de Estacionamento',
            'Pacote Aerodinâmico M',
            'Bancos em Couro Vernasca',
          ],
        },
        {
          brand: 'Volkswagen',
          model: 'Golf GTI',
          version: '2.0 TSI 245cv MK8',
          year_fab: 2023,
          year_model: 2024,
          km: 12900,
          price: 279900,
          status: 'Disponivel',
          fuel: 'Gasolina',
          transmission: 'Automático DSG 7M',
          image_url: '/src/assets/images/car_golf_gti_1794945350021.jpg',
          options: [
            'Bancos Xadrez Clark / Alcantara',
            'Painel Digital Active Info 10.25"',
            'Faróis IQ.Light Matrix LED',
            'Controle Adaptativo ACC',
            'Rodas Adelaide 19"',
          ],
        },
        {
          brand: 'Porsche',
          model: '911 Carrera T',
          version: '3.0 Bi-Turbo Coupé',
          year_fab: 2023,
          year_model: 2024,
          km: 5400,
          price: 929000,
          status: 'Disponivel',
          fuel: 'Gasolina',
          transmission: 'Manual 7M',
          image_url: '/src/assets/images/car_porsche_911_1794945352108.jpg',
          options: [
            'Câmbio Manual Esportivo 7 Marchas',
            'Pacote Sport Chrono',
            'Eixo Traseiro Esterçante',
            'Escapamento Esportivo em Preto',
            'PPF Frontal Completo',
          ],
        },
        {
          brand: 'Jeep',
          model: 'Compass',
          version: 'Limited T270 1.3 Turbo',
          year_fab: 2024,
          year_model: 2024,
          km: 11500,
          price: 168900,
          status: 'Reservado',
          fuel: 'Flex',
          transmission: 'Automático 6M',
          image_url: '/src/assets/images/car_compass_limited_1794944463768.jpg',
          options: [
            'Pack High Tech ADAS',
            'Teto Solar Command View',
            'Som Beats 506W',
            'Carregador por Indução',
          ],
        },
        {
          brand: 'Honda',
          model: 'Civic',
          version: 'Touring 2.0 e:HEV Híbrido',
          year_fab: 2023,
          year_model: 2024,
          km: 22400,
          price: 224900,
          status: 'Disponivel',
          fuel: 'Híbrido',
          transmission: 'Automático e-CVT',
          image_url: '/src/assets/images/car_civic_touring_1794944463935.jpg',
          options: [
            'Honda Sensing Completo',
            'Som BOSE 12 Alto-Falantes',
            'Painel Digital TFT 10.2"',
            'Teto Solar',
          ],
        },
        {
          brand: 'Toyota',
          model: 'Corolla Cross',
          version: 'XRX Hybrid 1.8 VVT-i',
          year_fab: 2024,
          year_model: 2024,
          km: 8900,
          price: 192500,
          status: 'Vendido',
          fuel: 'Híbrido Flex',
          transmission: 'Automático CVT',
          image_url: '/src/assets/images/car_corolla_cross_1794944465179.jpg',
          options: [
            'Toyota Safety Sense',
            'Câmera 360º',
            'Teto Solar Elétrico',
            'Bancos em Couro Bege',
          ],
        },
      ];

      for (const v of seedVehicles) {
        const res = await client.query<{ id: number }>(
          `INSERT INTO vehicles (brand, model, version, year_fab, year_model, km, price, status, fuel, transmission, image_url, options)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            v.brand,
            v.model,
            v.version,
            v.year_fab,
            v.year_model,
            v.km,
            v.price,
            v.status,
            v.fuel,
            v.transmission,
            v.image_url,
            v.options,
          ]
        );
        insertedVehicles.push({
          id: res.rows[0].id,
          label: `${v.brand} ${v.model}`,
        });
      }
    }

    const leadCount = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM leads'
    );
    if ((leadCount.rows[0]?.count ?? 0) === 0) {
      const seedLeads = [
        {
          name: 'Marcelo Henrique Costa',
          phone: '(11) 98234-5510',
          vehicle_interest: 'BMW 320i M Sport 2023/2024',
          stage: 'Proposta',
          chat_history: JSON.stringify([
            {
              id: 'm-1',
              sender: 'cliente',
              text: 'Olá! A BMW 320i M Sport branca ainda está disponível no estoque?',
              timestamp: '09:18',
            },
            {
              id: 'm-2',
              sender: 'ia',
              text: 'Olá, Marcelo! Sim, a nossa BMW 320i M Sport 2023/2024 com 19.800 km está disponível em nosso showroom em Moema por R$ 314.900, com laudo cautelar 100% aprovado.',
              timestamp: '09:18',
            },
          ]),
        },
        {
          name: 'Camila Ferreira Duarte',
          phone: '(11) 97120-8834',
          vehicle_interest: 'Porsche Macan GTS 2023',
          stage: 'Em Atendimento',
          chat_history: JSON.stringify([
            {
              id: 'm-21',
              sender: 'cliente',
              text: 'Boa tarde, essa Macan GTS vermelha tem pacote Sport Chrono e todas as revisões na Porsche?',
              timestamp: '10:05',
            },
            {
              id: 'm-22',
              sender: 'ia',
              text: 'Olá, Camila! Sim, esta unidade conta com pacote Sport Chrono, som BOSE, suspensão PASM e todas as revisões carimbadas na concessionária autorizada.',
              timestamp: '10:06',
            },
          ]),
        },
        {
          name: 'Rafael Mendes Oliveira',
          phone: '(11) 99611-3209',
          vehicle_interest: 'Honda Civic Touring Híbrido 2024',
          stage: 'Novo Lead',
          chat_history: JSON.stringify([
            {
              id: 'm-31',
              sender: 'cliente',
              text: 'Qual a média de consumo do Civic Híbrido e quanto fica a parcela dando 90 mil de entrada?',
              timestamp: '11:12',
            },
            {
              id: 'm-32',
              sender: 'ia',
              text: 'Olá, Rafael! O Civic e:HEV faz até 18,3 km/l na cidade. Com R$ 90.000 de entrada conseguimos taxas a partir de 1,39% a.m. em 36x.',
              timestamp: '11:12',
            },
          ]),
        },
        {
          name: 'Patrícia Vasconcelos Lima',
          phone: '(11) 99188-4022',
          vehicle_interest: 'Toyota Corolla Cross XRX Hybrid 2024',
          stage: 'Fechado',
          chat_history: JSON.stringify([
            {
              id: 'm-51',
              sender: 'cliente',
              text: 'Oi, vi o Corolla Cross XRX prata no site. Posso passar na loja às 15h?',
              timestamp: '13:10',
            },
            {
              id: 'm-52',
              sender: 'ia',
              text: 'Claro, Patrícia! O veículo já está higienizado no showroom aguardando você às 15h.',
              timestamp: '13:11',
            },
          ]),
        },
      ];

      for (const l of seedLeads) {
        await client.query(
          `INSERT INTO leads (name, phone, vehicle_interest, stage, chat_history)
           VALUES ($1, $2, $3, $4, $5)`,
          [l.name, l.phone, l.vehicle_interest, l.stage, l.chat_history]
        );
      }
    }

    const contractCount = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM contracts'
    );
    if ((contractCount.rows[0]?.count ?? 0) === 0) {
      const corollaRes = await client.query<{ id: number }>(
        "SELECT id FROM vehicles WHERE model = 'Corolla Cross' LIMIT 1"
      );
      const vehicleId = corollaRes.rows[0]?.id ?? insertedVehicles[0]?.id ?? null;

      await client.query(
        `INSERT INTO contracts (client_name, client_cpf, vehicle_id, final_price, payment_method)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          'Patrícia Vasconcelos Lima',
          '367.209.518-77',
          vehicleId,
          190000,
          'Transferência TED/PIX à vista na assinatura',
        ]
      );
    }
  } finally {
    client.release();
  }
}
