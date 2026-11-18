import {
  ChatMessage,
  ContractRecord,
  Lead,
  LeadStage,
  Vehicle,
  VehicleStatus,
} from '../types';
import {
  INITIAL_LEADS,
  INITIAL_VEHICLES,
  inferVehicleCategory,
} from '../data/mockData';

export interface ApiVehicleRow {
  id: number;
  brand: string;
  model: string;
  version: string | null;
  year_fab: number;
  year_model: number;
  km: number;
  price: string | number;
  status: string | null;
  fuel: string | null;
  transmission: string | null;
  image_url: string | null;
  options: string[] | null;
  created_at: string;
}

export interface ApiLeadRow {
  id: number;
  name: string;
  phone: string;
  vehicle_interest: string | null;
  stage: string | null;
  chat_history: string | null;
  lgpd_consent?: boolean | null;
  lgpd_consent_at?: string | null;
  created_at: string;
}

export interface ApiContractRow {
  id: number;
  client_name: string;
  client_cpf: string;
  vehicle_id: number | null;
  final_price: string | number;
  payment_method: string | null;
  created_at: string;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_year_fab?: number | null;
  vehicle_year_model?: number | null;
}

export function mapDbContractToFrontend(row: ApiContractRow): ContractRecord {
  const vehicleLabel =
    row.vehicle_brand && row.vehicle_model
      ? `${row.vehicle_brand} ${row.vehicle_model}${
          row.vehicle_year_fab && row.vehicle_year_model
            ? ` ${row.vehicle_year_fab}/${row.vehicle_year_model}`
            : ''
        }`
      : row.vehicle_id
        ? `Veículo #${row.vehicle_id}`
        : 'Veículo removido do catálogo';

  return {
    id: String(row.id),
    clientName: row.client_name,
    clientCpf: row.client_cpf,
    vehicleId: row.vehicle_id ? String(row.vehicle_id) : '',
    vehicleLabel,
    finalPrice: Number(row.final_price) || 0,
    paymentMethod: row.payment_method || 'À vista',
    createdAt: row.created_at
      ? new Date(row.created_at).toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Hoje',
  };
}

export function mapDbVehicleToFrontend(row: ApiVehicleRow): Vehicle {
  const seedMatch = INITIAL_VEHICLES.find(
    (s) =>
      s.brand.toLowerCase() === row.brand.toLowerCase() &&
      s.model.toLowerCase() === row.model.toLowerCase()
  );

  const priceNum = Number(row.price) || 0;
  const rawStatus = (row.status || '').trim();
  const statusVal: VehicleStatus =
    rawStatus === 'Reservado' || rawStatus === 'Vendido'
      ? rawStatus
      : 'Disponível';

  const mapped: Vehicle = {
    id: String(row.id),
    brand: row.brand,
    model: row.model,
    version: row.version || '',
    category: seedMatch?.category,
    year: `${row.year_fab}/${row.year_model}`,
    km: Number(row.km) || 0,
    price: priceNum,
    fipePrice: seedMatch?.fipePrice || Math.round(priceNum * 1.04),
    color: seedMatch?.color || 'Showroom',
    transmission: row.transmission || 'Automático',
    fuel: row.fuel || 'Flex',
    plate: seedMatch?.plate || 'ADC0N00',
    renavam: seedMatch?.renavam || '',
    chassis: seedMatch?.chassis || '',
    status: statusVal,
    imageUrl: row.image_url || seedMatch?.imageUrl || '',
    gallery: seedMatch?.gallery,
    optionals: Array.isArray(row.options) ? row.options : [],
    createdAt: row.created_at
      ? String(row.created_at).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  };

  mapped.category = mapped.category || inferVehicleCategory(mapped);
  return mapped;
}

export function parseYearPair(yearStr: string): {
  year_fab: number;
  year_model: number;
} {
  const parts = yearStr.split('/').map((p) => parseInt(p.trim(), 10));
  const fab = Number.isFinite(parts[0]) ? parts[0] : 2024;
  const model = Number.isFinite(parts[1]) ? parts[1] : fab;
  return { year_fab: fab, year_model: model };
}

export function mapDbLeadToFrontend(row: ApiLeadRow): Lead {
  const seedMatch = INITIAL_LEADS.find(
    (s) => s.name.toLowerCase() === row.name.toLowerCase()
  );

  let chatHistory: ChatMessage[] = [];
  if (row.chat_history) {
    try {
      const parsed = JSON.parse(row.chat_history);
      if (Array.isArray(parsed)) {
        chatHistory = parsed as ChatMessage[];
      }
    } catch {
      chatHistory = [
        {
          id: `msg-${row.id}`,
          sender: 'cliente',
          text: row.chat_history,
          timestamp: 'Hoje',
        },
      ];
    }
  }

  const validStages: LeadStage[] = [
    'Novo Lead',
    'Em Atendimento',
    'Proposta',
    'Fechado',
  ];
  const stage: LeadStage = validStages.includes(row.stage as LeadStage)
    ? (row.stage as LeadStage)
    : 'Novo Lead';

  const formattedCreatedAt = row.created_at
    ? new Date(row.created_at).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Hoje';

  return {
    id: String(row.id),
    name: row.name,
    whatsapp: row.phone,
    email: seedMatch?.email || '',
    cpf: seedMatch?.cpf || '',
    rg: seedMatch?.rg || '',
    address: seedMatch?.address || '',
    city: seedMatch?.city || 'São Paulo - SP',
    vehicleInterestId: seedMatch?.vehicleInterestId || '',
    vehicleInterestLabel: row.vehicle_interest || 'Consultoria Geral',
    stage,
    source: seedMatch?.source || 'Chat IA do Site',
    createdAt: formattedCreatedAt,
    lastActivity: seedMatch?.lastActivity || formattedCreatedAt,
    visitScheduled: seedMatch?.visitScheduled,
    proposalValue: seedMatch?.proposalValue,
    notes: seedMatch?.notes || '',
    lgpdConsent: row.lgpd_consent ?? true,
    lgpdConsentAt: row.lgpd_consent_at
      ? new Date(row.lgpd_consent_at).toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : undefined,
    chatHistory,
  };
}
