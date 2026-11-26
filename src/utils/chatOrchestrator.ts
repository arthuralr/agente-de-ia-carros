import {
  ChatSuggestedAction,
  DealershipSettings,
  ExternalSourceHealthStatus,
  TradeInSessionState,
  Vehicle,
  VehicleCardData,
  VehicleComparisonData,
  VehicleFinancingSummary,
  VehicleSearchFilters,
} from '../types';
import {
  analyzeVehicleDataQuality,
  analyzeVisitIntent,
  buildConsolidatedHandoffSummary,
  buildDealershipMapsUrl,
  buildDealershipPoliciesSummary,
  buildVehicleComparison,
  checkVehicleAgainstFilters,
  computeFinancingSummary,
  computeFipeMetrics,
  describeActiveFilters,
  extractTradeInInfo,
  extractVehicleMatchTokens,
  formatBrlCurrency,
  formatDealershipAddress,
  formatDealershipHours,
  formatKmBr,
  formatTradeInSummaryLine,
  getVehicleDisplayTitle,
  hasAnyActiveFilter,
  isVehicleAvailable,
  mergeTradeInSessionState,
  normalizeTextForMatch,
  parseFiltersDeterministically,
  parseFinancingParams,
  resolvePublicStorefrontLinks,
  resolveVehicleReference,
  resolveVehicleSheetLink,
  searchAndRankInventory,
  toVehicleCardData,
} from './vehicleDomain';

export interface ExternalInventoryRuntimeState {
  health: ExternalSourceHealthStatus;
  lastSuccessAt?: string | null;
  errorDetail?: string | null;
}

export interface ChatTurnContextInput {
  activeFilters?: VehicleSearchFilters | null;
  recentVehicleIds?: string[];
  focusedVehicleId?: string | null;
  compareVehicleIds?: string[];
  confirmedTradeIn?: TradeInSessionState | null;
  financingSummary?: VehicleFinancingSummary | null;
  baseUrl?: string | null;
}

export interface ChatTurnPlan {
  intent:
    | 'visit_inquiry'
    | 'visit_request'
    | 'trade_in'
    | 'trade_in_and_visit'
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
  tradeInSummary?: TradeInSessionState | null;
  handoffSummary?: string | null;
  promptAttachPhotos: boolean;
  suggestedActions: ChatSuggestedAction[];
  isVisitInquiryOnly: boolean;
  suppressHandoff: boolean;
  fichaUrl: string | null;
}

function buildOfficialLocationAndHours(
  dealership: DealershipSettings,
  configUnavailable = false
): {
  addressLine: string | null;
  mapsUrl: string | null;
  hours: ReturnType<typeof formatDealershipHours>;
  hasWhatsApp: boolean;
  markdownLines: string[];
  factsText: string;
} {
  const addressLine = configUnavailable ? null : formatDealershipAddress(dealership);
  const mapsUrl = configUnavailable ? null : buildDealershipMapsUrl(dealership);
  const hours = configUnavailable
    ? {
        weekdays: null,
        saturday: null,
        sunday: null,
        hasAny: false,
        inlineSummary: null,
        summaryLine: null,
      }
    : formatDealershipHours(dealership);
  const hasWhatsApp = Boolean((dealership.salesWhatsapp || dealership.whatsapp || '').trim());

  const markdownLines: string[] = [];
  if (configUnavailable) {
    markdownLines.push(
      `- **Localização e horários:** não foi possível consultar os dados atualizados da loja agora (falha temporária). Tente novamente em instantes${
        hasWhatsApp ? ' ou confirme com nosso consultor' : ''
      }.`
    );
  } else {
    if (addressLine) {
      markdownLines.push(
        `- **Endereço:** ${addressLine}${mapsUrl ? ` · [Ver no mapa](${mapsUrl})` : ''}`
      );
    } else {
      markdownLines.push(
        `- **Endereço:** confirme o endereço atualizado com nosso consultor${
          hasWhatsApp ? ' (botão **Falar com consultor** acima)' : ''
        }.`
      );
    }

    if (hours.hasAny) {
      if (hours.weekdays) markdownLines.push(`- **Segunda a sexta:** ${hours.weekdays}`);
      if (hours.saturday) markdownLines.push(`- **Sábado:** ${hours.saturday}`);
      if (hours.sunday) markdownLines.push(`- **Domingo:** ${hours.sunday}`);
    } else {
      markdownLines.push(
        `- **Horários:** confirme os horários de atendimento com nosso consultor.`
      );
    }
  }

  const policies = buildDealershipPoliciesSummary(dealership);

  const factsText = configUnavailable
    ? 'CONFIGURAÇÃO DA LOJA TEMPORARIAMENTE INDISPONÍVEL (NÃO INVENTE ENDEREÇO NEM HORÁRIO).'
    : [
        `Endereço oficial (${dealership.tradeName}): ${addressLine || 'NÃO CADASTRADO (diga para confirmar com o consultor; NUNCA invente endereço)'}`,
        `Horários oficiais: ${hours.inlineSummary || 'NÃO CADASTRADOS (diga para confirmar com o consultor)'}`,
        `Regras oficiais: ${policies.visitPolicyLine} ${policies.tradeInPolicyLine} ${policies.warrantyLine}`,
      ].join('\n');

  return {
    addressLine,
    mapsUrl,
    hours,
    hasWhatsApp,
    markdownLines,
    factsText,
  };
}

function buildReturnToSearchAction(
  prevFilters: VehicleSearchFilters
): ChatSuggestedAction | null {
  if (!hasAnyActiveFilter(prevFilters)) return null;
  const desc = describeActiveFilters(prevFilters).join(', ');
  return {
    id: 'act-return-search',
    label: 'Voltar à busca anterior',
    kind: 'prompt',
    promptText: `Voltar à minha busca anterior: ${desc}`,
  };
}

function buildOutOfFilterNote(
  vehicle: Vehicle,
  prevFilters: VehicleSearchFilters
): string {
  const check = checkVehicleAgainstFilters(vehicle, prevFilters);
  if (check.matches || !check.shortReason) return '';
  const quality = analyzeVehicleDataQuality(vehicle);
  return `\n- **Relação com sua busca anterior:** ${getVehicleDisplayTitle(vehicle)} ${vehicle.year} · **${quality.displayTransmission}** — este veículo está fora da sua busca anterior (${check.shortReason}).`;
}

function formatVehicleFactLine(
  v: Vehicle,
  origin?: string | null,
  dealership?: Partial<DealershipSettings> | null
): string {
  const q = analyzeVehicleDataQuality(v);
  const f = computeFipeMetrics(v);
  const link = resolveVehicleSheetLink(v, origin, dealership);
  const priceText =
    v.priceConfirmed === false || v.price <= 0
      ? 'Preço: a confirmar no site oficial'
      : `Preço à vista: ${formatBrlCurrency(v.price)}`;
  const availText =
    v.availabilityConfirmed === false
      ? `Status: ${v.status} (confirmar disponibilidade atual com a loja)`
      : `Status: ${v.status}`;
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

  return `- [ID ${v.id}] ${getVehicleDisplayTitle(v)} ${v.version || ''} | Ano: ${v.year || 'A confirmar'} | ${priceText} | Km: ${v.km > 0 ? formatKmBr(v.km) : 'A confirmar'} | ${transText} | Combustível: ${v.fuel || 'N/I'} | ${availText} | ${fipeText} | Link (${link.label}): ${link.fullUrl}`;
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
    const card = cards[0];
    const sheetActionLabel = card.isExternalUrl
      ? card.officialUrl
        ? 'Ver ficha oficial'
        : 'Ver vitrine da revenda'
      : 'Ver ficha';
    actions.push({
      id: `act-sheet-${card.id}`,
      label: sheetActionLabel,
      kind: 'open_sheet',
      vehicleId: card.id,
      sheetPath: card.sheetPath,
    });
    if (
      options?.includeSimulate !== false &&
      isVehicleAvailable({ status: card.status }) &&
      card.priceConfirmed !== false &&
      card.price > 0
    ) {
      actions.push({
        id: `act-sim-${card.id}`,
        label: 'Simular financiamento',
        kind: 'prompt',
        promptText: `Quero simular financiamento para o ${getVehicleDisplayTitle(card)} ${card.year} (#${card.id})`,
        vehicleId: card.id,
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
  dealershipConfigUnavailable?: boolean;
  selectedVehicle?: Vehicle | null;
  externalSourceState?: ExternalInventoryRuntimeState | null;
}): ChatTurnPlan {
  const {
    allVehicles,
    messages,
    latestUserUtterance,
    chatContext,
    dealership,
    dealershipConfigUnavailable = false,
    selectedVehicle,
    externalSourceState = null,
  } = params;

  const storefront = resolvePublicStorefrontLinks(dealership);
  const externalStaleNotice =
    storefront.isExternal && externalSourceState?.health === 'stale'
      ? `\n\n_Nota: os dados acima vêm da última sincronização bem-sucedida com o site oficial${
          externalSourceState.lastSuccessAt
            ? ` (${new Date(externalSourceState.lastSuccessAt).toLocaleString('pt-BR')})`
            : ''
        }. Confirme preço e disponibilidade atualizados no site da revenda ou com o consultor._`
      : '';
  const externalUnavailable =
    storefront.isExternal &&
    allVehicles.filter(isVehicleAvailable).length === 0 &&
    Boolean(
      externalSourceState &&
        ['unavailable', 'error', 'connector_required', 'not_configured'].includes(
          externalSourceState.health
        )
    );

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

  const locationInfo = buildOfficialLocationAndHours(
    dealership,
    dealershipConfigUnavailable
  );

  const confirmedTradeIn: TradeInSessionState | null =
    chatContext?.confirmedTradeIn || null;
  const prevFinancingSummary: VehicleFinancingSummary | null =
    chatContext?.financingSummary || null;

  const focusedVehicleFromContext = focusedId
    ? allVehicles.find((v) => v.id === focusedId) || null
    : selectedVehicle || null;

  const computePlanHandoffSummary = (overrides?: {
    focusedVehicleId?: string | null;
    financingSummary?: VehicleFinancingSummary | null;
    tradeInSummary?: TradeInSessionState | null;
  }) => {
    const fId =
      overrides?.focusedVehicleId !== undefined
        ? overrides.focusedVehicleId
        : focusedId;
    const fVeh = fId ? allVehicles.find((v) => v.id === fId) || null : null;
    const fin =
      overrides?.financingSummary !== undefined
        ? overrides.financingSummary
        : prevFinancingSummary;
    const tr =
      overrides?.tradeInSummary !== undefined
        ? overrides.tradeInSummary
        : confirmedTradeIn;
    return buildConsolidatedHandoffSummary({
      focusedVehicle: fVeh,
      financingSummary: fin,
      tradeInSummary: tr,
    });
  };

  // Detect independent compatible intents upfront so multi-intent messages cover ALL requests
  const visitIntent = analyzeVisitIntent(latestUserUtterance);
  const isTradeInTurn =
    /\b(troca|usado na troca|dar na troca|avaliar meu|meu carro|tenho um|enviar fotos|mandar fotos|fotos do carro|onde envio as fotos|na verdade meu carro|corrigindo meu carro)\b/i.test(
      normMsg
    ) && !/\b(comparar)\b/i.test(normMsg);

  // Isolate trade-in relevant messages so prior stock queries (e.g., "Onix 2021") never contaminate trade-in extraction
  const tradeInHistoryTexts = userHistoryTexts.filter((txt, idx) => {
    if (idx === userHistoryTexts.length - 1) return true;
    return /\b(troca|usado|meu carro|tenho um|avaliar meu|sinistro|leilao|pintura|km|quilometragem|manual|automatico|flex|gasolina|versao|modelo|cor)\b/i.test(
      normalizeTextForMatch(txt)
    ) && !/\b(ficha|simula|entrada|parcela|estoque|busc|procur|quero carro|me confirma)\b/i.test(
      normalizeTextForMatch(txt)
    );
  });

  const resolveProtectedTradeIn = () => {
    // If we already have confirmed trade-in state in this session, extract ONLY from the latest utterance
    // and run conflict-protected merge so we never silently overwrite confirmed details.
    if (
      confirmedTradeIn &&
      (confirmedTradeIn.brandModel ||
        confirmedTradeIn.yearText ||
        confirmedTradeIn.kmText ||
        confirmedTradeIn.transmission)
    ) {
      const latestExtracted = extractTradeInInfo([latestUserUtterance]);
      return mergeTradeInSessionState(
        confirmedTradeIn,
        latestExtracted,
        latestUserUtterance
      );
    }
    const initialExtracted = extractTradeInInfo(tradeInHistoryTexts);
    return mergeTradeInSessionState(
      confirmedTradeIn,
      initialExtracted,
      latestUserUtterance
    );
  };

  // -------------------------------------------------------------------------
  // 1A. COMBINED MULTI-INTENT: TRADE-IN + VISIT / ADDRESS / HOURS
  // -------------------------------------------------------------------------
  if (isTradeInTurn && visitIntent !== 'none') {
    const mergedTrade = resolveProtectedTradeIn();
    const formattedTradeLine = formatTradeInSummaryLine(mergedTrade.state);

    const conflictBlock =
      mergedTrade.conflicts.length > 0
        ? `\n- **Confirmação necessária:** já temos registrado o seu usado como **${formattedTradeLine}**. Você mencionou ${mergedTrade.conflicts
            .map((c) => `${c.field} **${c.newValue}** (em vez de ${c.existingValue})`)
            .join(', ')}. Mantemos os dados já anotados ou prefere atualizar?`
        : '';

    const knownSummary = formattedTradeLine
      ? `Mantive os dados do seu usado: **${formattedTradeLine}**.`
      : 'Vamos reunir os dados do seu usado para a **pré-avaliação do consultor**.';

    const missingLine =
      mergedTrade.missingFields.length > 0
        ? `Para completar a pré-avaliação, informe apenas o que faltou: **${mergedTrade.missingFields.join(', ')}** (além de eventuais detalhes estéticos/mecânicos ou sinistro).`
        : 'Os dados principais já estão anotados — basta enviar as fotos para a pré-avaliação humana.';

    const visitFooter =
      visitIntent === 'inquiry_only'
        ? 'Sem problema — **nenhum agendamento foi criado**.'
        : 'Se quiser, posso encaminhar uma **solicitação de visita** para confirmação de horário com um consultor.';

    const deterministicReply =
      `**1. Pré-avaliação na troca e envio de fotos**\n` +
      `- ${knownSummary}${conflictBlock}\n` +
      `- ${missingLine}\n` +
      `- **Onde enviar as fotos:** use o botão **Anexar fotos** logo abaixo (ou o ícone de clipe no campo de mensagem) para mandar frente, traseira, laterais, interior e painel com a quilometragem.\n\n` +
      `**2. Endereço e horários da loja**\n` +
      `${locationInfo.markdownLines.join('\n')}\n\n` +
      visitFooter;

    return {
      intent: 'trade_in_and_visit',
      useDeterministicDirectly: true,
      deterministicReply,
      verifiedFactsPrompt: `PEDIDO COMBINADO (TROCA + LOCALIZAÇÃO/HORÁRIO):\n- Usado informado: ${formattedTradeLine || 'nenhum'}\n- Faltando: ${mergedTrade.missingFields.join(', ') || 'nada obrigatório'}\n${locationInfo.factsText}\n- Visita: ${visitIntent === 'inquiry_only' ? 'APENAS CONSULTA — NÃO AGENDAR' : 'SOLICITAÇÃO DE VISITA'}`,
      activeFilters: prevFilters,
      recentVehicleIds: recentIds,
      focusedVehicleId: focusedId,
      vehicleCards: [],
      comparison: null,
      financingSummary: null,
      tradeInSummary: mergedTrade.state,
      handoffSummary: computePlanHandoffSummary({ tradeInSummary: mergedTrade.state }),
      promptAttachPhotos: true,
      suggestedActions: [
        {
          id: 'act-attach-photos',
          label: 'Anexar fotos',
          kind: 'attach_photos',
        },
        ...(visitIntent === 'request_visit'
          ? [
              {
                id: 'act-handoff-combined',
                label: 'Falar com consultor',
                kind: 'handoff' as const,
              },
            ]
          : []),
      ],
      isVisitInquiryOnly: visitIntent === 'inquiry_only',
      suppressHandoff: visitIntent === 'inquiry_only',
      fichaUrl: null,
    };
  }

  // -------------------------------------------------------------------------
  // 1B. VISIT INQUIRY VS VISIT REQUEST (Never schedule on exploratory question!)
  // -------------------------------------------------------------------------
  if (visitIntent === 'inquiry_only') {
    const policies = buildDealershipPoliciesSummary(dealership);
    const asksPolicy = /\b(test[\s-]?drive|como funciona|regras|garantia|procedencia)\b/i.test(
      normMsg
    );
    const policyLines = asksPolicy
      ? `\n- **Visitas e test-drive:** ${policies.visitPolicyLine}\n- **Garantia e procedência:** ${policies.warrantyLine}`
      : '';

    const headerLine = dealershipConfigUnavailable
      ? 'Não consegui consultar o endereço e os horários atualizados agora:'
      : `Confira as informações oficiais da **${dealership.tradeName}**:`;

    const deterministicReply =
      `${headerLine}\n${locationInfo.markdownLines.join('\n')}${policyLines}\n\n` +
      `Sem problema — **nenhum agendamento foi criado**. Se quiser consultar algum carro do estoque ou tirar outra dúvida, é só mandar por aqui.`;

    const actions: ChatSuggestedAction[] = [];
    if ((!locationInfo.addressLine || !locationInfo.hours.hasAny || dealershipConfigUnavailable) && locationInfo.hasWhatsApp) {
      actions.push({
        id: 'act-confirm-address-consultant',
        label: 'Confirmar com consultor',
        kind: 'handoff',
      });
    }

    return {
      intent: 'visit_inquiry',
      useDeterministicDirectly: true,
      deterministicReply,
      verifiedFactsPrompt: `${locationInfo.factsText}\nO cliente fez apenas uma consulta exploratória e pediu para NÃO agendar.`,
      activeFilters: prevFilters,
      recentVehicleIds: recentIds,
      focusedVehicleId: focusedId,
      vehicleCards: [],
      comparison: null,
      financingSummary: null,
      tradeInSummary: confirmedTradeIn,
      handoffSummary: computePlanHandoffSummary(),
      promptAttachPhotos: false,
      suggestedActions: actions,
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

    let statusNote = '';
    if (targetVehicle && !isVehicleAvailable(targetVehicle)) {
      statusNote = `\n\nAtenção: o **${getVehicleDisplayTitle(targetVehicle)} ${targetVehicle.year}** está atualmente com status **${targetVehicle.status}** no estoque.`;
    }

    const vehiclePart = targetVehicle
      ? ` para conhecer o **${getVehicleDisplayTitle(targetVehicle)} ${targetVehicle.year}**`
      : '';

    const deterministicReply =
      `Posso encaminhar sua **solicitação de visita**${vehiclePart} para um consultor confirmar o horário com você (a visita só fica confirmada após retorno da equipe).\n` +
      `${locationInfo.markdownLines.join('\n')}${statusNote}\n\n` +
      `Se quiser prosseguir, use o botão **Falar com consultor** para revisar a mensagem antes de abrir o WhatsApp.`;

    const cards = targetVehicle ? [toVehicleCardData(targetVehicle, origin, null, dealership)] : [];
    const targetLink = targetVehicle
      ? resolveVehicleSheetLink(targetVehicle, origin, dealership)
      : null;
    return {
      intent: 'visit_request',
      useDeterministicDirectly: true,
      deterministicReply,
      verifiedFactsPrompt: `SOLICITAÇÃO DE VISITA (NÃO É VISITA CONFIRMADA):\n${locationInfo.factsText}\n${targetVehicle ? formatVehicleFactLine(targetVehicle, origin, dealership) : '- Nenhum veículo específico selecionado ainda.'}\nREGRA: Trate explicitamente como "solicitação de visita" pendente de confirmação com o consultor; NUNCA diga "visita confirmada".`,
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
      fichaUrl: targetLink?.fullUrl || null,
    };
  }

  // -------------------------------------------------------------------------
  // 2. TRADE-IN (USADO NA TROCA) — Conflict-protected session state
  // -------------------------------------------------------------------------
  if (isTradeInTurn) {
    const mergedTrade = resolveProtectedTradeIn();
    const formattedTradeLine = formatTradeInSummaryLine(mergedTrade.state);

    // If a conflicting spec was detected without explicit correction phrasing,
    // DO NOT overwrite confirmed trade-in state — ask explicitly for confirmation!
    if (mergedTrade.conflicts.length > 0) {
      const conflictList = mergedTrade.conflicts
        .map(
          (c) =>
            `- **${c.field}:** registrado como **${c.existingValue}**, mas você mencionou **${c.newValue}**`
        )
        .join('\n');

      const deterministicReply =
        `Mantive os dados já confirmados do seu carro na troca (**${formattedTradeLine}**) para não sobrescrever seu atendimento.\n\n` +
        `Notei uma diferença na sua última mensagem:\n${conflictList}\n\n` +
        `Você quer **manter** o carro já anotado ou **atualizar** essas informações? (Se quiser atualizar, basta responder por exemplo: *"Na verdade, pode atualizar para..."*.)`;

      return {
        intent: 'trade_in',
        useDeterministicDirectly: true,
        deterministicReply,
        verifiedFactsPrompt: `CONFLITO DE DADOS NA TROCA (NÃO SOBRESCREVER SEM CONFIRMAÇÃO): Dados mantidos: ${formattedTradeLine}.`,
        activeFilters: prevFilters,
        recentVehicleIds: recentIds,
        focusedVehicleId: focusedId,
        vehicleCards: [],
        comparison: null,
        financingSummary: null,
        tradeInSummary: mergedTrade.state,
        handoffSummary: computePlanHandoffSummary({ tradeInSummary: mergedTrade.state }),
        promptAttachPhotos: false,
        suggestedActions: [
          {
            id: 'act-keep-tradein',
            label: 'Manter carro já anotado',
            kind: 'prompt',
            promptText: 'Pode manter os dados do meu usado já anotados',
          },
          {
            id: 'act-attach-photos',
            label: 'Anexar fotos',
            kind: 'attach_photos',
          },
        ],
        isVisitInquiryOnly: false,
        suppressHandoff: true,
        fichaUrl: null,
      };
    }

    const knownSummary = formattedTradeLine
      ? mergedTrade.wasExplicitCorrection
        ? `Atualizei os dados do seu carro na troca conforme solicitado: **${formattedTradeLine}**.`
        : `Já anotei os dados do seu carro na troca: **${formattedTradeLine}**.`
      : 'Vamos coletar os dados do seu veículo para a **pré-avaliação do consultor**.';

    const interestNote = focusedVehicleFromContext
      ? `\n_(Seu interesse principal continua no **${getVehicleDisplayTitle(focusedVehicleFromContext)} ${focusedVehicleFromContext.year}**.)_`
      : '';

    const missingLine =
      mergedTrade.missingFields.length > 0
        ? `Para completar a pré-avaliação, informe apenas o que faltou: **${mergedTrade.missingFields.join(', ')}** (e se há algum detalhe estético/mecânico ou sinistro).`
        : 'Com esses dados completos, falta apenas anexar as fotos para a pré-avaliação do consultor.';

    const deterministicReply = `${knownSummary}${interestNote}\n\n${missingLine}\n\nUse o botão **Anexar fotos** abaixo para enviar direto por aqui: **frente, traseira, laterais, interior e foto do painel mostrando a quilometragem**. Nossa equipe humana fará a pré-avaliação com base nessas informações.`;

    return {
      intent: 'trade_in',
      useDeterministicDirectly: mergedTrade.wasExplicitCorrection,
      deterministicReply,
      verifiedFactsPrompt: `COLETA DE TROCA PARA PRÉ-AVALIAÇÃO HUMANA:
- Dados confirmados do usado na troca (REAPROVEITE E NUNCA MISTURE COM O VEÍCULO DE INTERESSE): ${formattedTradeLine || 'Nenhum detalhe ainda'}
- Veículo de interesse em foco na loja: ${focusedVehicleFromContext ? `${getVehicleDisplayTitle(focusedVehicleFromContext)} ${focusedVehicleFromContext.year}` : 'Ainda não selecionado'}
- Campos que ainda faltam pedir do usado na troca: ${mergedTrade.missingFields.length > 0 ? mergedTrade.missingFields.join(', ') : 'Nenhum campo obrigatório faltando'}
- REGRAS OBRIGATÓRIAS:
  1. NÃO peça novamente dados já listados acima e NUNCA sobrescreva dados confirmados do usado na troca.
  2. NUNCA diga que vai enviar um "link para fotos" ou "link de upload". Oriente o cliente a usar o botão **"Anexar fotos"** disponível aqui no chat.
  3. Oriente quais fotos ajudam na avaliação (frente, traseira, laterais, interior e painel com km).
  4. Deixe claro que trata-se de coleta para **pré-avaliação pelo consultor humano** (não dê valor final fechado de compra).`,
      activeFilters: prevFilters,
      recentVehicleIds: recentIds,
      focusedVehicleId: focusedId,
      vehicleCards: [],
      comparison: null,
      financingSummary: null,
      tradeInSummary: mergedTrade.state,
      handoffSummary: computePlanHandoffSummary({ tradeInSummary: mergedTrade.state }),
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

    const comparison = buildVehicleComparison(targets, origin, dealership);
    if (comparison) {
      const bullets = comparison.highlights.map((h) => `- ${h}`).join('\n');
      const deterministicReply = `Comparei os **${comparison.vehicles.length} veículos selecionados** com base nos dados cadastrados:\n${bullets || '- Confira os campos lado a lado no comparativo abaixo.'}${externalStaleNotice}\n\nQuer abrir a ficha de algum deles ou simular financiamento?`;

      return {
        intent: 'comparison',
        useDeterministicDirectly: false,
        deterministicReply,
        verifiedFactsPrompt: `COMPARATIVO OBJETIVO (USE APENAS ESTES VEÍCULOS SELECIONADOS NA CONVERSA):
${targets.map((v) => formatVehicleFactLine(v, origin, dealership)).join('\n')}
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
          label: c.isExternalUrl && !c.officialUrl ? `Vitrine ${c.model}` : `Ficha ${c.model} ${c.year}`,
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
        vehicleCards: ref.candidates.slice(0, 3).map((c) => toVehicleCardData(c, origin, null, dealership)),
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
      const targetLink = resolveVehicleSheetLink(targetVehicle, origin, dealership);
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
          vehicleCards: [toVehicleCardData(targetVehicle, origin, null, dealership)],
          comparison: null,
          financingSummary: null,
          promptAttachPhotos: false,
          suggestedActions: [],
          isVisitInquiryOnly: false,
          suppressHandoff: true,
          fichaUrl: targetLink.fullUrl,
        };
      }

      if (targetVehicle.priceConfirmed === false || targetVehicle.price <= 0) {
        const deterministicReply = `O **${getVehicleDisplayTitle(targetVehicle)} ${targetVehicle.year}** está sem preço confirmado na vitrine oficial, por isso não consigo calcular o saldo de financiamento com precisão agora.\n- **${targetLink.label}:** [${targetLink.label}](${targetLink.href})\n\nSe quiser, fale com um consultor para confirmar o valor atualizado e simular.`;
        const cards = [toVehicleCardData(targetVehicle, origin, null, dealership)];
        return {
          intent: 'financing',
          useDeterministicDirectly: true,
          deterministicReply,
          verifiedFactsPrompt: `Preço não confirmado na vitrine oficial para ${getVehicleDisplayTitle(targetVehicle)}.`,
          activeFilters: prevFilters,
          recentVehicleIds: [targetVehicle.id],
          focusedVehicleId: targetVehicle.id,
          vehicleCards: cards,
          comparison: null,
          financingSummary: null,
          promptAttachPhotos: false,
          suggestedActions: buildContextualActions(cards, {
            includeSimulate: false,
            includeHandoff: true,
          }),
          isVisitInquiryOnly: false,
          suppressHandoff: false,
          fichaUrl: targetLink.fullUrl,
        };
      }

      const summary = computeFinancingSummary({
        vehicle: targetVehicle,
        downPayment,
        months,
        monthlyRatePct: dealership.financingMonthlyRatePct ?? null,
      });

      const targetQuality = analyzeVehicleDataQuality(targetVehicle);
      const outOfFilterNote = buildOutOfFilterNote(targetVehicle, prevFilters);
      const returnSearchAct = outOfFilterNote
        ? buildReturnToSearchAction(prevFilters)
        : null;

      const termLine = summary.months ? ` em **${summary.months}x**` : '';
      const installmentBlock = summary.estimatedInstallment
        ? `- **Estimativa ilustrativa${termLine}:** aprox. **${formatBrlCurrency(summary.estimatedInstallment)}/mês** (taxa ilustrativa de ${summary.monthlyRatePct?.toFixed(2).replace('.', ',')}% a.m., sujeita à análise de crédito, IOF e tarifas).`
        : `- **Parcela mensal${termLine}:** não calculada porque a taxa efetiva depende da análise de crédito e do banco escolhido (sem chute de parcela).`;

      const deterministicReply =
        `Para o **${summary.vehicleTitle}** (${formatBrlCurrency(summary.vehiclePrice)} · **${targetQuality.displayTransmission}** · ${targetVehicle.km > 0 ? formatKmBr(targetVehicle.km) : 'km a confirmar'}):` +
        `${outOfFilterNote}\n` +
        `- **Entrada informada:** ${formatBrlCurrency(summary.downPayment)}\n` +
        `- **Saldo a financiar (antes de juros e encargos):** **${formatBrlCurrency(summary.principalBalance)}**\n` +
        `${installmentBlock}\n` +
        `- **${targetLink.label}:** [${targetLink.label}](${targetLink.href})${externalStaleNotice}\n\n` +
        `Quando preferir, você pode solicitar uma simulação real com um consultor (opcional).`;

      const cards = [toVehicleCardData(targetVehicle, origin, null, dealership)];
      const baseActions = buildContextualActions(cards, {
        includeSimulate: false,
        includeHandoff: true,
        handoffLabel: 'Solicitar simulação real (opcional)',
      });
      if (returnSearchAct) baseActions.push(returnSearchAct);

      return {
        intent: 'financing',
        useDeterministicDirectly: true,
        deterministicReply,
        verifiedFactsPrompt: `SIMULAÇÃO DETERMINÍSTICA CALCULADA EM CÓDIGO:
${formatVehicleFactLine(targetVehicle, origin, dealership)}
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
        tradeInSummary: confirmedTradeIn,
        handoffSummary: computePlanHandoffSummary({
          focusedVehicleId: targetVehicle.id,
          financingSummary: summary,
        }),
        promptAttachPhotos: false,
        suggestedActions: baseActions,
        isVisitInquiryOnly: false,
        suppressHandoff: false,
        fichaUrl: targetLink.fullUrl,
      };
    }

    if (targetVehicle) {
      const targetQuality = analyzeVehicleDataQuality(targetVehicle);
      const targetLink = resolveVehicleSheetLink(targetVehicle, origin, dealership);
      const outOfFilterNote = buildOutOfFilterNote(targetVehicle, prevFilters);
      const returnSearchAct = outOfFilterNote
        ? buildReturnToSearchAction(prevFilters)
        : null;
      const priceDisplay =
        targetVehicle.priceConfirmed === false || targetVehicle.price <= 0
          ? 'preço a confirmar'
          : `**${formatBrlCurrency(targetVehicle.price)}**`;
      const deterministicReply = `Para simular o **${getVehicleDisplayTitle(targetVehicle)} ${targetVehicle.year}** (${priceDisplay} · **${targetQuality.displayTransmission}**):${outOfFilterNote}\n- **${targetLink.label}:** [${targetLink.label}](${targetLink.href})\n\nQual valor de **entrada** e em quantos **meses** (ex.: 36x, 48x ou 60x) você pretende financiar?`;
      return {
        intent: 'financing',
        useDeterministicDirectly: true,
        deterministicReply,
        verifiedFactsPrompt: `Peça entrada e prazo para o veículo ${formatVehicleFactLine(targetVehicle, origin, dealership)}`,
        activeFilters: prevFilters,
        recentVehicleIds: [targetVehicle.id],
        focusedVehicleId: targetVehicle.id,
        vehicleCards: [toVehicleCardData(targetVehicle, origin, null, dealership)],
        comparison: null,
        financingSummary: null,
        promptAttachPhotos: false,
        suggestedActions: returnSearchAct ? [returnSearchAct] : [],
        isVisitInquiryOnly: false,
        suppressHandoff: true,
        fichaUrl: targetLink.fullUrl,
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
      const link = resolveVehicleSheetLink(v, origin, dealership);
      const availabilityLine =
        v.availabilityConfirmed === false
          ? 'Disponibilidade a confirmar com a revenda'
          : isVehicleAvailable(v)
            ? 'Disponível em estoque'
            : `Status atual: **${v.status}** (não disponível para venda imediata)`;
      const priceText =
        v.priceConfirmed === false || v.price <= 0
          ? 'A confirmar no site oficial'
          : formatBrlCurrency(v.price);
      const fipeDiffText =
        f.hasFipeValue && f.hasReferenceMonth && f.diffBrl !== null && f.diffPct !== null
          ? f.diffBrl > 0
            ? ` (${formatBrlCurrency(f.diffBrl)} / ${f.diffPct}% abaixo da FIPE)`
            : f.diffBrl < 0
              ? ` (${formatBrlCurrency(Math.abs(f.diffBrl))} / ${Math.abs(f.diffPct)}% acima da FIPE)`
              : ' (no valor da FIPE)'
          : '';
      const fipeLine = !f.hasFipeValue
        ? 'FIPE: não cadastrada neste veículo'
        : f.hasReferenceMonth
          ? `FIPE (${f.fipeReferenceMonth}): ${formatBrlCurrency(f.fipePrice!)}${fipeDiffText}`
          : `FIPE: ${formatBrlCurrency(f.fipePrice!)} (mês de referência não informado)`;
      const conflictWarning = q.hasTransmissionConflict
        ? `\n- **Observação de cadastro:** ${q.conflictDetail} (confirmar com a loja).`
        : '';
      const outOfFilterNote = buildOutOfFilterNote(v, prevFilters);
      const returnSearchAct = outOfFilterNote
        ? buildReturnToSearchAction(prevFilters)
        : null;

      const deterministicReply = `Aqui estão os detalhes do **${getVehicleDisplayTitle(v)}** (${v.year}):\n- **Preço à vista:** ${priceText} · **${v.km > 0 ? formatKmBr(v.km) : 'km a confirmar'}** · **${q.displayTransmission}**\n- **${availabilityLine}** · ${fipeLine}${conflictWarning}${outOfFilterNote}\n- **${link.label}:** [${link.label}](${link.href})${externalStaleNotice}\n\nQuer simular financiamento ou comparar com outro veículo?`;

      const cards = [toVehicleCardData(v, origin, null, dealership)];
      const actions = buildContextualActions(cards, {
        includeSimulate: isVehicleAvailable(v),
        includeHandoff: true,
      });
      if (returnSearchAct) actions.push(returnSearchAct);

      return {
        intent: 'vehicle_sheet',
        useDeterministicDirectly: true,
        deterministicReply,
        verifiedFactsPrompt: `FICHA DIRETA SOLICITADA:\n${formatVehicleFactLine(v, origin, dealership)}\nURL: ${link.fullUrl}`,
        activeFilters: prevFilters,
        recentVehicleIds: [v.id],
        focusedVehicleId: v.id,
        vehicleCards: cards,
        comparison: null,
        financingSummary: null,
        promptAttachPhotos: false,
        suggestedActions: actions,
        isVisitInquiryOnly: false,
        suppressHandoff: false,
        fichaUrl: link.fullUrl,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 5.5 DIRECT SPECIFIC-VEHICLE CONFIRMATION / INSPECTION (preserves prior search!)
  // -------------------------------------------------------------------------
  const looksLikeFilterAdjustment =
    /\b(agora\s+pode|aument[ae]r?|subir|sobe|mud[ae]r?|alter[ae]r?|limpar|remover|voltar\s+a\s+busca|todos\s+os\s+carros|estoque|ate\s+r?\$?\s*\d|no\s+maximo|menos\s+de\s+\d)\b/i.test(
      normMsg
    );
  if (!looksLikeFilterAdjustment && !/\bfipe\b/i.test(normMsg)) {
    const directRef = resolveVehicleReference(
      latestUserUtterance,
      allVehicles,
      recentIds,
      focusedId
    );
    const explicitlyMentionsModel =
      directRef.status === 'resolved' &&
      directRef.reason &&
      !['focused_anaphora', 'single_context'].includes(directRef.reason);

    if (explicitlyMentionsModel && directRef.vehicle) {
      const v = directRef.vehicle;
      const q = analyzeVehicleDataQuality(v);
      const f = computeFipeMetrics(v);
      const link = resolveVehicleSheetLink(v, origin, dealership);
      const outOfFilterNote = buildOutOfFilterNote(v, prevFilters);
      const returnSearchAct = outOfFilterNote
        ? buildReturnToSearchAction(prevFilters)
        : null;
      const fipeSummary = !f.hasFipeValue
        ? 'FIPE não cadastrada'
        : f.hasReferenceMonth
          ? `FIPE (${f.fipeReferenceMonth}): ${formatBrlCurrency(f.fipePrice!)}`
          : `FIPE: ${formatBrlCurrency(f.fipePrice!)} (mês de referência não informado)`;
      const conflictWarning = q.hasTransmissionConflict
        ? `\n- **Atenção:** ${q.conflictDetail} (confirmar com a loja).`
        : '';
      const priceText =
        v.priceConfirmed === false || v.price <= 0
          ? 'preço a confirmar'
          : formatBrlCurrency(v.price);

      const deterministicReply =
        `Sobre o **${getVehicleDisplayTitle(v)}** (${v.year}):\n` +
        `- **Câmbio cadastrado:** **${q.displayTransmission}** · **${priceText}** · **${v.km > 0 ? formatKmBr(v.km) : 'km a confirmar'}** · ${v.availabilityConfirmed === false ? 'Disponibilidade a confirmar' : v.status}\n` +
        `- **${fipeSummary}**${conflictWarning}${outOfFilterNote}\n` +
        `- **${link.label}:** [${link.label}](${link.href})${externalStaleNotice}\n\n` +
        `Quer simular financiamento deste veículo ou voltar para a busca anterior?`;

      const cards = [toVehicleCardData(v, origin, null, dealership)];
      const actions = buildContextualActions(cards, {
        includeSimulate: isVehicleAvailable(v),
        includeHandoff: true,
      });
      if (returnSearchAct) actions.push(returnSearchAct);

      return {
        intent: 'vehicle_sheet',
        useDeterministicDirectly: true,
        deterministicReply,
        verifiedFactsPrompt: `CONSULTA DIRETA DE VEÍCULO ESPECÍFICO:\n${formatVehicleFactLine(v, origin, dealership)}`,
        activeFilters: prevFilters,
        recentVehicleIds: [v.id],
        focusedVehicleId: v.id,
        vehicleCards: cards,
        comparison: null,
        financingSummary: null,
        promptAttachPhotos: false,
        suggestedActions: actions,
        isVisitInquiryOnly: false,
        suppressHandoff: false,
        fichaUrl: link.fullUrl,
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

      const cards = [toVehicleCardData(v, origin, null, dealership)];
      const link = resolveVehicleSheetLink(v, origin, dealership);
      return {
        intent: 'fipe',
        useDeterministicDirectly: true,
        deterministicReply: fipeReply,
        verifiedFactsPrompt: `FIPE REAL DO VEÍCULO:\n${formatVehicleFactLine(v, origin, dealership)}`,
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
        fichaUrl: link.fullUrl,
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
    if (externalUnavailable) {
      const reasonLine =
        externalSourceState?.health === 'connector_required'
          ? 'O site oficial da revenda ainda precisa de uma fonte estruturada de estoque para consulta automática aqui no chat.'
          : 'No momento não foi possível consultar automaticamente o estoque atualizado do site oficial da revenda.';
      const deterministicReply =
        `${reasonLine}\n\n` +
        `Para ver os carros disponíveis em tempo real, você pode acessar diretamente a **[vitrine oficial da revenda](${storefront.catalogUrl})** ou falar com um consultor para confirmar modelos, preços e disponibilidade.`;

      return {
        intent: 'inventory_search',
        useDeterministicDirectly: true,
        deterministicReply,
        verifiedFactsPrompt: `FONTE EXTERNA DE ESTOQUE INDISPONÍVEL NO MOMENTO (${externalSourceState?.health}). Nunca invente veículos. Direcione para ${storefront.catalogUrl} ou consultor.`,
        activeFilters: nextFilters,
        recentVehicleIds: [],
        focusedVehicleId: null,
        vehicleCards: [],
        comparison: null,
        financingSummary: null,
        promptAttachPhotos: false,
        suggestedActions: [
          {
            id: 'act-external-catalog',
            label: 'Ver vitrine da revenda',
            kind: 'open_sheet',
            sheetPath: storefront.catalogUrl,
          },
          {
            id: 'act-handoff-ext-unavail',
            label: 'Falar com consultor',
            kind: 'handoff',
          },
        ],
        isVisitInquiryOnly: false,
        suppressHandoff: false,
        fichaUrl: storefront.catalogUrl,
      };
    }

    const searchRes = searchAndRankInventory(allVehicles, nextFilters);
    const filterDesc = describeActiveFilters(nextFilters);
    const filterLabel =
      filterDesc.length > 0 ? filterDesc.join(' · ') : 'todo o estoque disponível';

    if (searchRes.exactMatches.length > 0) {
      const topMatches = searchRes.exactMatches.slice(0, 3);
      const cards = topMatches.map((v) => toVehicleCardData(v, origin, null, dealership));
      const lines = topMatches.map((v) => {
        const q = analyzeVehicleDataQuality(v);
        const transNote = q.hasTransmissionConflict
          ? 'câmbio em conferência'
          : q.displayTransmission;
        const priceNote =
          v.priceConfirmed === false || v.price <= 0
            ? 'preço a confirmar'
            : `**${formatBrlCurrency(v.price)}**`;
        const kmNote = v.km > 0 ? formatKmBr(v.km) : 'km a confirmar';
        return `- **${getVehicleDisplayTitle(v)} ${v.year}** — ${priceNote} · ${kmNote} · ${transNote}`;
      });

      const extraCount =
        searchRes.exactMatches.length > 3
          ? ` (mostrando as 3 primeiras de ${searchRes.exactMatches.length})`
          : '';
      const conflictDisclaimer =
        searchRes.excludedConflicts.length > 0
          ? `\n\n_Nota: ${searchRes.excludedConflicts.length} veículo(s) com divergência de câmbio no cadastro não foram confirmados neste filtro._`
          : '';
      const catalogLinkLine = storefront.isExternal
        ? `\n\nVocê também pode conferir todas as opções em **[Ver carros no site da revenda](${storefront.catalogUrl})**.`
        : '';

      const deterministicReply = `Encontrei **${searchRes.exactMatches.length}** opção(ões) para **${filterLabel}**${extraCount}:\n${lines.join('\n')}${conflictDisclaimer}${externalStaleNotice}${catalogLinkLine}\n\nQuer abrir a ficha de algum deles, comparar ou ajustar um critério?`;

      return {
        intent: 'inventory_search',
        useDeterministicDirectly: false,
        deterministicReply,
        verifiedFactsPrompt: `RESULTADO EXATO DO ESTOQUE (FILTROS APLICADOS NO SERVIDOR: ${filterLabel}):
Total de correspondências exatas: ${searchRes.exactMatches.length} (exibindo até 3 cards na tela):
${topMatches.map((v) => formatVehicleFactLine(v, origin, dealership)).join('\n')}
${
  searchRes.excludedConflicts.length > 0
    ? `Veículos EXCLUÍDOS por divergência cadastral de câmbio (NUNCA confirme o câmbio deles): ${searchRes.excludedConflicts.map((e) => `${getVehicleDisplayTitle(e.vehicle)} ${e.vehicle.year} (${e.detail})`).join('; ')}`
    : ''
}
${storefront.isExternal ? `Vitrine oficial da revenda: ${storefront.catalogUrl}` : ''}
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
        `Alternativa próxima: ${nm.reasons.join(' · ')}`,
        dealership
      )
    );

    const nearLines = searchRes.nearMatches.slice(0, 3).map(
      (nm) =>
        `- **Alternativa:** **${getVehicleDisplayTitle(nm.vehicle)} ${nm.vehicle.year}** (${nm.vehicle.priceConfirmed === false || nm.vehicle.price <= 0 ? 'preço a confirmar' : formatBrlCurrency(nm.vehicle.price)} · ${nm.vehicle.km > 0 ? formatKmBr(nm.vehicle.km) : 'km a confirmar'}) — ${nm.reasons.join('; ')}.`
    );

    const externalFallback = storefront.isExternal
      ? `\n\nSe preferir, você pode conferir o catálogo completo em **[Ver vitrine da revenda](${storefront.catalogUrl})**.`
      : '';

    const deterministicReply =
      nearLines.length > 0
        ? `Não temos nenhum veículo disponível que atenda **exatamente** a todos os critérios (${filterLabel}).\n\nSe quiser avaliar **alternativas próximas** (fora de um ou mais filtros):\n${nearLines.join('\n')}${externalStaleNotice}${externalFallback}\n\nQuer flexibilizar algum critério (como preço, km ou câmbio) ou ver a ficha de uma dessas alternativas?`
        : `No momento não temos nenhum veículo disponível no estoque para **${filterLabel}**.${externalStaleNotice}${externalFallback}\n\nQuer ajustar algum critério (como preço, quilometragem ou câmbio) ou ver todo o estoque disponível?`;

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
        storefront.isExternal
          ? {
              id: 'act-external-catalog',
              label: 'Ver vitrine da revenda',
              kind: 'open_sheet',
              sheetPath: storefront.catalogUrl,
            }
          : {
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
  const stockLines = available.map((v) => formatVehicleFactLine(v, origin, dealership)).join('\n');
  const focusFact = resolvedFocus
    ? `Veículo em foco na conversa:\n${formatVehicleFactLine(resolvedFocus, origin, dealership)}\n\n`
    : '';
  const activeFilterNote = hasAnyActiveFilter(prevFilters)
    ? `Filtros ativos da conversa: ${describeActiveFilters(prevFilters).join(' · ')}\n`
    : '';
  const externalContextNote = storefront.isExternal
    ? `Modo vitrine oficial externa ativo: ${storefront.catalogUrl} (Status da fonte de estoque: ${externalSourceState?.health || 'ok'})\n`
    : '';

  const fallbackReply = externalUnavailable
    ? `Não consegui consultar automaticamente o estoque do site oficial agora, mas você pode acessar **[Ver vitrine da revenda](${storefront.catalogUrl})** ou falar com nossa equipe pelo WhatsApp.`
    : available.length > 0
      ? `Temos **${available.length} veículo(s) disponível(is)** no estoque${storefront.isExternal ? ' sincronizado com o site oficial' : ''}. Me diga a faixa de preço, câmbio ou modelo que você procura que eu filtro na hora.`
      : storefront.isExternal
        ? `Você pode consultar os carros diretamente em **[Ver vitrine da revenda](${storefront.catalogUrl})** ou me dizer o que procura para eu encaminhar ao consultor.`
        : 'No momento nosso estoque está em atualização. Posso te ajudar com simulação ou falar com um consultor.';

  const focusLink = resolvedFocus
    ? resolveVehicleSheetLink(resolvedFocus, origin, dealership)
    : null;

  const tradeInContextNote = formatTradeInSummaryLine(confirmedTradeIn)
    ? `Veículo do cliente na troca (MANTENHA SEPARADO do veículo de interesse da loja): ${formatTradeInSummaryLine(confirmedTradeIn)}\n`
    : '';

  return {
    intent: 'general',
    useDeterministicDirectly: externalUnavailable,
    deterministicReply: fallbackReply,
    verifiedFactsPrompt: `${externalContextNote}${focusFact}${tradeInContextNote}${activeFilterNote}ESTOQUE REAL DISPONÍVEL (${available.length} veículos):
${stockLines || 'Nenhum veículo disponível no momento.'}
${locationInfo.factsText}`,
    activeFilters: prevFilters,
    recentVehicleIds: resolvedFocus ? [resolvedFocus.id] : recentIds,
    focusedVehicleId: resolvedFocus ? resolvedFocus.id : focusedId,
    vehicleCards: resolvedFocus ? [toVehicleCardData(resolvedFocus, origin, null, dealership)] : [],
    comparison: null,
    financingSummary: null,
    tradeInSummary: confirmedTradeIn,
    handoffSummary: computePlanHandoffSummary({
      focusedVehicleId: resolvedFocus ? resolvedFocus.id : focusedId,
    }),
    promptAttachPhotos: false,
    suggestedActions: resolvedFocus
      ? buildContextualActions([toVehicleCardData(resolvedFocus, origin, null, dealership)])
      : externalUnavailable
        ? [
            {
              id: 'act-external-catalog',
              label: 'Ver vitrine da revenda',
              kind: 'open_sheet',
              sheetPath: storefront.catalogUrl,
            },
            {
              id: 'act-handoff-ext',
              label: 'Falar com consultor',
              kind: 'handoff',
            },
          ]
        : [],
    isVisitInquiryOnly: false,
    suppressHandoff: false,
    fichaUrl: focusLink?.fullUrl || null,
  };
}

/**
 * Post-validates a Gemini-drafted reply against strict business rules.
 * If the LLM violates a hard safety/truthfulness constraint (e.g. invents an installment
 * when no rate is configured, mentions "link das fotos" in trade-in, confirms a visit,
 * contradicts configured dealership address/hours, or invents FIPE values when none exist),
 * returns the verified deterministic reply instead.
 */
export function guardChatReply(
  llmReply: string,
  plan: ChatTurnPlan,
  dealership?: Partial<DealershipSettings> | null
): string {
  const clean = (llmReply || '').trim();
  if (!clean) return plan.deterministicReply;

  const norm = normalizeTextForMatch(clean);

  // Never offer a "link for photos" during trade-in
  if (
    (plan.intent === 'trade_in' || plan.intent === 'trade_in_and_visit') &&
    /\b(link\s+(?:para|das?|de)\s+(?:enviar\s+)?fotos?|mandar\s+o\s+link)\b/i.test(norm)
  ) {
    return plan.deterministicReply;
  }

  // Never say "visita confirmada" or "agendamento confirmado"
  if (
    (plan.intent === 'visit_request' ||
      plan.intent === 'visit_inquiry' ||
      plan.intent === 'trade_in_and_visit') &&
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

  // Never claim there is no registered address/hours when official dealership config HAS them
  if (dealership) {
    const officialAddr = formatDealershipAddress(dealership);
    if (
      officialAddr &&
      /\b(nao\s+(?:ha|temos|possuimos|consta)\s+endereco|endereco\s+nao\s+(?:cadastrado|informado|disponivel))\b/i.test(
        norm
      )
    ) {
      return plan.deterministicReply;
    }
    const officialHours = formatDealershipHours(dealership);
    if (
      officialHours.hasAny &&
      /\b(nao\s+(?:ha|temos|possuimos|consta)\s+horarios?|horarios?\s+nao\s+(?:cadastrados?|informados?))\b/i.test(
        norm
      )
    ) {
      return plan.deterministicReply;
    }
  }

  // Never fabricate a FIPE price or "abaixo da FIPE" claim when shown vehicles have NO FIPE price
  if (
    plan.vehicleCards.length > 0 &&
    plan.vehicleCards.every((c) => !c.fipePrice || c.fipePrice <= 0) &&
    (/\bfipe\b[^.\n]{0,30}r\$\s*\d/i.test(norm) ||
      /\babaixo\s+da\s+(?:tabela\s+)?fipe\b/i.test(norm))
  ) {
    return plan.deterministicReply;
  }

  return clean;
}
