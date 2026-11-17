import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Film,
  Instagram,
  Loader2,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import {
  DealershipSettings,
  GeneratedPostResponse,
  Vehicle,
} from '../../types';
import { formatBRL, formatKm } from '../../utils/formatters';
import { VehicleImage } from '../VehicleImage';
import { adminFetch } from '../../utils/authSession';

interface SocialAiModuleProps {
  vehicles: Vehicle[];
  settings: DealershipSettings;
  preselectedVehicleId: string | null;
  onClearPreselection: () => void;
  onUnauthorized?: () => void;
}

const PLATFORMS = [
  'Instagram & TikTok Shop (Combo)',
  'Instagram Feed & Reels',
  'TikTok Shop / Vídeo Curto',
  'WhatsApp Lista VIP',
] as const;

const TONES = [
  'Esportivo & Exclusivo',
  'Urgência & Oportunidade',
  'Consultivo & Confiança',
] as const;

export const SocialAiModule: React.FC<SocialAiModuleProps> = ({
  vehicles,
  settings,
  preselectedVehicleId,
  onClearPreselection,
  onUnauthorized,
}) => {
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(
    vehicles[0]?.id || ''
  );
  const [platform, setPlatform] = useState<string>(PLATFORMS[0]);
  const [tone, setTone] = useState<string>(TONES[0]);
  const [differentials, setDifferentials] = useState<string>(
    'Único dono, laudo cautelar 100% aprovado, revisões em concessionária, IPVA 2026 quitado e aceitamos seu seminovo na troca.'
  );

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedPostResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState<
    'full' | 'hashtags' | 'script' | null
  >(null);

  useEffect(() => {
    if (!selectedVehicleId && vehicles[0]?.id) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [vehicles, selectedVehicleId]);

  useEffect(() => {
    if (preselectedVehicleId) {
      setSelectedVehicleId(preselectedVehicleId);
      onClearPreselection();
    }
  }, [preselectedVehicleId, onClearPreselection]);

  const selectedVehicle =
    vehicles.find((v) => v.id === selectedVehicleId) || vehicles[0];

  const handleGenerate = async () => {
    if (!selectedVehicle) return;
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const response = await adminFetch('/api/ai/generate-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle: {
            brand: selectedVehicle.brand,
            model: selectedVehicle.model,
            version: selectedVehicle.version,
            year: selectedVehicle.year,
            km: selectedVehicle.km,
            price: selectedVehicle.price,
            color: selectedVehicle.color,
            transmission: selectedVehicle.transmission,
            fuel: selectedVehicle.fuel,
            optionals: selectedVehicle.optionals,
          },
          platform,
          tone,
          differentials,
          dealershipName: settings.tradeName,
          whatsapp: settings.whatsapp,
          city: `${settings.city} - ${settings.state}`,
        }),
      });

      if (response.status === 401) {
        onUnauthorized?.();
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.error || 'Falha ao gerar post com inteligência artificial.'
        );
      }

      setResult(data as GeneratedPostResponse);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Não foi possível conectar ao servidor de geração.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async (type: 'full' | 'hashtags' | 'script') => {
    if (!result) return;
    const text =
      type === 'hashtags'
        ? result.hashtags.join(' ')
        : type === 'script'
          ? result.roteiroReels
          : `${result.headline}\n\n${result.legenda}\n\n${result.ctaWhatsapp}\n\n${result.hashtags.join(' ')}`;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(type);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left Configuration Column */}
      <div className="xl:col-span-5 bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-5">
        <div>
          <h2 className="font-display text-base font-semibold text-white">
            Configuração da Campanha
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Selecione o veículo do estoque e os diferenciais comerciais para gerar a copy.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">
            Veículo em Estoque
          </label>
          <select
            value={selectedVehicle?.id || ''}
            onChange={(e) => setSelectedVehicleId(e.target.value)}
            className="w-full px-3 py-2.5 bg-[#09090B] border border-white/[0.1] rounded-lg text-sm text-white focus:outline-none focus:border-red-600"
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.brand} {v.model} {v.year} — {formatBRL(v.price)}
              </option>
            ))}
          </select>
        </div>

        {selectedVehicle && (
          <div className="flex items-center gap-3.5 p-3 rounded-lg bg-[#09090B] border border-white/[0.06]">
            <div className="w-20 h-14 rounded-md overflow-hidden shrink-0">
              <VehicleImage
                src={selectedVehicle.imageUrl}
                alt={`${selectedVehicle.brand} ${selectedVehicle.model}`}
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {selectedVehicle.brand} {selectedVehicle.model}
              </p>
              <p className="text-xs text-zinc-400 truncate">
                {selectedVehicle.version}
              </p>
              <p className="text-xs font-mono text-red-400 tabular-nums mt-0.5">
                {formatBRL(selectedVehicle.price)} · {formatKm(selectedVehicle.km)}
              </p>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">
            Plataforma de Destino
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                className={`px-3 py-2 rounded-lg text-xs font-medium text-left border transition-colors ${
                  platform === p
                    ? 'bg-red-600/15 border-red-600/40 text-white'
                    : 'bg-[#09090B] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">
            Tom de Comunicação
          </label>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTone(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                  tone === t
                    ? 'bg-zinc-800 border-white/20 text-white'
                    : 'bg-[#09090B] border-white/[0.08] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">
            Diferenciais & Condições Especiais
          </label>
          <textarea
            rows={4}
            value={differentials}
            onChange={(e) => setDifferentials(e.target.value)}
            placeholder="Informe detalhes extras (ex: revisado há 500km, pneus novos, bônus na troca, taxa zero)..."
            className="w-full px-3.5 py-2.5 bg-[#09090B] border border-white/[0.1] rounded-lg text-xs text-zinc-100 leading-relaxed focus:outline-none focus:border-red-600"
          />
        </div>

        <button
          type="button"
          disabled={isLoading || !selectedVehicle}
          onClick={handleGenerate}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Criando legenda persuasiva...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Gerar Post com IA</span>
            </>
          )}
        </button>

        {errorMsg && (
          <div className="p-3.5 rounded-lg bg-red-950/50 border border-red-600/40 flex items-start gap-2.5 text-xs text-red-200">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">{errorMsg}</p>
          </div>
        )}
      </div>

      {/* Right Generated Post Preview Column */}
      <div className="xl:col-span-7 bg-[#111114] border border-white/[0.08] rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <Instagram className="w-4 h-4 text-red-500" />
            <h2 className="font-display text-base font-semibold text-white">
              Pré-visualização & Copy Gerada
            </h2>
          </div>

          {result && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy('hashtags')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] whitespace-nowrap"
              >
                {copiedKey === 'hashtags' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>Copiar Hashtags</span>
              </button>
              <button
                type="button"
                onClick={() => handleCopy('full')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 whitespace-nowrap"
              >
                {copiedKey === 'full' ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>
                  {copiedKey === 'full' ? 'Legenda Copiada' : 'Copiar Legenda Completa'}
                </span>
              </button>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-4 py-6">
            <div className="h-56 w-full rounded-xl bg-zinc-900 animate-pulse" />
            <div className="h-5 w-2/3 rounded bg-zinc-900 animate-pulse" />
            <div className="h-4 w-full rounded bg-zinc-900 animate-pulse" />
            <div className="h-4 w-5/6 rounded bg-zinc-900 animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-zinc-900 animate-pulse" />
          </div>
        ) : !result ? (
          <div className="py-14 px-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-red-600/10 border border-red-600/20 flex items-center justify-center mx-auto">
              <Sparkles className="w-5 h-5 text-red-500" />
            </div>
            <p className="text-sm font-medium text-zinc-200">
              Nenhuma legenda gerada ainda
            </p>
            <p className="text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
              Escolha o veículo, ajuste os diferenciais ao lado e clique em{' '}
              <strong className="text-zinc-300">Gerar Post com IA</strong> para receber
              uma legenda pronta com gatilhos de urgência, CTA para WhatsApp, roteiro
              de vídeo e hashtags otimizadas.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Visual Social Post Mockup */}
            <div className="bg-[#09090B] border border-white/[0.08] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-md bg-red-600 flex items-center justify-center text-[11px] font-bold text-white">
                    AC
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">
                      {settings.tradeName}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      {settings.city}, {settings.state} · {platform}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-zinc-400 font-mono">
                  {selectedVehicle ? formatBRL(selectedVehicle.price) : ''}
                </span>
              </div>

              {selectedVehicle && (
                <div className="aspect-[16/9] w-full overflow-hidden bg-zinc-950">
                  <VehicleImage
                    src={selectedVehicle.imageUrl}
                    alt={`${selectedVehicle.brand} ${selectedVehicle.model}`}
                  />
                </div>
              )}

              <div className="p-5 space-y-4">
                <p className="font-display text-base font-semibold text-white">
                  {result.headline}
                </p>

                <div className="text-sm text-zinc-200 whitespace-pre-line leading-relaxed">
                  {result.legenda}
                </div>

                <div className="p-3.5 rounded-lg bg-[#111114] border border-white/[0.08] flex items-start gap-2.5">
                  <MessageCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-zinc-200 leading-relaxed">
                    {result.ctaWhatsapp}
                  </p>
                </div>

                <p className="text-xs text-red-400 leading-relaxed font-mono">
                  {result.hashtags.join(' ')}
                </p>
              </div>
            </div>

            {/* Reels / TikTok Video Script + Triggers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#09090B] border border-white/[0.08] rounded-xl p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Film className="w-4 h-4 text-red-500" />
                    <h3 className="text-xs font-semibold text-white">
                      Roteiro Sugerido (Instagram / TikTok Shop)
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy('script')}
                    className="text-[11px] font-medium text-zinc-400 hover:text-white inline-flex items-center gap-1"
                  >
                    {copiedKey === 'script' ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedKey === 'script' ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-line">
                  {result.roteiroReels}
                </p>
              </div>

              <div className="bg-[#09090B] border border-white/[0.08] rounded-xl p-4">
                <h3 className="text-xs font-semibold text-white mb-2">
                  Gatilhos Aplicados na Copy
                </h3>
                <ul className="space-y-1.5 text-xs text-zinc-400">
                  {result.gatilhos.map((g, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-red-500 font-mono">{idx + 1}.</span>
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
