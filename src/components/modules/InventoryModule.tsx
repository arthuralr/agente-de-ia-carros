import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BadgePercent,
  Check,
  Edit3,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  FipeLookupResult,
  Vehicle,
  VehicleCategory,
  VehicleStatus,
} from '../../types';
import { SHOWROOM_IMAGE_PRESETS } from '../../data/mockData';
import { parseYearPair } from '../../db/mappers';
import { formatBRL, formatKm } from '../../utils/formatters';
import {
  analyzeVehicleDataQuality,
  computeFipeMetrics,
} from '../../utils/vehicleDomain';
import { VehicleImage } from '../VehicleImage';

interface InventoryModuleProps {
  vehicles: Vehicle[];
  onAddVehicle: (vehicle: Vehicle) => Promise<void>;
  onUpdateVehicle: (vehicle: Vehicle) => Promise<void>;
  onDeleteVehicle: (id: string) => Promise<void>;
  onGeneratePostForVehicle: (vehicleId: string) => void;
  externalModalOpen: boolean;
  onCloseExternalModal: () => void;
}

const COMMON_OPTIONALS = [
  'Teto Solar Panorâmico',
  'Bancos em Couro',
  'Som Premium (BOSE / Harman)',
  'Câmera 360º',
  'Piloto Automático Adaptativo',
  'Chave Presencial',
  'Painel Digital TFT',
  'Sensor de Ponto Cego',
  'Carregador por Indução',
  'Rodas de Liga Leve',
  'Apple CarPlay / Android Auto',
  'Faróis Full LED',
];

const STATUS_OPTIONS: VehicleStatus[] = ['Disponível', 'Reservado', 'Vendido'];

function getStatusTextClass(status: VehicleStatus): string {
  switch (status) {
    case 'Disponível':
      return 'text-emerald-400';
    case 'Reservado':
      return 'text-amber-400';
    case 'Vendido':
      return 'text-zinc-400';
  }
}

export const InventoryModule: React.FC<InventoryModuleProps> = ({
  vehicles,
  onAddVehicle,
  onUpdateVehicle,
  onDeleteVehicle,
  onGeneratePostForVehicle,
  externalModalOpen,
  onCloseExternalModal,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Todos' | VehicleStatus>('Todos');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [customOptional, setCustomOptional] = useState('');
  const [yearFabInput, setYearFabInput] = useState(2024);
  const [yearModelInput, setYearModelInput] = useState(2024);
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const [isQueryingFipe, setIsQueryingFipe] = useState(false);
  const [fipeError, setFipeError] = useState<string | null>(null);
  const [fipeResult, setFipeResult] = useState<FipeLookupResult | null>(null);
  const [selectedFipeIndex, setSelectedFipeIndex] = useState(0);

  const [formState, setFormState] = useState<Omit<Vehicle, 'id' | 'createdAt'>>({
    brand: '',
    model: '',
    version: '',
    category: 'SUVs',
    year: '2024/2024',
    km: 0,
    price: 0,
    fipePrice: 0,
    fipeCode: '',
    fipeReferenceMonth: '',
    color: '',
    transmission: '',
    fuel: 'Flex',
    plate: '',
    renavam: '',
    chassis: '',
    status: 'Disponível',
    imageUrl: SHOWROOM_IMAGE_PRESETS[0].url,
    optionals: [],
  });

  useEffect(() => {
    if (externalModalOpen) {
      openCreateModal();
      onCloseExternalModal();
    }
  }, [externalModalOpen, onCloseExternalModal]);

  const openCreateModal = () => {
    setEditingVehicle(null);
    setSubmitError(null);
    setFipeError(null);
    setFipeResult(null);
    setSelectedFipeIndex(0);
    setYearFabInput(2024);
    setYearModelInput(2024);
    setFormState({
      brand: '',
      model: '',
      version: '',
      category: 'SUVs',
      year: '2024/2024',
      km: 0,
      price: 0,
      fipePrice: 0,
      fipeCode: '',
      fipeReferenceMonth: '',
      color: 'Preto',
      transmission: '',
      fuel: 'Flex',
      plate: '',
      renavam: '',
      chassis: '',
      status: 'Disponível',
      imageUrl: SHOWROOM_IMAGE_PRESETS[0].url,
      optionals: [],
    });
    setIsModalOpen(true);
  };

  const openEditModal = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setSubmitError(null);
    setFipeError(null);
    setFipeResult(null);
    setSelectedFipeIndex(0);
    const parsedYears = parseYearPair(vehicle.year);
    setYearFabInput(parsedYears.year_fab);
    setYearModelInput(parsedYears.year_model);
    setFormState({
      brand: vehicle.brand,
      model: vehicle.model,
      version: vehicle.version,
      category: vehicle.category || 'SUVs',
      year: vehicle.year,
      km: vehicle.km,
      price: vehicle.price,
      fipePrice: vehicle.fipePrice,
      fipeCode: vehicle.fipeCode || '',
      fipeReferenceMonth: vehicle.fipeReferenceMonth || '',
      color: vehicle.color,
      transmission: vehicle.transmission,
      fuel: vehicle.fuel,
      plate: vehicle.plate,
      renavam: vehicle.renavam,
      chassis: vehicle.chassis,
      status: vehicle.status,
      imageUrl: vehicle.imageUrl,
      optionals: [...vehicle.optionals],
    });
    setIsModalOpen(true);
  };

  const handleConsultarFipe = async () => {
    const rawCode = (formState.fipeCode || '').trim();
    if (!rawCode) {
      setFipeError('Informe o código FIPE (ex: 001004-9 ou 009222-3) para consultar.');
      return;
    }

    setIsQueryingFipe(true);
    setFipeError(null);

    try {
      const res = await fetch(
        `/api/fipe/${encodeURIComponent(rawCode)}?ano=${encodeURIComponent(
          String(yearModelInput)
        )}`
      );
      const data = (await res.json().catch(() => ({}))) as FipeLookupResult & {
        error?: string;
      };

      if (!res.ok || !data.recommended) {
        throw new Error(
          data.error || 'Não foi possível consultar o código na Tabela FIPE.'
        );
      }

      const recIdx = data.items.findIndex(
        (item) =>
          item.anoModelo === data.recommended.anoModelo &&
          item.combustivel === data.recommended.combustivel
      );
      setFipeResult(data);
      setSelectedFipeIndex(recIdx >= 0 ? recIdx : 0);
      setFormState((prev) => ({
        ...prev,
        fipeCode: data.codigoFipe,
        fipePrice: data.recommended.valorNumerico || prev.fipePrice,
        fipeReferenceMonth:
          data.recommended.mesReferencia || prev.fipeReferenceMonth || '',
      }));
    } catch (err: unknown) {
      setFipeResult(null);
      setFipeError(
        err instanceof Error ? err.message : 'Erro ao consultar BrasilAPI FIPE.'
      );
    } finally {
      setIsQueryingFipe(false);
    }
  };

  const handleSelectFipeYear = (index: number) => {
    if (!fipeResult || !fipeResult.items[index]) return;
    const chosen = fipeResult.items[index];
    setSelectedFipeIndex(index);
    setFormState((prev) => ({
      ...prev,
      fipeCode: chosen.codigoFipe || fipeResult.codigoFipe,
      fipePrice: chosen.valorNumerico,
      fipeReferenceMonth:
        chosen.mesReferencia || prev.fipeReferenceMonth || '',
    }));
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setFormState((prev) => ({ ...prev, imageUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const toggleOptional = (opt: string) => {
    setFormState((prev) => ({
      ...prev,
      optionals: prev.optionals.includes(opt)
        ? prev.optionals.filter((o) => o !== opt)
        : [...prev.optionals, opt],
    }));
  };

  const handleAddCustomOptional = () => {
    const trimmed = customOptional.trim();
    if (!trimmed) return;
    if (!formState.optionals.includes(trimmed)) {
      setFormState((prev) => ({
        ...prev,
        optionals: [...prev.optionals, trimmed],
      }));
    }
    setCustomOptional('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.brand.trim() || !formState.model.trim()) return;

    setIsSaving(true);
    setSubmitError(null);

    const combinedYear = `${yearFabInput}/${yearModelInput}`;
    const payload = {
      ...formState,
      year: combinedYear,
    };

    try {
      if (editingVehicle) {
        await onUpdateVehicle({
          ...editingVehicle,
          ...payload,
        });
        setSuccessNotice(
          `${payload.brand} ${payload.model} atualizado com sucesso.`
        );
      } else {
        await onAddVehicle({
          ...payload,
          status: 'Disponível',
          id: `veh-${Date.now()}`,
          createdAt: new Date().toISOString().slice(0, 10),
        });
        setSuccessNotice(
          `${payload.brand} ${payload.model} cadastrado com status 'Disponivel' no banco de dados.`
        );
      }
      setIsModalOpen(false);
      setTimeout(() => setSuccessNotice(null), 4000);
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Erro ao salvar veículo no banco de dados.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuickStatusChange = (vehicle: Vehicle, nextStatus: VehicleStatus) => {
    void onUpdateVehicle({ ...vehicle, status: nextStatus });
  };

  const reviewCount = useMemo(
    () => vehicles.filter((v) => analyzeVehicleDataQuality(v).needsReview).length,
    [vehicles]
  );

  const formQuality = useMemo(
    () =>
      analyzeVehicleDataQuality({
        ...formState,
        id: editingVehicle?.id || 'draft',
        createdAt: editingVehicle?.createdAt || '',
        year: `${yearFabInput}/${yearModelInput}`,
      }),
    [formState, editingVehicle, yearFabInput, yearModelInput]
  );

  const filteredVehicles = vehicles.filter((v) => {
    const matchesStatus = statusFilter === 'Todos' || v.status === statusFilter;
    const matchesReview = !reviewOnly || analyzeVehicleDataQuality(v).needsReview;
    const term = search.trim().toLowerCase();
    const matchesSearch =
      !term ||
      `${v.brand} ${v.model} ${v.version} ${v.plate}`
        .toLowerCase()
        .includes(term);
    return matchesStatus && matchesReview && matchesSearch;
  });

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[240px] max-w-sm">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar marca, modelo ou placa..."
              className="w-full pl-10 pr-4 py-2 bg-[#111114] border border-white/[0.08] focus:border-red-600/60 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#111114] border border-white/[0.08] rounded-lg">
            {(['Todos', 'Disponível', 'Reservado', 'Vendido'] as const).map(
              (status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    statusFilter === status
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {status}
                </button>
              )
            )}
          </div>

          {reviewCount > 0 && (
            <button
              type="button"
              onClick={() => setReviewOnly((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                reviewOnly
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                  : 'bg-[#111114] border-amber-500/30 text-amber-300 hover:bg-amber-500/10'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Revisar cadastro ({reviewCount})</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Veículo</span>
        </button>
      </div>

      {successNotice && (
        <div className="px-4 py-3 rounded-lg bg-emerald-950/50 border border-emerald-500/30 flex items-center justify-between gap-3 text-xs text-emerald-300">
          <span className="inline-flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successNotice}</span>
          </span>
          <button
            type="button"
            onClick={() => setSuccessNotice(null)}
            className="text-emerald-400 hover:text-emerald-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Inventory Table */}
      <div className="bg-[#111114] border border-white/[0.08] rounded-xl overflow-hidden">
        {filteredVehicles.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <p className="text-sm font-medium text-zinc-200">
              Nenhum veículo encontrado com os filtros atuais.
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              Ajuste a busca ou cadastre um novo veículo no inventário.
            </p>
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Cadastrar Primeiro Veículo</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] text-xs font-medium text-zinc-400 bg-white/[0.01]">
                  <th className="py-3.5 px-5">Veículo</th>
                  <th className="py-3.5 px-4">Ano</th>
                  <th className="py-3.5 px-4 text-right">Quilometragem</th>
                  <th className="py-3.5 px-4 text-right">Preço de Venda</th>
                  <th className="py-3.5 px-4">Status (1-clique)</th>
                  <th className="py-3.5 px-5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-sm">
                {filteredVehicles.map((vehicle) => {
                  const quality = analyzeVehicleDataQuality(vehicle);
                  const fipe = computeFipeMetrics(vehicle);
                  return (
                  <tr
                    key={vehicle.id}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-3.5 min-w-[260px]">
                        <div className="w-20 h-14 rounded-lg overflow-hidden shrink-0 bg-zinc-900 border border-white/[0.06]">
                          <VehicleImage
                            src={vehicle.imageUrl}
                            alt={`${vehicle.brand} ${vehicle.model}`}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-white truncate">
                              {vehicle.brand} {vehicle.model}
                            </p>
                          </div>
                          <p className="text-xs text-zinc-400 truncate mt-0.5">
                            {vehicle.version}
                          </p>
                          <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                            {vehicle.color || 'Cor N/I'} ·{' '}
                            <span
                              className={
                                quality.canonicalTransmission
                                  ? 'text-zinc-400'
                                  : 'text-amber-400 font-medium'
                              }
                            >
                              {quality.displayTransmission}
                            </span>{' '}
                            · {vehicle.fuel} · Placa{' '}
                            <span className="font-mono text-zinc-400">
                              {vehicle.plate || 'N/I'}
                            </span>
                          </p>
                          {quality.needsReview && (
                            <p
                              title={quality.reviewFlags.join(' | ')}
                              className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-amber-300"
                            >
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span className="truncate max-w-[340px]">
                                Revisar cadastro: {quality.reviewFlags[0]}
                              </span>
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-xs text-zinc-300 tabular-nums whitespace-nowrap">
                      {vehicle.year}
                    </td>

                    <td className="py-3.5 px-4 text-right font-mono text-xs text-zinc-300 tabular-nums whitespace-nowrap">
                      {formatKm(vehicle.km)}
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <span className="font-mono text-sm font-semibold text-white tabular-nums block">
                        {formatBRL(vehicle.price)}
                      </span>
                      {fipe.hasFipeValue && fipe.fipePrice ? (
                        <div className="mt-0.5 flex flex-col items-end gap-0.5">
                          <span className="text-[11px] text-zinc-400 font-mono tabular-nums">
                            FIPE {formatBRL(fipe.fipePrice)}
                            {vehicle.fipeCode ? ` · ${vehicle.fipeCode}` : ''}
                          </span>
                          {fipe.hasReferenceMonth ? (
                            fipe.diffBrl !== null && fipe.diffBrl !== 0 ? (
                              <span
                                className={`text-[10px] font-mono tabular-nums font-medium ${
                                  fipe.diffBrl > 0
                                    ? 'text-emerald-400'
                                    : 'text-amber-400'
                                }`}
                              >
                                {fipe.diffBrl > 0
                                  ? `${fipe.diffPct}% abaixo (${fipe.fipeReferenceMonth})`
                                  : `${Math.abs(fipe.diffPct || 0)}% acima (${fipe.fipeReferenceMonth})`}
                              </span>
                            ) : (
                              <span className="text-[10px] text-zinc-400">
                                Ref.: {fipe.fipeReferenceMonth}
                              </span>
                            )
                          ) : (
                            <span className="text-[10px] text-amber-400">
                              Mês ref. não informado
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-zinc-500">
                          FIPE não informada
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <select
                        aria-label={`Status de ${vehicle.brand} ${vehicle.model}`}
                        value={vehicle.status}
                        onChange={(e) =>
                          handleQuickStatusChange(
                            vehicle,
                            e.target.value as VehicleStatus
                          )
                        }
                        className={`bg-[#09090B] border border-white/[0.1] hover:border-white/[0.2] rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:border-red-600 cursor-pointer ${getStatusTextClass(
                          vehicle.status
                        )}`}
                      >
                        {STATUS_OPTIONS.map((st) => (
                          <option key={st} value={st} className="bg-zinc-950 text-zinc-100">
                            {st}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onGeneratePostForVehicle(vehicle.id)}
                          title="Gerar Post com IA"
                          className="p-2 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-600/10 transition-colors"
                        >
                          <Sparkles className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(vehicle)}
                          title="Editar veículo"
                          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteVehicle(vehicle.id)}
                          title="Excluir veículo"
                          className="p-2 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-600/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Vehicle Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#111114] border border-white/[0.1] rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-white">
                  {editingVehicle ? 'Editar Veículo do Estoque' : 'Cadastrar Novo Veículo'}
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Preencha especificações técnicas, opcionais e foto do showroom.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-white/[0.05]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6">
              {formQuality.needsReview && (
                <div className="p-3.5 rounded-lg bg-amber-950/40 border border-amber-500/35 text-xs text-amber-200 space-y-1.5">
                  <p className="font-semibold flex items-center gap-2 text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Alertas de conferência deste cadastro</span>
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-amber-100/90">
                    {formQuality.reviewFlags.map((flag, i) => (
                      <li key={i}>{flag}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Photo Upload + Preview */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                <div className="md:col-span-5 aspect-[4/3] rounded-lg overflow-hidden bg-zinc-950 border border-white/[0.08]">
                  <VehicleImage
                    src={formState.imageUrl}
                    alt={`${formState.brand || 'Novo'} ${formState.model || 'Veículo'}`}
                  />
                </div>
                <div className="md:col-span-7 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Foto do Veículo (Upload)
                    </label>
                    <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] cursor-pointer transition-colors">
                      <Upload className="w-3.5 h-3.5 text-red-500" />
                      <span>Selecionar imagem do computador</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        className="sr-only"
                      />
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                      Ou escolha uma foto do acervo do showroom
                    </label>
                    <select
                      value={formState.imageUrl}
                      onChange={(e) =>
                        setFormState((prev) => ({ ...prev, imageUrl: e.target.value }))
                      }
                      className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-red-600"
                    >
                      {SHOWROOM_IMAGE_PRESETS.map((preset) => (
                        <option key={preset.url} value={preset.url}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Main Specs Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Marca *
                  </label>
                  <input
                    required
                    type="text"
                    value={formState.brand}
                    onChange={(e) =>
                      setFormState((prev) => ({ ...prev, brand: e.target.value }))
                    }
                    placeholder="Ex: BMW"
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Modelo *
                  </label>
                  <input
                    required
                    type="text"
                    value={formState.model}
                    onChange={(e) =>
                      setFormState((prev) => ({ ...prev, model: e.target.value }))
                    }
                    placeholder="Ex: 320i"
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Versão
                  </label>
                  <input
                    type="text"
                    value={formState.version}
                    onChange={(e) =>
                      setFormState((prev) => ({ ...prev, version: e.target.value }))
                    }
                    placeholder="Ex: M Sport 2.0 Turbo"
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Categoria
                  </label>
                  <select
                    value={formState.category || 'SUVs'}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        category: e.target.value as VehicleCategory,
                      }))
                    }
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
                  >
                    <option value="SUVs">SUVs</option>
                    <option value="Sedans">Sedans</option>
                    <option value="Hatches">Hatches</option>
                    <option value="Esportivos">Esportivos</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1">
                      Ano Fabricação *
                    </label>
                    <input
                      required
                      type="number"
                      min={1980}
                      max={2030}
                      value={yearFabInput}
                      onChange={(e) =>
                        setYearFabInput(Number(e.target.value) || 2024)
                      }
                      className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1">
                      Ano Modelo *
                    </label>
                    <input
                      required
                      type="number"
                      min={1980}
                      max={2030}
                      value={yearModelInput}
                      onChange={(e) =>
                        setYearModelInput(Number(e.target.value) || 2024)
                      }
                      className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Quilometragem (km)
                  </label>
                  <input
                    required
                    type="number"
                    min={0}
                    value={formState.km}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        km: Number(e.target.value) || 0,
                      }))
                    }
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Preço de Venda (R$) *
                  </label>
                  <input
                    required
                    type="number"
                    min={0}
                    value={formState.price}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        price: Number(e.target.value) || 0,
                      }))
                    }
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Valor Tabela FIPE (R$)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formState.fipePrice}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        fipePrice: Number(e.target.value) || 0,
                      }))
                    }
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Código FIPE (BrasilAPI)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={formState.fipeCode || ''}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          fipeCode: e.target.value,
                        }))
                      }
                      placeholder="Ex: 009222-3"
                      className="min-w-0 flex-1 px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleConsultarFipe()}
                      disabled={isQueryingFipe}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
                    >
                      {isQueryingFipe ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>Consultar</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Mês de Referência FIPE
                  </label>
                  <input
                    type="text"
                    value={formState.fipeReferenceMonth || ''}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        fipeReferenceMonth: e.target.value,
                      }))
                    }
                    placeholder="Ex: novembro de 2026"
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
                  />
                </div>

                {(fipeError || fipeResult || (formState.fipePrice > 0 && formState.price > 0)) && (
                  <div className="sm:col-span-3 p-3.5 rounded-lg bg-[#09090B] border border-white/[0.08] space-y-2.5">
                    {fipeError && (
                      <div className="flex items-start gap-2 text-xs text-red-300">
                        <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                        <span>{fipeError}</span>
                      </div>
                    )}

                    {fipeResult && (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2.5 border-b border-white/[0.06]">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">
                            {fipeResult.recommended.marca} · {fipeResult.items[selectedFipeIndex]?.modelo}
                          </p>
                          <p className="text-[11px] text-zinc-400 mt-0.5">
                            Tabela oficial BrasilAPI · Cód.{' '}
                            <span className="font-mono text-zinc-200">{fipeResult.codigoFipe}</span> · Ref.:{' '}
                            <span className="text-zinc-200">
                              {fipeResult.items[selectedFipeIndex]?.mesReferencia || fipeResult.recommended.mesReferencia}
                            </span>
                          </p>
                        </div>

                        {fipeResult.items.length > 1 && (
                          <div className="shrink-0">
                            <select
                              aria-label="Ano modelo retornado pela FIPE"
                              value={selectedFipeIndex}
                              onChange={(e) => handleSelectFipeYear(Number(e.target.value))}
                              className="px-2.5 py-1.5 bg-[#111114] border border-white/[0.12] rounded-md text-xs text-zinc-100 font-mono focus:outline-none focus:border-red-600"
                            >
                              {fipeResult.items.map((item, idx) => (
                                <option key={`${item.anoModelo}-${item.combustivel}`} value={idx}>
                                  {item.anoModelo === 32000 ? 'Zero KM' : item.anoModelo} · {item.combustivel} · {item.valor}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}

                    {formState.fipePrice > 0 && formState.price > 0 && (() => {
                      const diff = formState.fipePrice - formState.price;
                      const pct = ((Math.abs(diff) / formState.fipePrice) * 100).toFixed(1).replace('.', ',');
                      return (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="inline-flex items-center gap-1.5 text-zinc-300">
                            <BadgePercent className="w-4 h-4 text-red-500 shrink-0" />
                            <span>
                              Comparativo com Tabela FIPE ({formatBRL(formState.fipePrice)}):
                            </span>
                          </span>
                          <span
                            className={`font-mono font-semibold tabular-nums ${
                              diff > 0
                                ? 'text-emerald-400'
                                : diff < 0
                                  ? 'text-amber-400'
                                  : 'text-zinc-300'
                            }`}
                          >
                            {diff > 0
                              ? `${pct}% abaixo da FIPE (economia de ${formatBRL(diff)})`
                              : diff < 0
                                ? `${pct}% acima da FIPE (+${formatBRL(Math.abs(diff))})`
                                : 'Exatamente no valor da Tabela FIPE'}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Cor
                  </label>
                  <input
                    type="text"
                    value={formState.color}
                    onChange={(e) =>
                      setFormState((prev) => ({ ...prev, color: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Status
                  </label>
                  {editingVehicle ? (
                    <select
                      value={formState.status}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          status: e.target.value as VehicleStatus,
                        }))
                      }
                      className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
                    >
                      {STATUS_OPTIONS.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.08] rounded-lg text-sm text-emerald-400 font-medium">
                      Disponivel (padrão)
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Câmbio
                  </label>
                  <input
                    type="text"
                    value={formState.transmission}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        transmission: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Combustível
                  </label>
                  <input
                    type="text"
                    value={formState.fuel}
                    onChange={(e) =>
                      setFormState((prev) => ({ ...prev, fuel: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">
                    Placa
                  </label>
                  <input
                    type="text"
                    value={formState.plate}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        plate: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="ABC1D23"
                    className="w-full px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-sm text-white font-mono uppercase focus:outline-none"
                  />
                </div>
              </div>

              {/* Optionals Checklist */}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-2">
                  Opcionais do Veículo
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {COMMON_OPTIONALS.map((opt) => {
                    const selected = formState.optionals.includes(opt);
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => toggleOptional(opt)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left border transition-colors ${
                          selected
                            ? 'bg-red-600/15 border-red-600/40 text-white'
                            : 'bg-[#09090B] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <Check
                          className={`w-3.5 h-3.5 shrink-0 ${
                            selected ? 'text-red-500 opacity-100' : 'opacity-20'
                          }`}
                        />
                        <span className="truncate">{opt}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <input
                    type="text"
                    value={customOptional}
                    onChange={(e) => setCustomOptional(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomOptional();
                      }
                    }}
                    placeholder="Adicionar outro opcional (ex: Blindagem Nível III-A)..."
                    className="flex-1 px-3 py-2 bg-[#09090B] border border-white/[0.1] focus:border-red-600 rounded-lg text-xs text-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomOptional}
                    className="px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-200 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] whitespace-nowrap"
                  >
                    Adicionar
                  </button>
                </div>
              </div>

              {submitError && (
                <div className="p-3.5 rounded-lg bg-red-950/50 border border-red-600/40 flex items-start gap-2.5 text-xs text-red-200">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p>{submitError}</p>
                </div>
              )}

              <div className="pt-4 border-t border-white/[0.08] flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.05] hover:bg-white/[0.09] transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-60"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {isSaving
                      ? 'Salvando no banco...'
                      : editingVehicle
                        ? 'Salvar Alterações'
                        : 'Salvar Veículo no Estoque'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
