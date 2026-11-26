import {
  ChatSuggestedAction,
  DealershipSettings,
  Vehicle,
  VehicleCardData,
  VehicleComparisonData,
  VehicleFinancingSummary,
  VehicleSearchFilters,
} from '../types';
import {
  analyzeVehicleDataQuality,
  analyzeVisitIntent,
  buildVehicleComparison,
  buildVehicleSheetPath,
  buildVehicleSheetUrl,
  computeFinancingSummary,
  computeFipeMetrics,
  describeActiveFilters,
  extractTradeInInfo,
  extractVehicleMatchTokens,
  formatBrlCurrency,
  formatKmBr,
  getVehicleDisplayTitle,
  hasAnyActiveFilter,
  isVehicleAvailable,
  normalizeTextForMatch,
  parseFiltersDeterministically,
  parseFinancingParams,
  resolveVehicleReference,
  searchAndRankInventory,
  toVehicleCardData,
} from './vehicleDomain';

export interface ChatTurnContextInput {
  activeFilters?: VehicleSearchFilters | null;
  recentVehicleIds?: string[];
  focusedVehicleId?: string | null;
  compareVehicleIds?: string[];
  baseUrl?: string | null;
}

export interface ChatTurnPlan {
  intent:
    | 'visit_inquiry'
    | 'visit_request'
    | 'trade_in'
    | 'comparison'
    | 'vehicle_sheet'
    | 'financing'
    | 'fipe'
    | 'inventory_search'
    | 'general';
  useDeterministicDirectly: boolean;
  deterministicReply: string;
  verifiedFactsPrompt: string;
  activeFilters: VehicleSearchFilters;
  recentVehicleIds: string[];
  focusedVehicleId: string | null;
  vehicleCards: VehicleCardData[];
  comparison: VehicleComparisonData | null;
  financingSummary: VehicleFinancingSummary | null;
  promptAttachPhotos: boolean;
  suggestedActions: ChatSuggestedAction[];
  isVisitInquiryOnly: boolean;
  suppressHandoff: boolean;
  fichaUrl: string | null;
}

function formatVehicleFactLine(v: Vehicle, origin?: string | null): string {
  const q = analyzeVehicleDataQuality(v);
  const f = computeFipeMetrics(v);
  const sheetUrl = buildVehicleSheetUrl(v.id, origin);
  const fipeText = !f.hasFipeValue
    ? 'FIPE: não cadastrada'
    : f.hasReferenceMonth
      ? `FIPE: ${formatBrlCurrency(f.fipePrice!)} (Ref.: ${f.fipeReferenceMonth}) — ${
          f.diffBrl! > 0
            ? `${formatBrlCurrency(f.diffBrl!)} (${f.diffPct}% abaixo da FIPE)`
            : f.diffBrl! < 0
              ? `${formatBrlCurrency(Math.abs(f.diffBrl!))} acima da FIPE`
              : 'no valor da FIPE'
        }`
      : `FIPE: ${formatBrlCurrency(f.fipePrice!)} (mês de referência NÃO informado — NÃO anunciar como oferta confirmada abaixo da FIPE)`;

  const transText = q.hasTransmissionConflict
    ? `Câmbio: EM CONFERÊNCIA CADASTRAL (${q.conflictDetail} — NÃO confirmar nem automático nem manual)`
    : `Câmbio: ${q.displayTransmission}`;

  return `- [ID ${v.id}] ${getVehicleDisplayTitle(v)} ${v.version || ''} | Ano: ${v.year} | Preço à vista: ${formatBrlCurrency(v.price)} | Km: ${formatKmBr(v.km)} | ${transText} | Combustível: ${v.fuel || 'N/I'} | Status: ${v.status} | ${fipeText} | Link ficha: ${sheetUrl}`;
}

function buildContextualActions(
  cards: VehicleCardData[],
  options?: {
    includeCompare?: boolean;
    includeSimulate?: boolean;
    includeAttachPhotos?: boolean;
    includeHandoff?: boolean;
    handoffLabel?: string;
  }
): ChatSuggestedAction[] {
  const actions: ChatSuggestedAction[] = [];
  if (options?.includeAttachPhotos) {
    actions.push({
      id: 'act-attach-photos',
      label: 'Anexar fotos',
      kind: 'attach_photos',
    });
  }
  if (cards.length === 1) {
    actions.push({
      id: `act-sheet-${cards[0].id}`,
      label: 'Ver ficha',
      kind: 'open_sheet',
      vehicleId: cards[0].id,
      sheetPath: cards[0].sheetPath,
    });
    if (options?.includeSimulate !== false && isVehicleAvailable({ status: cards[0].status })) {
      actions.push({
        id: `act-sim-${cards[0].id}`,
        label: 'Simular financiamento',
        kind: 'prompt',
        promptText: `Quero simular financiamento para o ${getVehicleDisplayTitle(cards[0])} ${cards[0].year} (#${cards[0].id})`,
        vehicleId: cards[0].id,
      });
    }
  } else if (cards.length >= 2 && options?.includeCompare !== false) {
    actions.push({
      id: 'act-compare-shown',
      label: 'Comparar opções',
      kind: 'compare',
      promptText: `Compare os ${Math.min(cards.length, 3)} veículos exibidos`,
    });
  }

  if (options?.includeHandoff) {
    actions.push({
      id: 'act-handoff',
      label: options.handoffLabel || 'Falar com consultor',
      kind: 'handoff',
    });
  }
  return actions;
}

/**
 * Deterministic server-side chat orchestrator.
 * Resolves filters, conflicts, FIPE, financing balance, trade-in state, visit intent,
 * shareable sheet links, and vehicle comparisons from real DB records BEFORE Gemini drafts prose.
 */
export function planChatTurn(params: {
  allVehicles: Vehicle[];
  messages: Array<{ sender: 'ia' | 'cliente'; text: string }>;
  latestUserUtterance: string;
  chatContext?: ChatTurnContextInput | null;
  dealership: DealershipSettings;
  selectedVehicle?: Vehicle | null;
}): ChatTurnPlan {
  const {
    allVehicles,
    messages,
    latestUserUtterance,
    chatContext,
    dealership,
    selectedVehicle,
  } = params;

  const normMsg = normalizeTextForMatch(latestUserUtterance);
  const origin = chatContext?.baseUrl || '';
  const prevFilters = chatContext?.activeFilters || {};
  const recentIds = Array.isArray(chatContext?.recentVehicleIds)
    ? chatContext!.recentVehicleIds.map(String)
    : [];
  const focusedId = chatContext?.focusedVehicleId
    ? String(chatContext.focusedVehicleId)
    : selectedVehicle?.id || null;
  const compareIds = Array.isArray(chatContext?.compareVehicleIds)
    ? chatContext!.compareVehicleIds.map(String)
    : [];

  const userHistoryTexts = messages
    .filter((m) => m.sender === 'cliente')
    .map((m) => m.text);
  if (
    latestUserUtterance.trim() &&
    userHistoryTexts[userHistoryTexts.length - 1] !== latestUserUtterance
  ) {
    userHistoryTexts.push(latestUserUtterance);
  }

  // -------------------------------------------------------------------------
  // 1. VISIT INQUIRY VS VISIT REQUEST (Never schedule on exploratory question!)
  // -------------------------------------------------------------------------
  const visitIntent = analyzeVisitIntent(latestUserUtterance);
  if (visitIntent === 'inquiry_only') {
    const addressLine = [dealership.address, dealership.city, dealership.state]
      .filter(Boolean)
      .join(' — ');
    const deterministicReply = `Nosso atendimento funciona assim:\n- **Segunda a sexta:** ${dealership.hoursWeekdays}\n- **Sábado:** ${dealership.hoursSaturday}\n- **Domingo:** ${dealership.hoursSunday}\n- **Endereço:** ${addressLine}\n\nSem problema — nenhum agendamento foi criado. Se quiser ver algum carro do estoque ou tirar outra dúvida, é só chamar por aqui.`;

    return {
      intent: 'visit_inquiry',
      useDeterministicDirectly: true,
      deterministicReply,
      verifiedFactsPrompt: `HORÁRIOS E ENDEREÇO OFICIAIS (${dealership.tradeName}): Seg-Sex ${dealership.hoursWeekdays} | Sábado ${dealership.hoursSaturday} | Domingo ${dealership.hoursSunday} | Endereço: ${addressLine}. O cliente fez apenas uma consulta exploratória e pediu para NÃO agendar. Responda com os dados acima e confirme que nada foi agendado.`,
      activeFilters: prevFilters,
      recentVehicleIds: recentIds,
      focusedVehicleId: focusedId,
      vehicleCards: [],
      comparison: null,
      financingSummary: null,
      promptAttachPhotos: false,
      suggestedActions: [],
      isVisitInquiryOnly: true,
      suppressHandoff: true,
      fichaUrl: null,
    };
  }

  if (visitIntent === 'request_visit') {
    const ref = resolveVehicleReference(
      latestUserUtterance,
      allVehicles,
      recentIds,
      focusedId
    );
    const targetVehicle = ref.status === 'resolved' ? ref.vehicle! : null;
    const addressLine = [dealership.address, dealership.city, dealership.state]
      .filter(Boolean)
      .join(' — ');

    let statusNote = '';
    if (targetVehicle && !isVehicleAvailable(targetVehicle)) {
      statusNote = `\n\nAtenção: o **${getVehicleDisplayTitle(targetVehicle)} ${targetVehicle.year}** está atualmente com status **${targetVehicle.status}** no estoque.`;
    }

    const vehiclePart = targetVehicle
      ? ` para conhecer o **${getVehicleDisplayTitle(targetVehicle)} ${targetVehicle.year}**`
      : '';

    const deterministicReply = `Posso encaminhar sua **solicitação de visita**${vehiclePart} para um consultor confirmar o horário com você (a visita só fica confirmada após retorno da equipe).\n- **Endereço:** ${addressLine}\n- **Horários:** ${dealership.hoursWeekdays} | ${dealership.hoursSaturday}${statusNote}\n\nSe quiser prosseguir, use o botão **Falar com consultor** para revisar a mensagem antes de abrir o WhatsApp.`;

    const cards = targetVehicle ? [toVehicleCardData(targetVehicle, origin)] : [];
    return {
      intent: 'visit_request',
      useDeterministicDirectly: false,
      deterministicReply,
      verifiedFactsPrompt: `SOLICITAÇÃO DE VISITA (NÃO É VISITA CONFIRMADA):
- Endereço oficial: ${addressLine}
- Horários oficiais: Seg-Sex ${dealership.hoursWeekdays} | Sábado ${dealership.hoursSaturday} | Domingo ${dealership.hoursSunday}
${targetVehicle ? formatVehicleFactLine(targetVehicle, origin) : '- Nenhum veículo específico selecionado ainda.'}
REGRA: Trate explicitamente como "solicitação de visita" pendente de confirmação com o consultor; NUNCA diga "visita confirmada".`,
      activeFilters: prevFilters,
      recentVehicleIds: targetVehicle ? [targetVehicle.id] : recentIds,
      focusedVehicleId: targetVehicle ? targetVehicle.id : focusedId,
      vehicleCards: cards,
      comparison: null,
      financingSummary: null,
      promptAttachPhotos: false,
      suggestedActions: buildContextualActions(cards, {
        includeHandoff: true,
        handoffLabel: 'Solicitar visita com consultor',
      }),
      isVisitInquiryOnly: false,
      suppressHandoff: false,
      fichaUrl: targetVehicle ? buildVehicleSheetUrl(targetVehicle.id, origin) : null,
    };
  }

  // -------------------------------------------------------------------------
  // 2. TRADE-IN (USADO NA TROCA) — Reuse details, never offer "photo link"
  // -------------------------------------------------------------------------
  const isTradeInTurn =
    /\b(troca|usado na troca|dar na troca|avaliar meu|meu carro|tenho um|enviar fotos|mandar fotos|fotos do carro)\b/i.test(
      normMsg
    ) && !/\b(ficha|comparar)\b/i.test(normMsg);

  if (isTradeInTurn) {
    const tradeInfo = extractTradeInInfo(userHistoryTexts);
    const knownParts: string[] = [];
    if (tradeInfo.model) knownParts.push(tradeInfo.model);
    if (tradeInfo.version) knownParts.push(tradeInfo.version);
    if (tradeInfo.year) knownParts.push(tradeInfo.year);
    if (tradeInfo.engine) knownParts.push(tradeInfo.engine);
    if (tradeInfo.transmission) knownParts.push(tradeInfo.transmission);
    if (tradeInfo.km) knownParts.push(tradeInfo.km);

    const knownSummary =
      knownParts.length > 0
        ? `Já anotei os dados do seu carro: **${knownParts.join(' · ')}**.`
        : 'Vamos coletar os dados do seu veículo para a **pré-avaliação do consultor**.';

    const missingLine =
      tradeInfo.missingFields.length > 0
        ? `Para completar a pré-avaliação, informe apenas o que faltou: **${tradeInfo.missingFields.join(', ')}** (e se há algum detalhe estético/mecânico ou sinistro).`
        : 'Com esses dados completos, falta apenas anexar as fotos para a pré-avaliação do consultor.';

    const deterministicReply = `${knownSummary}\n\n${missingLine}\n\nUse o botão **Anexar fotos** abaixo para enviar direto por aqui: **frente, traseira, laterais, interior e foto do painel mostrando a quilometragem**. Nossa equipe humana fará a pré-avaliação com base nessas informações.`;

    return {
      intent: 'trade_in',
      useDeterministicDirectly: false,
      deterministicReply,
      verifiedFactsPrompt: `COLETA DE TROCA PARA PRÉ-AVALIAÇÃO HUMANA:
- Dados já informados pelo cliente (REAPROVEITE E NÃO PEÇA DE NOVO): ${knownParts.length > 0 ? knownParts.join(', ') : 'Nenhum detalhe ainda'}
- Campos que ainda faltam pedir: ${tradeInfo.missingFields.length > 0 ? tradeInfo.missingFields.join(', ') : 'Nenhum campo obrigatório faltando'}
- REGRAS OBRIGATÓRIAS:
  1. NÃO peça novamente dados já listados acima.
  2. NUNCA diga que vai enviar um "link para fotos" ou "link de upload". Oriente o cliente a usar o botão **"Anexar fotos"** disponível aqui no chat.
  3. Oriente quais fotos ajudam na avaliação (frente, traseira, laterais, interior e painel com km).
  4. Deixe claro que trata-se de coleta para **pré-avaliação pelo consultor humano** (não dê valor final fechado de compra).`,
      activeFilters: prevFilters,
      recentVehicleIds: recentIds,
      focusedVehicleId: focusedId,
      vehicleCards: [],
      comparison: null,
      financingSummary: null,
      promptAttachPhotos: true,
      suggestedActions: [
        {
          id: 'act-attach-photos',
          label: 'Anexar fotos',
          kind: 'attach_photos',
        },
        {
          id: 'act-handoff-tradein',
          label: 'Enviar para consultor',
          kind: 'handoff',
        },
      ],
      isVisitInquiryOnly: false,
      suppressHandoff: false,
      fichaUrl: null,
    };
  }

  // -------------------------------------------------------------------------
  // 3. COMPARISON (Strictly selected/identified vehicles only)
  // -------------------------------------------------------------------------
  const isCompareTurn =
    /\b(comparar|compare|compara|diferenca entre|qual a diferenca|lado a lado|\bvs\.?\b|versus)\b/i.test(
      normMsg
    );

  if (isCompareTurn) {
    // Collect explicitly mentioned vehicles (with inline year disambiguation like "Onix 2021 e Gol 2021")
    const mentionedVehicles: Vehicle[] = [];
    for (const v of allVehicles) {
      const byId = new RegExp(`(?:#|veiculo\\/)\\s*${v.id}\\b`).test(normMsg);
      if (byId) {
        if (!mentionedVehicles.some((mv) => mv.id === v.id)) mentionedVehicles.push(v);
        continue;
      }
      const { modelTokens, brandTokens } = extractVehicleMatchTokens(v);
      const matchedModelTok = modelTokens.find((tok) =>
        new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normMsg)
      );
      const matchedTok =
        matchedModelTok ||
        brandTokens.find((tok) =>
          new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normMsg)
        );
      if (!matchedTok) continue;

      // If a year follows this specific token (e.g. "onix 2021"), require that year to match
      const escTok = matchedTok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const inlineYearMatch = normMsg.match(
        new RegExp(`\\b${escTok}\\b(?:\\s+[a-z0-9.]+){0,2}\\s+(20[0-2]\\d)\\b`, 'i')
      );
      if (inlineYearMatch?.[1] && !v.year.includes(inlineYearMatch[1])) {
        continue;
      }

      if (!mentionedVehicles.some((mv) => mv.id === v.id)) {
        mentionedVehicles.push(v);
      }
    }

    let targets: Vehicle[] = [];
    if (compareIds.length >= 2) {
      targets = compareIds
        .map((id) => allVehicles.find((v) => v.id === id))
        .filter((v): v is Vehicle => Boolean(v));
    }
    if (targets.length < 2 && mentionedVehicles.length >= 2) {
      targets = mentionedVehicles.slice(0, 3);
    }
    if (targets.length < 2 && recentIds.length >= 2) {
      targets = recentIds
        .map((id) => allVehicles.find((v) => v.id === id))
        .filter((v): v is Vehicle => Boolean(v))
        .slice(0, 3);
    }
    if (targets.length === 1 && focusedId && targets[0].id !== focusedId) {
      const f = allVehicles.find((v) => v.id === focusedId);
      if (f) targets.push(f);
    }

    const comparison = buildVehicleComparison(targets, origin);
    if (comparison) {
      const bullets = comparison.highlights.map((h) => `- ${h}`).join('\n');
      const deterministicReply = `Comparei os **${comparison.vehicles.length} veículos selecionados** com base nos dados cadastrados:\n${bullets || '- Confira os campos lado a lado no comparativo abaixo.'}\n\nQuer abrir a ficha de algum deles ou simular financiamento?`;

      return {
        intent: 'comparison',
        useDeterministicDirectly: false,
        deterministicReply,
        verifiedFactsPrompt: `COMPARATIVO OBJETIVO (USE APENAS ESTES VEÍCULOS SELECIONADOS NA CONVERSA):
${targets.map((v) => formatVehicleFactLine(v, origin)).join('\n')}
Diferenças objetivas calculadas:
${bullets}
REGRA: Compare APENAS os veículos acima usando campos reais cadastrados. Não adicione outros carros do estoque.`,
        activeFilters: prevFilters,
        recentVehicleIds: targets.map((t) => t.id),
        focusedVehicleId: focusedId,
        vehicleCards: [],
        comparison,
        financingSummary: null,
        promptAttachPhotos: false,
        suggestedActions: comparison.vehicles.map((c) => ({
          id: `act-sheet-${c.id}`,
          label: `Ficha ${c.model} ${c.year}`,
          kind: 'open_sheet',
          vehicleId: c.id,
          sheetPath: c.sheetPath,
        })),
        isVisitInquiryOnly: false,
        suppressHandoff: false,
        fichaUrl: null,
      };
    }

    const availableList = allVehicles
      .filter(isVehicleAvailable)
      .slice(0, 4)
      .map((v) => `**${getVehicleDisplayTitle(v)} ${v.year}** (${formatBrlCurrency(v.price)})`)
      .join(', ');

    return {
      intent: 'comparison',
      useDeterministicDirectly: true,
      deterministicReply: `Para montar o comparativo lado a lado, preciso de pelo menos **2 veículos**. Você pode clicar em **Comparar** nos cards ou me dizer quais modelos quer comparar (ex.: ${availableList || 'dois veículos do estoque'}).`,
      verifiedFactsPrompt: 'Peça ao cliente para escolher 2 veículos para comparar.',
      activeFilters: prevFilters,
      recentVehicleIds: recentIds,
      focusedVehicleId: focusedId,
      vehicleCards: [],
      comparison: null,
      financingSummary: null,
      promptAttachPhotos: false,
      suggestedActions: [],
      isVisitInquiryOnly: false,
      suppressHandoff: true,
      fichaUrl: null,
    };
  }

  // -------------------------------------------------------------------------
  // 4. FINANCING SIMULATION (Deterministic balance = price - downPayment, no fake installment)
  // -------------------------------------------------------------------------
  const finParams = parseFinancingParams(latestUserUtterance);
  const previousUserText = userHistoryTexts.slice(0, -1).join(' ');
  const prevFinParams = parseFinancingParams(previousUserText);

  if (finParams.isFinancingRequest) {
    const ref = resolveVehicleReference(
      latestUserUtterance,
      allVehicles,
      recentIds,
      focusedId
    );
    const targetVehicle =
      ref.status === 'resolved'
        ? ref.vehicle!
        : selectedVehicle ||
          (focusedId ? allVehicles.find((v) => v.id === focusedId) || null : null) ||
          (recentIds.length === 1
            ? allVehicles.find((v) => v.id === recentIds[0]) || null
            : null);

    if (ref.status === 'ambiguous' && ref.candidates && ref.candidates.length > 1) {
      const options = ref.candidates
        .slice(0, 3)
        .map(
          (c) =>
            `- **${getVehicleDisplayTitle(c)} ${c.version}** (${c.year}) — ${formatBrlCurrency(c.price)}`
        )
        .join('\n');
      return {
        intent: 'financing',
        useDeterministicDirectly: true,
        deterministicReply: `Encontrei mais de uma opção com esse nome. De qual deles você quer simular o financiamento?\n${options}`,
        verifiedFactsPrompt: `Ambiguidade de veículo na simulação:\n${options}`,
        activeFilters: prevFilters,
        recentVehicleIds: ref.candidates.map((c) => c.id),
        focusedVehicleId: null,
        vehicleCards: ref.candidates.slice(0, 3).map((c) => toVehicleCardData(c, origin)),
        comparison: null,
        financingSummary: null,
        promptAttachPhotos: false,
        suggestedActions: [],
        isVisitInquiryOnly: false,
        suppressHandoff: true,
        fichaUrl: null,
      };
    }

    const downPayment = finParams.downPayment ?? prevFinParams.downPayment;
    const months = finParams.months ?? prevFinParams.months;

    if (targetVehicle && downPayment !== null && downPayment > 0) {
      if (!isVehicleAvailable(targetVehicle)) {
        const deterministicReply = `O **${getVehicleDisplayTitle(targetVehicle)} ${targetVehicle.year}** está atualmente **${targetVehicle.status}** e não está disponível para simulação. Quer que eu busque opções disponíveis na mesma faixa de preço?`;
        return {
          intent: 'financing',
          useDeterministicDirectly: true,
          deterministicReply,
          verifiedFactsPrompt: `Veículo indisponível (${targetVehicle.status}).`,
          activeFilters: prevFilters,
          recentVehicleIds: recentIds,
          focusedVehicleId: targetVehicle.id,
          vehicleCards: [toVehicleCardData(targetVehicle, origin)],
          comparison: null,
          financingSummary: null,
          promptAttachPhotos: false,
          suggestedActions: [],
          isVisitInquiryOnly: false,
          suppressHandoff: true,
          fichaUrl: buildVehicleSheetUrl(targetVehicle.id, origin),
        };
      }

      const summary = computeFinancingSummary({
        vehicle: targetVehicle,
        downPayment,
        months,
        monthlyRatePct: dealership.financingMonthlyRatePct ?? null,
      });

      const termLine = summary.months ? ` em **${summary.months}x**` : '';
      const installmentBlock = summary.estimatedInstallment
        ? `- **Estimativa ilustrativa${termLine}:** aprox. **${formatBrlCurrency(summary.estimatedInstallment)}/mês** (taxa ilustrativa de ${summary.monthlyRatePct?.toFixed(2).replace('.', ',')}% a.m., sujeita à análise de crédito, IOF e tarifas).`
        : `- **Parcela mensal${termLine}:** não calculada porque a taxa efetiva depende da análise de crédito e do banco escolhido (sem chute de parcela).`;

      const deterministicReply = `Para o **${summary.vehicleTitle}** (${formatBrlCurrency(summary.vehiclePrice)}):\n- **Entrada informada:** ${formatBrlCurrency(summary.downPayment)}\n- **Saldo a financiar (antes de juros e encargos):** **${formatBrlCurrency(summary.principalBalance)}**\n${installmentBlock}\n\nSe quiser, você pode abrir a ficha completa ou, quando preferir, solicitar uma simulação real com um consultor (opcional).`;

      const cards = [toVehicleCardData(targetVehicle, origin)];
      return {
        intent: 'financing',
        useDeterministicDirectly: true,
        deterministicReply,
        verifiedFactsPrompt: `SIMULAÇÃO DETERMINÍSTICA CALCULADA EM CÓDIGO:
${formatVehicleFactLine(targetVehicle, origin)}
- Preço: ${formatBrlCurrency(summary.vehiclePrice)}
- Entrada: ${formatBrlCurrency(summary.downPayment)}
- Saldo a financiar (antes de juros/IOF/tarifas): ${formatBrlCurrency(summary.principalBalance)}
- Prazo informado: ${summary.months ? `${summary.months} meses` : 'Não informado'}
- Parcela calculada: ${summary.estimatedInstallment ? `${formatBrlCurrency(summary.estimatedInstallment)} (ilustrativa com ${summary.monthlyRatePct}% a.m.)` : 'NENHUMA (NÃO INVENTE PARCELA!)'}`,
        activeFilters: prevFilters,
        recentVehicleIds: [targetVehicle.id],
        focusedVehicleId: targetVehicle.id,
        vehicleCards: cards,
        comparison: null,
        financingSummary: summary,
        promptAttachPhotos: false,
        suggestedActions: buildContextualActions(cards, {
          includeSimulate: false,
          includeHandoff: true,
          handoffLabel: 'Solicitar simulação real (opcional)',
        }),
        isVisitInquiryOnly: false,
        suppressHandoff: false,
        fichaUrl: buildVehicleSheetUrl(targetVehicle.id, origin),
      };
    }

    if (targetVehicle) {
      const deterministicReply = `Para simular o **${getVehicleDisplayTitle(targetVehicle)} ${targetVehicle.year}** (**${formatBrlCurrency(targetVehicle.price)}**), qual valor de **entrada** e em quantos **meses** (ex.: 36x, 48x ou 60x) você pretende financiar?`;
      return {
        intent: 'financing',
        useDeterministicDirectly: true,
        deterministicReply,
        verifiedFactsPrompt: `Peça entrada e prazo para o veículo ${formatVehicleFactLine(targetVehicle, origin)}`,
        activeFilters: prevFilters,
        recentVehicleIds: [targetVehicle.id],
        focusedVehicleId: targetVehicle.id,
        vehicleCards: [toVehicleCardData(targetVehicle, origin)],
        comparison: null,
        financingSummary: null,
        promptAttachPhotos: false,
        suggestedActions: [],
        isVisitInquiryOnly: false,
        suppressHandoff: true,
        fichaUrl: buildVehicleSheetUrl(targetVehicle.id, origin),
      };
    }
  }

  // -------------------------------------------------------------------------
  // 5. VEHICLE SHEET / DIRECT LINK REQUEST
  // -------------------------------------------------------------------------
  const asksForSheet =
    /\b(ficha|link da ficha|link do carro|manda o link|mandar o link|ver detalhes|detalhes do|pagina do)\b/i.test(
      normMsg
    );

  if (asksForSheet) {
    const ref = resolveVehicleReference(
      latestUserUtterance,
      allVehicles,
      recentIds,
      focusedId
    );
    if (ref.status === 'ambiguous' && ref.candidates && ref.candidates.length > 1) {
      const opts = ref.candidates
        .slice(0, 3)
        .map(
          (v) =>
            `- **${getVehicleDisplayTitle(v)} ${v.version}** (${v.year}) — ${formatBrlCurrency(v.price)} · ${formatKmBr(v.km)}`
        )
        .join('\n');
      return {
        intent: 'vehicle_sheet',
        useDeterministicDirectly: true,
        deterministicReply: `Temos mais de um veículo correspondente. De qual deles você quer a ficha?\n${opts}`,
        verifiedFactsPrompt: `Ambiguidade para ficha:\n${opts}`,
        activeFilters: prevFilters,
        recentVehicleIds: ref.candidates.map((c) => c.id),
        focusedVehicleId: null,
        vehicleCards: ref.candidates.slice(0, 3).map((c) => toVehicleCardData(c, origin)),
        comparison: null,
        financingSummary: null,
        promptAttachPhotos: false,
        suggestedActions: [],
        isVisitInquiryOnly: false,
        suppressHandoff: true,
        fichaUrl: null,
      };
    }

    if (ref.status === 'resolved' && ref.vehicle) {
      const v = ref.vehicle;
      const q = analyzeVehicleDataQuality(v);
      const f = computeFipeMetrics(v);
      const sheetPath = buildVehicleSheetPath(v.id);
      const sheetUrl = buildVehicleSheetUrl(v.id, origin);
      const availabilityLine = isVehicleAvailable(v)
        ? 'Disponível em estoque'
        : `Status atual: **${v.status}** (não disponível para venda imediata)`;
      const fipeLine = !f.hasFipeValue
        ? 'FIPE: não cadastrada neste veículo'
        : f.hasReferenceMonth
          ? `FIPE (${f.fipeReferenceMonth}): ${formatBrlCurrency(f.fipePrice!)}`
          : `FIPE: ${formatBrlCurrency(f.fipePrice!)} (mês de referência não informado)`;
      const conflictWarning = q.hasTransmissionConflict
        ? `\n- **Observação de cadastro:** ${q.conflictDetail} (confirmar com a loja).`
        : '';

      const deterministicReply = `Aqui está a ficha do **${getVehicleDisplayTitle(v)} ${v.version}** (${v.year}):\n- **Preço à vista:** ${formatBrlCurrency(v.price)} · **${formatKmBr(v.km)}** · ${q.displayTransmission}\n- **${availabilityLine}** · ${fipeLine}${conflictWarning}\n- **Link direto da ficha:** [Abrir ficha do veículo](${sheetPath})\n\nQuer simular financiamento ou comparar com outro veículo?`;

      const cards = [toVehicleCardData(v, origin)];
      return {
        intent: 'vehicle_sheet',
        useDeterministicDirectly: true,
        deterministicReply,
        verifiedFactsPrompt: `FICHA DIRETA SOLICITADA:\n${formatVehicleFactLine(v, origin)}\nURL compartilhável: ${sheetUrl}`,
        activeFilters: prevFilters,
        recentVehicleIds: [v.id],
        focusedVehicleId: v.id,
        vehicleCards: cards,
        comparison: null,
        financingSummary: null,
        promptAttachPhotos: false,
        suggestedActions: buildContextualActions(cards, {
          includeSimulate: isVehicleAvailable(v),
          includeHandoff: true,
        }),
        isVisitInquiryOnly: false,
        suppressHandoff: false,
        fichaUrl: sheetUrl,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 6. FIPE INQUIRY (Truthful, same source as vitrine & ficha, NO fake 1.04)
  // -------------------------------------------------------------------------
  const asksFipe = /\b(fipe|tabela fipe|abaixo da fipe)\b/i.test(normMsg);
  if (asksFipe && !/\b(automatico|manual|ate \d|km)\b/i.test(normMsg)) {
    const ref = resolveVehicleReference(
      latestUserUtterance,
      allVehicles,
      recentIds,
      focusedId
    );
    if (ref.status === 'resolved' && ref.vehicle) {
      const v = ref.vehicle;
      const f = computeFipeMetrics(v);
      let fipeReply = '';
      if (!f.hasFipeValue) {
        fipeReply = `O **${getVehicleDisplayTitle(v)} ${v.year}** está anunciado por **${formatBrlCurrency(v.price)}**, mas ainda **não possui valor FIPE cadastrado** no sistema (não exibimos estimativa artificial). Se você tiver o código FIPE ou quiser que nossa equipe consulte a referência exata da versão, posso encaminhar para um consultor.`;
      } else if (!f.hasReferenceMonth) {
        const diffDesc =
          f.diffBrl! > 0
            ? `${formatBrlCurrency(f.diffBrl!)} (${f.diffPct}% abaixo)`
            : f.diffBrl! < 0
              ? `${formatBrlCurrency(Math.abs(f.diffBrl!))} (${Math.abs(f.diffPct!)}% acima)`
              : 'mesmo valor';
        fipeReply = `No cadastro do **${getVehicleDisplayTitle(v)} ${v.year}**:\n- **Preço à vista:** ${formatBrlCurrency(v.price)}\n- **Valor FIPE registrado:** ${formatBrlCurrency(f.fipePrice!)} (diferença de ${diffDesc})\n- **Mês de referência:** não informado no cadastro — por isso não tratamos como oferta confirmada abaixo da FIPE até confirmação da tabela atual.`;
      } else {
        const diffDesc =
          f.diffBrl! > 0
            ? `**${formatBrlCurrency(f.diffBrl!)} (${f.diffPct}% abaixo da FIPE)**`
            : f.diffBrl! < 0
              ? `${formatBrlCurrency(Math.abs(f.diffBrl!))} (${Math.abs(f.diffPct!)}% acima da FIPE)`
              : 'no mesmo valor da Tabela FIPE';
        fipeReply = `Referência FIPE cadastrada do **${getVehicleDisplayTitle(v)} ${v.year}**:\n- **Preço à vista:** ${formatBrlCurrency(v.price)}\n- **Tabela FIPE (${f.fipeReferenceMonth}):** ${formatBrlCurrency(f.fipePrice!)}\n- **Diferença:** ${diffDesc}\n\nQuer abrir a ficha completa ou simular financiamento?`;
      }

      const cards = [toVehicleCardData(v, origin)];
      return {
        intent: 'fipe',
        useDeterministicDirectly: true,
        deterministicReply: fipeReply,
        verifiedFactsPrompt: `FIPE REAL DO VEÍCULO:\n${formatVehicleFactLine(v, origin)}`,
        activeFilters: prevFilters,
        recentVehicleIds: [v.id],
        focusedVehicleId: v.id,
        vehicleCards: cards,
        comparison: null,
        financingSummary: null,
        promptAttachPhotos: false,
        suggestedActions: buildContextualActions(cards),
        isVisitInquiryOnly: false,
        suppressHandoff: true,
        fichaUrl: buildVehicleSheetUrl(v.id, origin),
      };
    }

    // General "quais carros estão abaixo da FIPE?" query
    const confirmedBelow = allVehicles
      .filter(isVehicleAvailable)
      .filter((v) => computeFipeMetrics(v).isConfirmedBelowFipeOffer);

    if (confirmedBelow.length === 0) {
      const withFipeNoMonth = allVehicles
        .filter(isVehicleAvailable)
        .filter((v) => {
          const f = computeFipeMetrics(v);
          return f.hasFipeValue && !f.hasReferenceMonth;
        });

      const extraNote =
        withFipeNoMonth.length > 0
          ? ` Há ${withFipeNoMonth.length} veículo(s) com valor FIPE registrado sem mês de referência informado, então não anunciamos como oferta confirmada abaixo da FIPE.`
          : '';

      return {
        intent: 'fipe',
        useDeterministicDirectly: true,
        deterministicReply: `No momento, não há veículos no estoque com **referência FIPE completa (valor + mês de referência)** confirmada abaixo da tabela.${extraNote}\n\nPosso mostrar nosso estoque disponível por faixa de preço ou consultar um código FIPE específico (ex.: \`001004-9\`). Como prefere buscar?`,
        verifiedFactsPrompt: 'Nenhum veículo com FIPE completa confirmada abaixo da tabela no momento.',
        activeFilters: prevFilters,
        recentVehicleIds: recentIds,
        focusedVehicleId: focusedId,
        vehicleCards: [],
        comparison: null,
        financingSummary: null,
        promptAttachPhotos: false,
        suggestedActions: [
          {
            id: 'act-show-all-stock',
            label: 'Ver estoque disponível',
            kind: 'prompt',
            promptText: 'Quero ver todos os carros disponíveis no estoque',
          },
        ],
        isVisitInquiryOnly: false,
        suppressHandoff: true,
        fichaUrl: null,
      };
    }

    const cards = confirmedBelow.slice(0, 3).map((v) => toVehicleCardData(v, origin));
    const lines = confirmedBelow.slice(0, 3).map((v) => {
      const f = computeFipeMetrics(v);
      return `- **${getVehicleDisplayTitle(v)} ${v.year}** — ${formatBrlCurrency(v.price)} (FIPE ${f.fipeReferenceMonth}: ${formatBrlCurrency(f.fipePrice!)}, **${formatBrlCurrency(f.diffBrl!)} / ${f.diffPct}% abaixo**)`;
    });
    return {
      intent: 'fipe',
      useDeterministicDirectly: true,
      deterministicReply: `Encontrei **${confirmedBelow.length}** opção(ões) confirmada(s) abaixo da Tabela FIPE:\n${lines.join('\n')}\n\nQuer ver a ficha de algum deles ou comparar?`,
      verifiedFactsPrompt: lines.join('\n'),
      activeFilters: { ...prevFilters, belowFipeOnly: true },
      recentVehicleIds: cards.map((c) => c.id),
      focusedVehicleId: cards.length === 1 ? cards[0].id : null,
      vehicleCards: cards,
      comparison: null,
      financingSummary: null,
      promptAttachPhotos: false,
      suggestedActions: buildContextualActions(cards),
      isVisitInquiryOnly: false,
      suppressHandoff: true,
      fichaUrl: null,
    };
  }

  // -------------------------------------------------------------------------
  // 7. DETERMINISTIC INVENTORY SEARCH & FILTERING
  // -------------------------------------------------------------------------
  const { filters: nextFilters, hasNewConstraints, wasReset } =
    parseFiltersDeterministically(latestUserUtterance, prevFilters, allVehicles);

  const isInventorySearchIntent =
    hasNewConstraints ||
    wasReset ||
    /\b(estoque|quais carros|tem carro|opcoes|disponiveis|procurando|buscando|quero um carro|quero ver|mostrar carros|catalogo|vitrine|seminovos)\b/i.test(
      normMsg
    );

  if (isInventorySearchIntent) {
    const searchRes = searchAndRankInventory(allVehicles, nextFilters);
    const filterDesc = describeActiveFilters(nextFilters);
    const filterLabel =
      filterDesc.length > 0 ? filterDesc.join(' · ') : 'todo o estoque disponível';

    if (searchRes.exactMatches.length > 0) {
      const topMatches = searchRes.exactMatches.slice(0, 3);
      const cards = topMatches.map((v) => toVehicleCardData(v, origin));
      const lines = topMatches.map((v) => {
        const q = analyzeVehicleDataQuality(v);
        const transNote = q.hasTransmissionConflict
          ? 'câmbio em conferência'
          : q.displayTransmission;
        return `- **${getVehicleDisplayTitle(v)} ${v.year}** — **${formatBrlCurrency(v.price)}** · ${formatKmBr(v.km)} · ${transNote}`;
      });

      const extraCount =
        searchRes.exactMatches.length > 3
          ? ` (mostrando as 3 primeiras de ${searchRes.exactMatches.length})`
          : '';
      const conflictDisclaimer =
        searchRes.excludedConflicts.length > 0
          ? `\n\n_Nota: ${searchRes.excludedConflicts.length} veículo(s) com divergência de câmbio no cadastro não foram confirmados neste filtro._`
          : '';

      const deterministicReply = `Encontrei **${searchRes.exactMatches.length}** opção(ões) para **${filterLabel}**${extraCount}:\n${lines.join('\n')}${conflictDisclaimer}\n\nQuer abrir a ficha de algum deles, comparar ou ajustar um critério?`;

      return {
        intent: 'inventory_search',
        useDeterministicDirectly: false,
        deterministicReply,
        verifiedFactsPrompt: `RESULTADO EXATO DO ESTOQUE (FILTROS APLICADOS NO SERVIDOR: ${filterLabel}):
Total de correspondências exatas: ${searchRes.exactMatches.length} (exibindo até 3 cards na tela):
${topMatches.map((v) => formatVehicleFactLine(v, origin)).join('\n')}
${
  searchRes.excludedConflicts.length > 0
    ? `Veículos EXCLUÍDOS por divergência cadastral de câmbio (NUNCA confirme o câmbio deles): ${searchRes.excludedConflicts.map((e) => `${getVehicleDisplayTitle(e.vehicle)} ${e.vehicle.year} (${e.detail})`).join('; ')}`
    : ''
}
REGRA: Liste SOMENTE os veículos exatos acima. Não invente características nem contradiga os filtros aplicados.`,
        activeFilters: nextFilters,
        recentVehicleIds: cards.map((c) => c.id),
        focusedVehicleId: cards.length === 1 ? cards[0].id : null,
        vehicleCards: cards,
        comparison: null,
        financingSummary: null,
        promptAttachPhotos: false,
        suggestedActions: buildContextualActions(cards),
        isVisitInquiryOnly: false,
        suppressHandoff: true,
        fichaUrl: cards.length === 1 ? cards[0].sheetUrl : null,
      };
    }

    // NO EXACT MATCH — clearly state it and label any close alternatives with concrete deltas!
    const nearCards = searchRes.nearMatches.slice(0, 3).map((nm) =>
      toVehicleCardData(
        nm.vehicle,
        origin,
        `Alternativa próxima: ${nm.reasons.join(' · ')}`
      )
    );

    const nearLines = searchRes.nearMatches.slice(0, 3).map(
      (nm) =>
        `- **Alternativa:** **${getVehicleDisplayTitle(nm.vehicle)} ${nm.vehicle.year}** (${formatBrlCurrency(nm.vehicle.price)} · ${formatKmBr(nm.vehicle.km)}) — ${nm.reasons.join('; ')}.`
    );

    const deterministicReply =
      nearLines.length > 0
        ? `Não temos nenhum veículo disponível que atenda **exatamente** a todos os critérios (${filterLabel}).\n\nSe quiser avaliar **alternativas próximas** (fora de um ou mais filtros):\n${nearLines.join('\n')}\n\nQuer flexibilizar algum critério (como preço, km ou câmbio) ou ver a ficha de uma dessas alternativas?`
        : `No momento não temos nenhum veículo disponível no estoque para **${filterLabel}**.\n\nQuer ajustar algum critério (como preço, quilometragem ou câmbio) ou ver todo o estoque disponível?`;

    return {
      intent: 'inventory_search',
      useDeterministicDirectly: true,
      deterministicReply,
      verifiedFactsPrompt: `NENHUMA CORRESPONDÊNCIA EXATA PARA: ${filterLabel}.
Alternativas próximas (DEVEM ser rotuladas como alternativas com a diferença exata):
${nearLines.join('\n') || 'Nenhuma alternativa próxima.'}`,
      activeFilters: nextFilters,
      recentVehicleIds: nearCards.map((c) => c.id),
      focusedVehicleId: null,
      vehicleCards: nearCards,
      comparison: null,
      financingSummary: null,
      promptAttachPhotos: false,
      suggestedActions: [
        ...buildContextualActions(nearCards, { includeSimulate: false }),
        {
          id: 'act-clear-filters',
          label: 'Ver todo o estoque',
          kind: 'prompt',
          promptText: 'Limpar filtros e ver todo o estoque disponível',
        },
      ],
      isVisitInquiryOnly: false,
      suppressHandoff: true,
      fichaUrl: null,
    };
  }

  // -------------------------------------------------------------------------
  // 8. GENERAL CONVERSATIONAL TURN (grounded in real fresh inventory & context)
  // -------------------------------------------------------------------------
  const ref = resolveVehicleReference(
    latestUserUtterance,
    allVehicles,
    recentIds,
    focusedId
  );
  const resolvedFocus =
    ref.status === 'resolved'
      ? ref.vehicle!
      : selectedVehicle ||
        (focusedId ? allVehicles.find((v) => v.id === focusedId) || null : null);

  const available = allVehicles.filter(isVehicleAvailable);
  const stockLines = available.map((v) => formatVehicleFactLine(v, origin)).join('\n');
  const focusFact = resolvedFocus
    ? `Veículo em foco na conversa:\n${formatVehicleFactLine(resolvedFocus, origin)}\n\n`
    : '';
  const activeFilterNote = hasAnyActiveFilter(prevFilters)
    ? `Filtros ativos da conversa: ${describeActiveFilters(prevFilters).join(' · ')}\n`
    : '';

  const fallbackReply =
    available.length > 0
      ? `Temos **${available.length} veículo(s) disponível(is)** no estoque. Me diga a faixa de preço, câmbio ou modelo que você procura que eu filtro na hora.`
      : 'No momento nosso estoque está em atualização. Posso te ajudar com simulação ou falar com um consultor.';

  return {
    intent: 'general',
    useDeterministicDirectly: false,
    deterministicReply: fallbackReply,
    verifiedFactsPrompt: `${focusFact}${activeFilterNote}ESTOQUE REAL DISPONÍVEL NO BANCO DE DADOS (${available.length} veículos):
${stockLines || 'Nenhum veículo disponível no momento.'}
ENDEREÇO E HORÁRIOS OFICIAIS (${dealership.tradeName}):
- Endereço: ${dealership.address}, ${dealership.city}/${dealership.state}
- Horários: Seg-Sex ${dealership.hoursWeekdays} | Sábado ${dealership.hoursSaturday} | Domingo ${dealership.hoursSunday}`,
    activeFilters: prevFilters,
    recentVehicleIds: resolvedFocus ? [resolvedFocus.id] : recentIds,
    focusedVehicleId: resolvedFocus ? resolvedFocus.id : focusedId,
    vehicleCards: resolvedFocus ? [toVehicleCardData(resolvedFocus, origin)] : [],
    comparison: null,
    financingSummary: null,
    promptAttachPhotos: false,
    suggestedActions: resolvedFocus
      ? buildContextualActions([toVehicleCardData(resolvedFocus, origin)])
      : [],
    isVisitInquiryOnly: false,
    suppressHandoff: false,
    fichaUrl: resolvedFocus ? buildVehicleSheetUrl(resolvedFocus.id, origin) : null,
  };
}

/**
 * Post-validates a Gemini-drafted reply against strict business rules.
 * If the LLM violates a hard safety/truthfulness constraint (e.g. invents an installment
 * when no rate is configured, mentions "link das fotos" in trade-in, confirms a visit,
 * or omits required ficha link), returns the verified deterministic reply instead.
 */
export function guardChatReply(
  llmReply: string,
  plan: ChatTurnPlan
): string {
  const clean = (llmReply || '').trim();
  if (!clean) return plan.deterministicReply;

  const norm = normalizeTextForMatch(clean);

  // Never offer a "link for photos" during trade-in
  if (
    plan.intent === 'trade_in' &&
    /\b(link\s+(?:para|das?|de)\s+(?:enviar\s+)?fotos?|mandar\s+o\s+link)\b/i.test(norm)
  ) {
    return plan.deterministicReply;
  }

  // Never say "visita confirmada" or "agendamento confirmado"
  if (
    (plan.intent === 'visit_request' || plan.intent === 'visit_inquiry') &&
    /\b(visita\s+confirmada|agendamento\s+confirmado|hor[aá]rio\s+confirmado|agendei\s+sua\s+visita)\b/i.test(
      norm
    )
  ) {
    return plan.deterministicReply;
  }

  // Never quote an installment amount if financing had no valid rate
  if (
    plan.financingSummary &&
    !plan.financingSummary.estimatedInstallment &&
    /r\$\s*\d[\d.,]*\s*(?:por\s+m[eê]s|\/m[eê]s|mensais|parcela)/i.test(norm)
  ) {
    return plan.deterministicReply;
  }

  return clean;
}
