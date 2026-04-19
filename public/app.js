(function () {
  const data = window.RAID_DATA;
  const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:4177" : "";
  const DECLINED_STORAGE_KEY = "raaDeclinedApplicantsV1";
  const DEFAULT_SCORE_WEIGHTS = {
    primaryWeight: 0.36,
    fallbackWeight: 0.33,
    openRoleWeight: 18,
    roleUrgencyWeight: 3,
    buffWeight: 1,
    fullRolePenalty: -20,
    noDataPenalty: -14,
    killBonus: 1,
  };
  const state = {
    hasWarcraftLogsCredentials: false,
    latestAnalysis: null,
    isFetchingLogs: false,
    isCheckingBridge: false,
    logFetchMessage: null,
    rateLimit: null,
    cacheSummary: null,
    clipboardBridge: null,
    bridgeInitialized: false,
    bridgeLatestHash: "",
    pendingBridgeExport: null,
    declinedApplicantKeys: loadDeclinedApplicantKeys(),
    rosterSort: {
      key: "name",
      direction: "asc",
    },
  };

  const elements = {
    tankTarget: document.querySelector("#tankTarget"),
    healerTarget: document.querySelector("#healerTarget"),
    dpsTarget: document.querySelector("#dpsTarget"),
    bossName: document.querySelector("#bossName"),
    encounterId: document.querySelector("#encounterId"),
    difficulty: document.querySelector("#difficulty"),
    metric: document.querySelector("#metric"),
    addonExport: document.querySelector("#addonExport"),
    importAddonExport: document.querySelector("#importAddonExport"),
    currentRoster: document.querySelector("#currentRoster"),
    applicants: document.querySelector("#applicants"),
    analyze: document.querySelector("#analyze"),
    fetchLogs: document.querySelector("#fetchLogs"),
    fetchRosterLogs: document.querySelector("#fetchRosterLogs"),
    loadDemo: document.querySelector("#loadDemo"),
    recommendationsList: document.querySelector("#recommendationsList"),
    roleMeters: document.querySelector("#roleMeters"),
    raidVisual: document.querySelector("#raidVisual"),
    buffList: document.querySelector("#buffList"),
    scoreTable: document.querySelector("#scoreTable"),
    rosterStats: document.querySelector("#rosterStats"),
    selectionCount: document.querySelector("#selectionCount"),
    compLabel: document.querySelector("#compLabel"),
    coverageLabel: document.querySelector("#coverageLabel"),
    scoreLabel: document.querySelector("#scoreLabel"),
    rosterStatsLabel: document.querySelector("#rosterStatsLabel"),
    serverState: document.querySelector("#serverState"),
    rateState: document.querySelector("#rateState"),
    inviteFilterSearch: document.querySelector("#inviteFilterSearch"),
    inviteFilterRole: document.querySelector("#inviteFilterRole"),
    inviteFilterClass: document.querySelector("#inviteFilterClass"),
    inviteFilterMinIlvl: document.querySelector("#inviteFilterMinIlvl"),
    inviteFilterFilled: document.querySelector("#inviteFilterFilled"),
    declinedCount: document.querySelector("#declinedCount"),
    clearDeclined: document.querySelector("#clearDeclined"),
    resetScoreWeights: document.querySelector("#resetScoreWeights"),
    scorePrimaryWeight: document.querySelector("#scorePrimaryWeight"),
    scoreFallbackWeight: document.querySelector("#scoreFallbackWeight"),
    scoreOpenRoleWeight: document.querySelector("#scoreOpenRoleWeight"),
    scoreRoleUrgencyWeight: document.querySelector("#scoreRoleUrgencyWeight"),
    scoreBuffWeight: document.querySelector("#scoreBuffWeight"),
    scoreFullRolePenalty: document.querySelector("#scoreFullRolePenalty"),
    scoreNoDataPenalty: document.querySelector("#scoreNoDataPenalty"),
    scoreKillBonus: document.querySelector("#scoreKillBonus"),
    toastStack: document.querySelector("#toastStack"),
  };
  let addonImportTimer = null;
  let lastAutoImportedExport = "";
  let bridgePollTimer = null;

  init();

  function init() {
    populateBossSelect();

    for (const difficulty of data.difficulties) {
      const option = document.createElement("option");
      option.value = String(difficulty.id);
      option.textContent = difficulty.name;
      elements.difficulty.append(option);
    }

    elements.currentRoster.value = "";
    elements.applicants.value = "";
    elements.addonExport.value = "";

    if (elements.analyze) elements.analyze.addEventListener("click", () => runAnalysis({ fetchLogs: false }));
    if (elements.fetchLogs) elements.fetchLogs.addEventListener("click", () => runAnalysis({ fetchLogs: true }));
    if (elements.fetchRosterLogs) elements.fetchRosterLogs.addEventListener("click", () => runAnalysis({ fetchLogs: true }));
    if (elements.loadDemo) elements.loadDemo.addEventListener("click", loadDemo);
    if (elements.importAddonExport) elements.importAddonExport.addEventListener("click", () => importAddonExport({ fetchLogs: true }));
    if (elements.addonExport) {
      elements.addonExport.addEventListener("paste", scheduleAddonExportImport);
      elements.addonExport.addEventListener("input", scheduleAddonExportImport);
    }
    if (elements.rosterStats) {
      elements.rosterStats.addEventListener("click", handleRosterSortClick);
    }
    if (elements.recommendationsList) {
      elements.recommendationsList.addEventListener("click", handleRecommendationsClick);
    }
    if (elements.clearDeclined) {
      elements.clearDeclined.addEventListener("click", clearDeclinedApplicants);
    }
    if (elements.resetScoreWeights) {
      elements.resetScoreWeights.addEventListener("click", resetScoreWeights);
    }
    populateInviteClassFilter();
    for (const input of [
      elements.inviteFilterSearch,
      elements.inviteFilterRole,
      elements.inviteFilterClass,
      elements.inviteFilterMinIlvl,
      elements.inviteFilterFilled,
    ].filter(Boolean)) {
      input.addEventListener("input", () => {
        if (state.latestAnalysis) renderRecommendations(state.latestAnalysis);
      });
      input.addEventListener("change", () => {
        if (state.latestAnalysis) renderRecommendations(state.latestAnalysis);
      });
    }
    for (const input of [
      elements.tankTarget,
      elements.healerTarget,
      elements.dpsTarget,
      elements.bossName,
      elements.difficulty,
      elements.metric,
      elements.currentRoster,
      elements.applicants,
      ...scoreWeightInputs(),
    ].filter(Boolean)) {
      input.addEventListener("input", () => runAnalysis({ fetchLogs: false }));
      input.addEventListener("change", () => runAnalysis({ fetchLogs: false }));
    }
    updateDeclinedUi();

    checkServer().then((health) => {
      if (health && health.hasWarcraftLogsCredentials) refreshRateLimit();
    });
    startBridgePolling();
    runAnalysis({ fetchLogs: false });
  }

  function apiFetch(path, options) {
    return fetch(`${API_BASE}${path}`, options);
  }

  function scoreWeightInputs() {
    return [
      elements.scorePrimaryWeight,
      elements.scoreFallbackWeight,
      elements.scoreOpenRoleWeight,
      elements.scoreRoleUrgencyWeight,
      elements.scoreBuffWeight,
      elements.scoreFullRolePenalty,
      elements.scoreNoDataPenalty,
      elements.scoreKillBonus,
    ];
  }

  function populateBossSelect() {
    if (!elements.bossName) return;

    const encounters = data.encounters && data.encounters.length
      ? data.encounters
      : [{ id: "", name: "Selected boss", default: true }];

    for (const encounter of encounters) {
      const option = document.createElement("option");
      option.value = encounter.name;
      option.textContent = encounter.name;
      if (encounter.id) option.dataset.encounterId = String(encounter.id);
      if (encounter.default) option.selected = true;
      elements.bossName.append(option);
    }

    const selectedOption = elements.bossName.selectedOptions && elements.bossName.selectedOptions[0];
    if (elements.encounterId && selectedOption) {
      elements.encounterId.value = selectedOption.dataset.encounterId || "";
    }

    elements.bossName.addEventListener("change", () => {
      const option = elements.bossName.selectedOptions && elements.bossName.selectedOptions[0];
      if (elements.encounterId) elements.encounterId.value = option ? option.dataset.encounterId || "" : "";
    });
  }

  async function checkServer() {
    try {
      const response = await apiFetch("/api/health");
      const health = await response.json();
      state.hasWarcraftLogsCredentials = Boolean(health.hasWarcraftLogsCredentials);
      state.clipboardBridge = health.clipboardBridge || null;
      const bridgeLabel = state.clipboardBridge && state.clipboardBridge.enabled ? " + clipboard bridge" : "";
      setServerState(
        `${state.hasWarcraftLogsCredentials ? "Warcraft Logs connected" : "Manual parse mode"}${bridgeLabel}`,
        health.ok
      );
      updateRateState(health.rateLimit, health.cache);
      return health;
    } catch (error) {
      setServerState("Local server unavailable", false);
      setRateState("API usage unavailable", "warn");
      return null;
    }
  }

  function setServerState(label, ok) {
    elements.serverState.classList.toggle("is-ok", ok);
    elements.serverState.classList.toggle("is-warn", !state.hasWarcraftLogsCredentials);
    elements.serverState.querySelector("span:last-child").textContent = label;
  }

  async function refreshRateLimit() {
    if (!state.hasWarcraftLogsCredentials) return;

    setRateState("Checking API usage", "checking");
    try {
      const response = await apiFetch("/api/warcraftlogs/rate-limit");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Rate limit request failed.");
      updateRateState(payload.rateLimit, payload.cache);
    } catch (error) {
      setRateState("API usage unavailable", "warn");
    }
  }

  function updateRateState(rateLimit, cache) {
    if (cache) state.cacheSummary = cache;
    if (!rateLimit) {
      const cacheLabel = formatCacheSummary(state.cacheSummary);
      setRateState(cacheLabel ? `Usage pending - ${cacheLabel}` : "API usage unknown", "warn");
      return;
    }

    state.rateLimit = rateLimit;
    const spent = numberOrZero(rateLimit.pointsSpentThisHour);
    const limit = numberOrZero(rateLimit.limitPerHour);
    const percent = limit ? Math.round((spent / limit) * 100) : 0;
    const reset = formatDuration(rateLimit.pointsResetIn);
    const cacheLabel = formatCacheSummary(state.cacheSummary);
    const usage = limit ? `${spent}/${limit} pts (${percent}%)` : `${spent} pts`;
    const suffix = [reset ? `reset ${reset}` : "", cacheLabel].filter(Boolean).join(" - ");
    const status = percent >= 85 ? "hot" : percent >= 65 ? "warn" : "ok";

    setRateState(suffix ? `${usage} - ${suffix}` : usage, status);
  }

  function setRateState(label, status) {
    if (!elements.rateState) return;

    elements.rateState.classList.toggle("is-ok", status === "ok");
    elements.rateState.classList.toggle("is-warn", status === "warn");
    elements.rateState.classList.toggle("is-hot", status === "hot");
    elements.rateState.classList.toggle("is-checking", status === "checking");
    elements.rateState.querySelector("span:last-child").textContent = label;
  }

  function formatCacheSummary(cache) {
    if (!cache) return "";
    const hits = numberOrZero(cache.hits);
    const entries = numberOrZero(cache.entries);
    if (!hits && !entries) return "";
    return `${hits} cached${entries ? `, ${entries} stored` : ""}`;
  }

  function formatDuration(seconds) {
    const totalSeconds = Number(seconds);
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "";
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = Math.round(totalSeconds % 60);
    if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${remainingSeconds}s`;
  }

  function loadDeclinedApplicantKeys() {
    try {
      const raw = window.sessionStorage && window.sessionStorage.getItem(DECLINED_STORAGE_KEY);
      const keys = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(keys) ? keys.map(normalizeApplicantKey).filter(Boolean) : []);
    } catch (error) {
      return new Set();
    }
  }

  function saveDeclinedApplicantKeys() {
    try {
      if (window.sessionStorage) {
        window.sessionStorage.setItem(DECLINED_STORAGE_KEY, JSON.stringify([...state.declinedApplicantKeys]));
      }
    } catch (error) {
      // Session decline state is best-effort; in-memory state still works.
    }
  }

  function applicantKey(person) {
    if (!person) return "";
    return normalizeApplicantKey(`${person.name}|${person.realm}|${person.region || "US"}`);
  }

  function normalizeApplicantKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/-us$/i, "|us");
  }

  function filterDeclinedApplicants(applicants) {
    return applicants.filter((applicant) => !state.declinedApplicantKeys.has(applicantKey(applicant)));
  }

  function handleRecommendationsClick(event) {
    const button = event.target.closest("[data-decline-key]");
    if (!button) return;

    event.preventDefault();
    declineApplicant(button.dataset.declineKey, button.dataset.declineName || "Applicant");
  }

  function declineApplicant(key, name) {
    const normalized = normalizeApplicantKey(key);
    if (!normalized) return;

    state.declinedApplicantKeys.add(normalized);
    saveDeclinedApplicantKeys();
    updateDeclinedUi();
    setScoreLabel(`${name} declined for this session`);

    if (state.latestAnalysis) {
      const analysis = recommendApplicants({
        target: state.latestAnalysis.target,
        roster: state.latestAnalysis.roster,
        applicants: filterDeclinedApplicants(state.latestAnalysis.applicants),
      });
      state.latestAnalysis = analysis;
      render(analysis);
    }
  }

  function clearDeclinedApplicants() {
    if (!state.declinedApplicantKeys.size) return;

    state.declinedApplicantKeys.clear();
    saveDeclinedApplicantKeys();
    updateDeclinedUi();
    setScoreLabel("Declined applicants cleared");
    runAnalysis({ fetchLogs: false });
  }

  function updateDeclinedUi() {
    const count = state.declinedApplicantKeys.size;
    if (elements.declinedCount) {
      elements.declinedCount.textContent = `${count} declined`;
    }
    if (elements.clearDeclined) {
      elements.clearDeclined.disabled = count === 0;
    }
  }

  function resetScoreWeights() {
    const pairs = [
      [elements.scorePrimaryWeight, DEFAULT_SCORE_WEIGHTS.primaryWeight],
      [elements.scoreFallbackWeight, DEFAULT_SCORE_WEIGHTS.fallbackWeight],
      [elements.scoreOpenRoleWeight, DEFAULT_SCORE_WEIGHTS.openRoleWeight],
      [elements.scoreRoleUrgencyWeight, DEFAULT_SCORE_WEIGHTS.roleUrgencyWeight],
      [elements.scoreBuffWeight, DEFAULT_SCORE_WEIGHTS.buffWeight],
      [elements.scoreFullRolePenalty, DEFAULT_SCORE_WEIGHTS.fullRolePenalty],
      [elements.scoreNoDataPenalty, DEFAULT_SCORE_WEIGHTS.noDataPenalty],
      [elements.scoreKillBonus, DEFAULT_SCORE_WEIGHTS.killBonus],
    ];
    for (const [input, value] of pairs) {
      if (input) input.value = String(value);
    }
    runAnalysis({ fetchLogs: false });
  }

  function showClipboardToast(parsed) {
    if (!elements.toastStack) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `
      <strong>Game export received</strong>
      <span>${escapeHtml(formatTimestamp(new Date()))} - ${parsed.roster.length} roster, ${parsed.applicants.length} applicants</span>
    `;
    elements.toastStack.append(toast);

    window.setTimeout(() => {
      toast.classList.add("is-hiding");
      window.setTimeout(() => toast.remove(), 260);
    }, 5200);
  }

  function formatTimestamp(date) {
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function loadDemo() {
    elements.currentRoster.value = data.demoRoster;
    elements.applicants.value = data.demoApplicants;
    elements.addonExport.value = "";
    runAnalysis({ fetchLogs: false });
  }

  function startBridgePolling() {
    if (bridgePollTimer || !window.fetch) return;

    checkBridgeExport();
    bridgePollTimer = window.setInterval(checkBridgeExport, 1500);
  }

  async function checkBridgeExport() {
    if (state.isCheckingBridge) return;

    state.isCheckingBridge = true;
    try {
      const response = await apiFetch("/api/bridge/export", { cache: "no-store" });
      if (!response.ok) return;

      const payload = await response.json();
      const latest = payload && payload.latest;
      if (!latest || !payload.text) {
        state.bridgeInitialized = true;
        return;
      }

      const fingerprint = latest.hash || String(latest.id || "");
      if (!fingerprint || fingerprint === state.bridgeLatestHash) return;
      if (!state.bridgeInitialized) {
        state.bridgeInitialized = true;
        state.bridgeLatestHash = fingerprint;
        return;
      }

      state.bridgeLatestHash = fingerprint;
      receiveBridgeExport({
        ...latest,
        text: payload.text,
      });
    } catch (error) {
      // Server might not be running yet. The next poll will try again.
    } finally {
      state.isCheckingBridge = false;
    }
  }

  function receiveBridgeExport(exportData) {
    if (!exportData || !exportData.text) return;

    if (state.isFetchingLogs) {
      state.pendingBridgeExport = exportData;
      setScoreLabel("Clipboard export queued");
      return;
    }

    applyBridgeExport(exportData);
  }

  function applyBridgeExport(exportData) {
    const raw = String(exportData.text || "").trim();
    if (!raw) return;

    elements.addonExport.value = raw;
    lastAutoImportedExport = raw;
    importAddonExport({ fetchLogs: true, automatic: true, source: "clipboard" });
  }

  function consumePendingBridgeExport() {
    if (!state.pendingBridgeExport || state.isFetchingLogs) return;

    const pending = state.pendingBridgeExport;
    state.pendingBridgeExport = null;
    applyBridgeExport(pending);
  }

  function scheduleAddonExportImport() {
    window.clearTimeout(addonImportTimer);
    addonImportTimer = window.setTimeout(() => {
      const raw = elements.addonExport.value.trim();
      const looksLikeExport = /\bRAA_EXPORT_V1\b|\[ROSTER\]|\[APPLICANTS\]/i.test(raw);
      if (!raw || !looksLikeExport || raw === lastAutoImportedExport) return;

      lastAutoImportedExport = raw;
      importAddonExport({ fetchLogs: true, automatic: true });
    }, 120);
  }

  function importAddonExport(options = {}) {
    const parsed = parseAddonExport(elements.addonExport.value);
    if (!parsed.roster.length && !parsed.applicants.length) {
      setScoreLabel("Paste addon export first");
      return;
    }

    if (parsed.roster.length) {
      elements.currentRoster.value = parsed.roster.join("\n");
    }

    if (parsed.applicants.length) {
      elements.applicants.value = parsed.applicants.join("\n");
    }

    const label = options.source === "clipboard" ? "Clipboard import" : "Imported";
    setScoreLabel(`${label}: ${parsed.roster.length} roster, ${parsed.applicants.length} applicants`);
    if (options.source === "clipboard") {
      showClipboardToast(parsed);
    }
    runAnalysis({ fetchLogs: options.fetchLogs !== false });
    return parsed;
  }

  async function runAnalysis(options) {
    if (state.isFetchingLogs) return;

    if (!options.fetchLogs) {
      state.logFetchMessage = null;
    }

    const target = readTarget();
    let roster = parsePeople(elements.currentRoster.value, "roster");
    let applicants = filterDeclinedApplicants(parsePeople(elements.applicants.value, "applicant"));
    const rerender = () => {
      const analysis = recommendApplicants({ target, roster, applicants });
      state.latestAnalysis = analysis;
      render(analysis);
    };

    if (!options.fetchLogs) {
      rerender();
      return;
    }

    state.isFetchingLogs = true;
    setFetchButtonLoading(true);
    setLogProgress("Checking Warcraft Logs connection");
    rerender();

    const health = await checkServer();
    if (!health || !health.hasWarcraftLogsCredentials) {
      setLogProgress("Warcraft Logs credentials not loaded");
      rerender();
      finishLogFetch();
      return;
    }

    if (!target.encounterId && !target.bossName) {
      setLogProgress("Enter a boss name or encounter ID");
      rerender();
      finishLogFetch();
      return;
    }

    roster = await enrichWithWarcraftLogs(roster, target, "roster", (person, index, current) => {
      roster = current;
      rerender();
    });
    applicants = await enrichWithWarcraftLogs(applicants, target, "applicants", (person, index, current) => {
      applicants = current;
      rerender();
    });

    const allPeople = [...roster, ...applicants];
    const fetched = allPeople.filter((person) => person.logStatus === "live").length;
    const cached = allPeople.filter((person) => person.cacheHit).length;
    const noData = allPeople.filter((person) => person.logStatus === "no-data").length;
    const errors = allPeople.filter((person) => person.logStatus === "error").length;
    setLogProgress(`Logs fetched: ${fetched} live${cached ? `, ${cached} cached` : ""}${noData ? `, ${noData} no data` : ""}${errors ? `, ${errors} errors` : ""}`);
    rerender();
    finishLogFetch();
  }

  function readTarget() {
    const difficulty = Number(elements.difficulty.value);
    const difficultyInfo = data.difficulties.find((item) => item.id === difficulty) || data.difficulties[0];
    const bossOption = elements.bossName && elements.bossName.selectedOptions && elements.bossName.selectedOptions[0];
    const bossName = bossOption
      ? bossOption.textContent.trim()
      : String(elements.bossName && elements.bossName.value || "").trim();
    const encounterId = Number(
      (bossOption && bossOption.dataset.encounterId)
      || (elements.encounterId && elements.encounterId.value)
    ) || null;

    return {
      bossName: bossName || "Selected boss",
      encounterId,
      difficulty,
      fallbackDifficulty: difficultyInfo.fallback,
      metric: elements.metric.value,
      weights: readScoreWeights(),
      roles: {
        Tank: clampNumber(elements.tankTarget.value, 0, 30),
        Healer: clampNumber(elements.healerTarget.value, 0, 30),
        DPS: clampNumber(elements.dpsTarget.value, 0, 30),
      },
    };
  }

  function readScoreWeights() {
    return {
      primaryWeight: clampNumberWithDefault(elements.scorePrimaryWeight, DEFAULT_SCORE_WEIGHTS.primaryWeight, 0, 2),
      fallbackWeight: clampNumberWithDefault(elements.scoreFallbackWeight, DEFAULT_SCORE_WEIGHTS.fallbackWeight, 0, 2),
      openRoleWeight: clampNumberWithDefault(elements.scoreOpenRoleWeight, DEFAULT_SCORE_WEIGHTS.openRoleWeight, -50, 100),
      roleUrgencyWeight: clampNumberWithDefault(elements.scoreRoleUrgencyWeight, DEFAULT_SCORE_WEIGHTS.roleUrgencyWeight, 0, 25),
      buffWeight: clampNumberWithDefault(elements.scoreBuffWeight, DEFAULT_SCORE_WEIGHTS.buffWeight, 0, 5),
      fullRolePenalty: clampNumberWithDefault(elements.scoreFullRolePenalty, DEFAULT_SCORE_WEIGHTS.fullRolePenalty, -100, 0),
      noDataPenalty: clampNumberWithDefault(elements.scoreNoDataPenalty, DEFAULT_SCORE_WEIGHTS.noDataPenalty, -100, 0),
      killBonus: clampNumberWithDefault(elements.scoreKillBonus, DEFAULT_SCORE_WEIGHTS.killBonus, 0, 10),
    };
  }

  async function enrichWithWarcraftLogs(people, target, label, onUpdate) {
    setLogProgress(`Fetching ${label || "logs"}`);
    const enriched = people.map((person) => ({
      ...person,
      logStatus: "pending",
      logError: null,
      cacheHit: false,
    }));
    if (onUpdate) onUpdate(null, -1, [...enriched]);

    for (let index = 0; index < people.length; index += 1) {
      const applicant = people[index];
      enriched[index] = {
        ...enriched[index],
        logStatus: "fetching",
        logError: null,
      };
      setLogProgress(`Fetching ${label || "logs"} ${index + 1}/${people.length}: ${applicant.name}`);
      if (onUpdate) onUpdate(enriched[index], index, [...enriched]);
      try {
        const response = await apiFetch("/api/warcraftlogs/rankings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applicant,
            target,
            fallbackDifficulty: target.fallbackDifficulty,
          }),
        });
        const rankings = await response.json();

        if (!response.ok) {
          throw new Error(rankings.error || "Warcraft Logs request failed.");
        }

        updateRateState(rankings.rateLimit, rankings.cache);
        const primaryParse = rankings.primary && rankings.primary.percentile;
        const fallbackParse = rankings.fallback && rankings.fallback.percentile;
        const mythicBestPerfAvg = firstPositiveNumber(
          rankings.zoneDifficulties && rankings.zoneDifficulties.mythic && rankings.zoneDifficulties.mythic.bestPerfAvg
        );
        const heroicBestPerfAvg = firstPositiveNumber(
          rankings.zoneDifficulties && rankings.zoneDifficulties.heroic && rankings.zoneDifficulties.heroic.bestPerfAvg
        );
        const hasLogValue = [primaryParse, fallbackParse, mythicBestPerfAvg, heroicBestPerfAvg]
          .some((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));

        const enrichedPerson = {
          ...applicant,
          className: applicant.className || (rankings.character && rankings.character.className) || "",
          specName: applicant.specName || (rankings.character && rankings.character.specName) || "",
          itemLevel: firstPositiveNumber(applicant.itemLevel, rankings.character && rankings.character.itemLevel),
          primaryParse,
          primaryKills: rankings.primary && rankings.primary.kills,
          fallbackParse,
          fallbackKills: rankings.fallback && rankings.fallback.kills,
          mythicBestPerfAvg,
          heroicBestPerfAvg,
          mythicKills: firstNumber(
            rankings.zoneDifficulties && rankings.zoneDifficulties.mythic && rankings.zoneDifficulties.mythic.kills,
            rankings.difficulties && rankings.difficulties.mythic && rankings.difficulties.mythic.kills
          ),
          heroicKills: firstNumber(
            rankings.zoneDifficulties && rankings.zoneDifficulties.heroic && rankings.zoneDifficulties.heroic.kills,
            rankings.difficulties && rankings.difficulties.heroic && rankings.difficulties.heroic.kills
          ),
          mythicProgress: raidProgression(rankings.zoneDifficulties && rankings.zoneDifficulties.mythic),
          heroicProgress: raidProgression(rankings.zoneDifficulties && rankings.zoneDifficulties.heroic),
          resolvedEncounterId: rankings.encounterId,
          resolvedZoneName: rankings.zone && rankings.zone.name,
          logStatus: hasLogValue ? "live" : "no-data",
          logError: hasLogValue ? null : rankingReason(rankings),
          cacheHit: Boolean(rankings.cache && rankings.cache.hit),
          cacheExpiresInSeconds: rankings.cache && rankings.cache.expiresInSeconds,
        };
        enriched[index] = enrichedPerson;
        setLogProgress(`Fetched ${label || "logs"} ${index + 1}/${people.length}: ${applicant.name}${enrichedPerson.cacheHit ? " (cached)" : ""}`);
        if (onUpdate) onUpdate(enrichedPerson, index, [...enriched]);
      } catch (error) {
        const enrichedPerson = {
          ...applicant,
          logStatus: "error",
          logError: error.message,
          cacheHit: false,
        };
        enriched[index] = enrichedPerson;
        setLogProgress(`Fetched ${label || "logs"} ${index + 1}/${people.length}: ${applicant.name} (error)`);
        if (onUpdate) onUpdate(enrichedPerson, index, [...enriched]);
      }
    }

    setLogProgress(`Fetched ${label || "logs"}: ${people.length}`);
    return enriched;
  }

  function setFetchButtonLoading(isLoading) {
    for (const button of [elements.fetchLogs, elements.fetchRosterLogs, elements.importAddonExport].filter(Boolean)) {
      button.disabled = isLoading;
      button.classList.toggle("is-loading", isLoading);
    }
  }

  function finishLogFetch() {
    state.isFetchingLogs = false;
    setFetchButtonLoading(false);
    window.setTimeout(consumePendingBridgeExport, 0);
  }

  function setLogProgress(message) {
    state.logFetchMessage = message;
    setScoreLabel(message);
  }

  function rankingReason(rankings) {
    const sources = [
      rankings.primary,
      rankings.fallback,
      rankings.zoneDifficulties && rankings.zoneDifficulties.mythic,
      rankings.zoneDifficulties && rankings.zoneDifficulties.heroic,
      rankings.difficulties && rankings.difficulties.mythic,
      rankings.difficulties && rankings.difficulties.heroic,
    ].filter(Boolean);

    const requestError = sources.find((source) => source.requestError && source.reason);
    if (requestError) return requestError.reason;

    const reason = sources.find((source) => source.reason);
    return reason ? reason.reason : "No public Warcraft Logs data for this raid.";
  }

  function raidProgression(zoneRanking) {
    const encounterIds = (data.encounters || [])
      .map((encounter) => String(encounter.id || ""))
      .filter(Boolean);
    if (!zoneRanking || !encounterIds.length) return null;

    const encounters = zoneRanking.encounters || {};
    const killed = encounterIds.reduce((count, encounterId) => {
      const encounter = encounters[encounterId];
      return count + (encounter && Number(encounter.kills) > 0 ? 1 : 0);
    }, 0);

    if (killed === 0 && !zoneRanking.exists) return null;
    return {
      killed,
      total: encounterIds.length,
    };
  }

  function parsePeople(raw, source) {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !isAddonExportMarker(line))
      .map((line, index) => parsePersonLine(line, index, source))
      .filter(Boolean);
  }

  function parseAddonExport(raw) {
    const sections = {
      roster: [],
      applicants: [],
    };
    let section = null;

    for (const line of raw.split(/\r?\n/).map((item) => item.trim())) {
      if (!line || line === "RAA_EXPORT_V1") continue;

      const normalized = line.toUpperCase();
      if (normalized === "[ROSTER]") {
        section = "roster";
        continue;
      }

      if (normalized === "[APPLICANTS]") {
        section = "applicants";
        continue;
      }

      if (!section || isAddonExportMarker(line) || !line.includes(",")) continue;
      sections[section].push(line);
    }

    return sections;
  }

  function isAddonExportMarker(line) {
    const normalized = String(line || "").trim().toUpperCase();
    return normalized === "RAA_EXPORT_V1" || normalized === "[ROSTER]" || normalized === "[APPLICANTS]";
  }

  function parsePersonLine(line, index, source) {
    const parts = line.split(",").map((part) => part.trim());
    const identity = parseIdentity(parts[0] || "");
    if (!identity.name) return null;

    return {
      id: `${source}-${index}-${identity.name}-${identity.realm}`,
      source,
      line,
      name: identity.name,
      realm: identity.realm,
      region: identity.region,
      role: normalizeRole(parts[1]),
      className: normalizeClass(parts[2]),
      specName: parts[3] || "",
      primaryParse: parsePercentile(parts[4]),
      fallbackParse: parsePercentile(parts[5]),
      primaryKills: parseCount(parts[6]),
      fallbackKills: parseCount(parts[7]),
      mythicBestPerfAvg: parsePercentile(parts[8]),
      heroicBestPerfAvg: parsePercentile(parts[9]),
      itemLevel: parseItemLevel(parts[10]),
      applicationNote: normalizeApplicationNote(parts.slice(11).join(",")),
      logStatus: "manual",
    };
  }

  function parseIdentity(raw) {
    const pieces = raw.split("-").map((piece) => piece.trim()).filter(Boolean);
    const regionCandidate = pieces[pieces.length - 1];
    const hasRegion = /^(us|eu|kr|tw|cn)$/i.test(regionCandidate);
    const region = hasRegion ? regionCandidate.toUpperCase() : "US";
    const name = pieces[0] || "";
    const realmPieces = pieces.slice(1, hasRegion ? -1 : undefined);

    return {
      name,
      realm: realmPieces.join("-") || "area-52",
      region,
    };
  }

  function recommendApplicants({ target, roster, applicants }) {
    const selected = [];
    const remaining = [...applicants];
    const startingCounts = countRoles(roster);
    const startingBuffs = coveredBuffs(roster);
    const targetTotal = sumRoles(target.roles);

    while (currentTotal(roster, selected) < targetTotal) {
      const counts = addRoleCounts(startingCounts, countRoles(selected));
      const neededRoles = rolesWithOpenSlots(target.roles, counts);
      if (neededRoles.length === 0) break;

      const scored = remaining
        .filter((applicant) => neededRoles.includes(applicant.role))
        .map((applicant) => scoreApplicant(applicant, {
          target,
          roster,
          selected,
          currentBuffs: coveredBuffs([...roster, ...selected]),
          counts,
        }))
        .sort((a, b) => b.total - a.total);

      if (!scored.length) break;

      const winner = scored[0];
      selected.push(winner.applicant);
      const index = remaining.findIndex((applicant) => applicant.id === winner.applicant.id);
      remaining.splice(index, 1);
    }

    const selectedOrderById = new Map(selected.map((applicant, order) => [applicant.id, order + 1]));
    const selectedRoleCounts = countRoles(selected);
    const openSlotsByRole = openSlotsForRoles(target.roles, startingCounts);
    const allScores = applicants
      .map((applicant) => scoreApplicant(applicant, {
        target,
        roster,
        selected,
        currentBuffs: startingBuffs,
        counts: startingCounts,
      }))
      .sort((a, b) => b.total - a.total)
      .map((score, index) => ({
        ...score,
        rank: index + 1,
        isPick: selectedOrderById.has(score.applicant.id),
        pickOrder: selectedOrderById.get(score.applicant.id) || null,
        inviteNote: inviteNoteForScore(score, {
          selectedOrderById,
          selectedRoleCounts,
          openSlotsByRole,
        }),
      }));

    const selectedScores = selected.map((applicant, order) => ({
      ...allScores.find((score) => score.applicant.id === applicant.id),
      order: order + 1,
    }));

    const finalRoster = [...roster, ...selected];

    return {
      target,
      roster,
      applicants,
      selected,
      selectedScores,
      allScores,
      currentRoleCounts: startingCounts,
      selectedRoleCounts,
      roleCounts: countRoles(finalRoster),
      coveredBuffs: coveredBuffs(finalRoster),
      missingBuffs: missingBuffs(finalRoster),
    };
  }

  function openSlotsForRoles(targetRoles, counts) {
    return Object.keys(targetRoles).reduce((slots, role) => {
      slots[role] = Math.max(0, (targetRoles[role] || 0) - (counts[role] || 0));
      return slots;
    }, {});
  }

  function inviteNoteForScore(score, context) {
    const applicant = score.applicant;
    if (context.selectedOrderById.has(applicant.id)) return "";

    const openSlots = context.openSlotsByRole[applicant.role] || 0;
    if (openSlots <= 0) {
      return `${applicant.role.toLowerCase()} slot already full`;
    }

    const pickedForRole = context.selectedRoleCounts[applicant.role] || 0;
    if (pickedForRole >= openSlots) {
      return `${applicant.role.toLowerCase()} slot filled by higher invite pick`;
    }

    return "";
  }

  function scoreApplicant(applicant, context) {
    const parse = parseScore(applicant, context.target.weights);
    const role = roleScore(applicant, context);
    const buffs = buffScore(applicant, context.currentBuffs, context.target.weights);
    const total = Math.round(parse.points + role.points + buffs.points);

    return {
      applicant,
      total,
      parse,
      role,
      buffs,
      reasons: [...role.reasons, ...buffs.reasons, ...parse.reasons],
      warnings: parse.warnings,
    };
  }

  function parseScore(applicant, weights = DEFAULT_SCORE_WEIGHTS) {
    const primary = applicant.primaryParse;
    const fallback = applicant.fallbackParse;
    const reasons = [];
    const warnings = [];

    if (primary !== null) {
      const points = 10 + primary * weights.primaryWeight + Math.min(applicant.primaryKills || 0, 5) * weights.killBonus;
      if (primary >= 80) reasons.push(`strong selected-difficulty parse (${Math.round(primary)})`);
      else if (primary >= 50) reasons.push(`solid selected-difficulty parse (${Math.round(primary)})`);
      else {
        reasons.push(`selected-difficulty experience (${Math.round(primary)})`);
        warnings.push("low selected-difficulty parse");
      }

      return { points, reasons, warnings, source: "primary" };
    }

    if (fallback !== null) {
      const points = -6 + fallback * weights.fallbackWeight + Math.min(applicant.fallbackKills || 0, 4) * weights.killBonus;
      if (fallback >= 85) reasons.push(`excellent easier-difficulty fallback (${Math.round(fallback)})`);
      else if (fallback >= 60) reasons.push(`usable easier-difficulty fallback (${Math.round(fallback)})`);
      else {
        reasons.push(`thin easier-difficulty fallback (${Math.round(fallback)})`);
        warnings.push("no selected-difficulty kill");
      }

      return { points, reasons, warnings, source: "fallback" };
    }

    warnings.push("no relevant parse found");
    return {
      points: weights.noDataPenalty,
      reasons: ["no selected or fallback parse"],
      warnings,
      source: "none",
    };
  }

  function roleScore(applicant, context) {
    const weights = context.target.weights || DEFAULT_SCORE_WEIGHTS;
    const current = context.counts[applicant.role] || 0;
    const target = context.target.roles[applicant.role] || 0;
    const missing = Math.max(0, target - current);

    if (missing > 0) {
      return {
        points: weights.openRoleWeight + Math.min(missing, 3) * weights.roleUrgencyWeight,
        reasons: [`fills ${applicant.role.toLowerCase()} slot`],
      };
    }

    return {
      points: weights.fullRolePenalty,
      reasons: [`${applicant.role.toLowerCase()} slot full`],
    };
  }

  function buffScore(applicant, currentBuffs, weights = DEFAULT_SCORE_WEIGHTS) {
    const provided = buffsFor(applicant);
    const missing = provided.filter((buff) => !currentBuffs.has(buff.id));
    const points = missing.reduce((sum, buff) => sum + buff.weight, 0) * weights.buffWeight;
    const reasons = missing.map((buff) => `adds ${buff.name}`);
    return { points, reasons, provided, missing };
  }

  function buffsFor(person) {
    return data.buffs.filter((buff) => buff.providers.some((provider) => {
      const classMatches = sameText(provider.className, person.className);
      const specMatches = !provider.specName || sameText(provider.specName, person.specName);
      return classMatches && specMatches;
    }));
  }

  function coveredBuffs(people) {
    const covered = new Set();
    for (const person of people) {
      for (const buff of buffsFor(person)) {
        covered.add(buff.id);
      }
    }
    return covered;
  }

  function missingBuffs(people) {
    const covered = coveredBuffs(people);
    return data.buffs.filter((buff) => !covered.has(buff.id));
  }

  function countRoles(people) {
    return people.reduce((counts, person) => {
      counts[person.role] = (counts[person.role] || 0) + 1;
      return counts;
    }, { Tank: 0, Healer: 0, DPS: 0 });
  }

  function addRoleCounts(left, right) {
    return {
      Tank: (left.Tank || 0) + (right.Tank || 0),
      Healer: (left.Healer || 0) + (right.Healer || 0),
      DPS: (left.DPS || 0) + (right.DPS || 0),
    };
  }

  function rolesWithOpenSlots(targetRoles, counts) {
    return Object.keys(targetRoles).filter((role) => (counts[role] || 0) < targetRoles[role]);
  }

  function currentTotal(roster, selected) {
    return roster.length + selected.length;
  }

  function sumRoles(roles) {
    return Object.values(roles).reduce((sum, count) => sum + count, 0);
  }

  function roleCountLine(counts) {
    return `${counts.Tank || 0}-${counts.Healer || 0}-${counts.DPS || 0}`;
  }

  function render(analysis) {
    updateDeclinedUi();
    renderRecommendations(analysis);
    renderComposition(analysis);
    renderBuffs(analysis);
    renderScores(analysis);
    renderRosterStats(analysis);
  }

  function populateInviteClassFilter() {
    if (!elements.inviteFilterClass) return;

    const classes = [
      "Death Knight",
      "Demon Hunter",
      "Druid",
      "Evoker",
      "Hunter",
      "Mage",
      "Monk",
      "Paladin",
      "Priest",
      "Rogue",
      "Shaman",
      "Warlock",
      "Warrior",
    ];

    for (const className of classes) {
      const option = document.createElement("option");
      option.value = className;
      option.textContent = className;
      elements.inviteFilterClass.append(option);
    }
  }

  function filteredApplicantScores(analysis) {
    const scores = analysis.allScores || [];
    const search = String(elements.inviteFilterSearch && elements.inviteFilterSearch.value || "").trim().toLowerCase();
    const role = String(elements.inviteFilterRole && elements.inviteFilterRole.value || "").trim();
    const className = String(elements.inviteFilterClass && elements.inviteFilterClass.value || "").trim();
    const minIlvl = parseItemLevel(elements.inviteFilterMinIlvl && elements.inviteFilterMinIlvl.value);
    const hideFilled = Boolean(elements.inviteFilterFilled && elements.inviteFilterFilled.checked);
    const openRoles = new Set(rolesWithOpenSlots(
      analysis.target.roles,
      analysis.currentRoleCounts || countRoles(analysis.roster)
    ));

    return scores.filter((score) => {
      const applicant = score.applicant;
      const matchesSearch = !search || [
        applicant.name,
        applicant.realm,
        applicant.specName,
        applicant.className,
        applicant.role,
        applicant.itemLevel,
      ].some((value) => String(value || "").toLowerCase().includes(search));

      const matchesRole = !role || applicant.role === role;
      const matchesClass = !className || applicant.className === className;
      const matchesIlvl = minIlvl === null || (applicant.itemLevel !== null && applicant.itemLevel >= minIlvl);
      const matchesFilled = !hideFilled || openRoles.has(applicant.role);

      return matchesSearch && matchesRole && matchesClass && matchesIlvl && matchesFilled;
    });
  }

  function renderRecommendations(analysis) {
    elements.recommendationsList.innerHTML = "";

    const filteredScores = filteredApplicantScores(analysis);
    const pickLabel = analysis.selected.length === 1 ? "1 invite pick" : `${analysis.selected.length} invite picks`;
    elements.selectionCount.textContent = `${filteredScores.length}/${analysis.allScores.length} shown - ${pickLabel}`;

    if (!filteredScores.length) {
      elements.recommendationsList.append(emptyState("No matching applicants"));
      return;
    }

    for (const score of filteredScores) {
      const logsUrl = warcraftLogsUrl(score.applicant);
      const applicantClass = classColorClass(score.applicant.className);
      const declineKey = applicantKey(score.applicant);
      const row = document.createElement("article");
      row.className = `recommendation-card ${applicantClass}${score.isPick ? " is-pick" : ""}`;
      row.innerHTML = `
        <div class="rank" title="Overall score rank"><span>Rank</span><strong>${score.rank}</strong></div>
        <div class="candidate-main">
          <div class="candidate-line">
            <a class="logs-link class-text ${applicantClass}" href="${escapeAttribute(logsUrl)}" target="_blank" rel="noopener noreferrer" title="Open Warcraft Logs">
              <strong>${escapeHtml(score.applicant.name)}</strong>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14zM5 5h6v2H7v10h10v-4h2v6H5z"/></svg>
            </a>
            <span>${escapeHtml(score.applicant.realm)}-${escapeHtml(score.applicant.region)}</span>
            <span class="ilvl-chip ${score.applicant.itemLevel === null ? "is-empty" : ""}"><strong>ilvl</strong>${formatIlvl(score.applicant.itemLevel)}</span>
            ${score.isPick ? `<span class="pick-chip">Invite pick #${score.pickOrder}</span>` : ""}
            <button class="decline-button" type="button" data-decline-key="${escapeAttribute(declineKey)}" data-decline-name="${escapeAttribute(score.applicant.name)}" title="Hide this applicant for the current browser session">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"/></svg>
              Decline
            </button>
          </div>
          <div class="candidate-meta"><span class="class-text ${applicantClass}">${escapeHtml(score.applicant.specName)} ${escapeHtml(score.applicant.className)}</span> - ${escapeHtml(score.applicant.role)}</div>
          ${progressionStrip(score.applicant)}
          ${perfStrip(score, analysis.target)}
          ${applicationNoteBlock(score.applicant)}
          <div class="reason-list">${displayReasons(score).slice(0, 4).map(reasonChip).join("")}</div>
        </div>
        <div class="score-badge">${score.total}</div>
      `;
      elements.recommendationsList.append(row);
    }
  }

  function displayReasons(score) {
    if (!score.inviteNote) return score.reasons;

    return [
      score.inviteNote,
      ...score.reasons.filter((reason) => !/^fills .+ slot$/i.test(reason)),
    ];
  }

  function renderComposition(analysis) {
    const roles = ["Tank", "Healer", "DPS"];
    elements.roleMeters.innerHTML = "";
    elements.raidVisual.innerHTML = "";

    const target = analysis.target.roles;
    const counts = analysis.roleCounts;
    const currentCounts = analysis.currentRoleCounts || countRoles(analysis.roster);
    const selectedCounts = analysis.selectedRoleCounts || countRoles(analysis.selected);
    elements.compLabel.textContent = `Projected ${target.Tank}-${target.Healer}-${target.DPS}`;

    const summary = document.createElement("div");
    summary.className = "composition-summary";
    summary.innerHTML = `
      <span><strong>Current</strong>${roleCountLine(currentCounts)}</span>
      <span><strong>Adds</strong>${roleCountLine(selectedCounts)}</span>
      <span><strong>Projected</strong>${roleCountLine(counts)}</span>
    `;
    elements.roleMeters.append(summary);

    for (const role of roles) {
      const current = counts[role] || 0;
      const rosterCount = currentCounts[role] || 0;
      const selectedCount = selectedCounts[role] || 0;
      const wanted = target[role] || 0;
      const ratio = wanted ? Math.min(100, Math.round((current / wanted) * 100)) : 100;

      const meter = document.createElement("div");
      meter.className = "role-meter";
      meter.innerHTML = `
        <div class="meter-label">
          <span>${role}</span>
          <span><strong>${current}/${wanted}</strong><small>${rosterCount} current + ${selectedCount} picks</small></span>
        </div>
        <div class="meter-track"><span style="width:${ratio}%"></span></div>
      `;
      elements.roleMeters.append(meter);
    }

    const groupedPeople = groupRaidVisualPeople(analysis);
    for (const role of roles) {
      const section = document.createElement("section");
      section.className = `raid-role-section ${roleClass(role)}`;

      const header = document.createElement("div");
      header.className = "raid-role-header";
      header.innerHTML = `
        <span>${role}</span>
        <small>${groupedPeople[role].length}/${target[role] || 0}</small>
      `;
      section.append(header);

      const grid = document.createElement("div");
      grid.className = `raid-role-grid ${roleClass(role)}`;

      const slots = groupedPeople[role];
      const totalSlots = target[role] || 0;
      for (let index = 0; index < totalSlots; index += 1) {
        const entry = slots[index];
        const person = entry && entry.person;
        const personClass = person ? classColorClass(person.className) : "";
        const slot = document.createElement("div");
        slot.className = person
          ? `raid-slot ${roleClass(person.role)} ${personClass} ${entry.isSelected ? "suggested" : "current"}`
          : `raid-slot ${roleClass(role)} empty`;

        if (person) {
          const specLabel = person.specName ? `${person.specName} ` : "";
          slot.title = `${entry.isSelected ? "Recommended" : "Roster"}: ${person.name} - ${specLabel}${person.className} (${person.role})`;
          slot.innerHTML = `
            <span class="raid-slot-name class-text ${personClass}">${escapeHtml(person.name)}</span>
            <span class="raid-slot-meta">${escapeHtml(specLabel + person.className)}</span>
          `;
        } else {
          slot.title = `Open ${role} slot`;
          slot.innerHTML = `
            <span class="raid-slot-name">Open</span>
            <span class="raid-slot-meta">${escapeHtml(role)}</span>
          `;
        }

        grid.append(slot);
      }

      section.append(grid);
      elements.raidVisual.append(section);
    }
  }

  function renderBuffs(analysis) {
    elements.buffList.innerHTML = "";
    const covered = analysis.coveredBuffs;
    const buffPeople = [...analysis.roster, ...analysis.selected];
    const selectedIds = new Set(analysis.selected.map((person) => person.id));
    elements.coverageLabel.textContent = `${covered.size}/${data.buffs.length} covered`;

    for (const buff of data.buffs) {
      const item = document.createElement("div");
      const isCovered = covered.has(buff.id);
      const providers = buffPeople.filter((person) => buffsFor(person).some((personBuff) => personBuff.id === buff.id));
      const providerChips = isCovered
        ? providers.map((person) => personProviderChip(person, selectedIds.has(person.id))).join("")
        : buff.providers.map(providerClassChip).join("");
      item.className = isCovered ? "buff-item covered" : "buff-item missing";
      item.innerHTML = `
        <span class="buff-status"></span>
        <div class="buff-main">
          <div class="buff-title">
            <span>${escapeHtml(buff.name)}</span>
            <small>${isCovered ? "covered" : `+${buff.weight}`}</small>
          </div>
          <div class="buff-providers">${providerChips}</div>
        </div>
      `;
      elements.buffList.append(item);
    }
  }

  function renderScores(analysis) {
    setScoreLabel(state.logFetchMessage || `${analysis.allScores.length} applicants`);
  }

  function handleRosterSortClick(event) {
    const button = event.target.closest("[data-roster-sort]");
    if (!button) return;

    const key = button.dataset.rosterSort;
    const current = state.rosterSort;
    state.rosterSort = {
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    };

    if (state.latestAnalysis) renderRosterStats(state.latestAnalysis);
  }

  function renderRosterStats(analysis) {
    elements.rosterStats.innerHTML = "";
    const rosterSummary = summarizeLogResults(analysis.roster, `${analysis.roster.length} members`);
    const shouldShowProgress = state.isFetchingLogs && !hasResolvedLogResults(analysis.roster);
    const ilvlSummary = averageIlvlLabel(analysis.roster);
    elements.rosterStatsLabel.textContent = shouldShowProgress
      ? (state.logFetchMessage || rosterSummary)
      : [rosterSummary, ilvlSummary].filter(Boolean).join(" - ");

    const header = document.createElement("div");
    header.className = "member-row member-header";
    header.innerHTML = `
      <div>${rosterSortButton("name", "Member")}</div>
      <div>${rosterSortButton("role", "Role")}</div>
      <div>${rosterSortButton("itemLevel", "Ilvl")}</div>
      <div>${rosterSortButton("progress", "Progress")}</div>
      <div>${rosterSortButton("mythicAvg", "Mythic Avg")}</div>
      <div>${rosterSortButton("heroicAvg", "Heroic Avg")}</div>
      <div title="Selected boss at the selected difficulty">${rosterSortButton("target", "Target")}</div>
      <div title="Selected boss at the fallback difficulty">${rosterSortButton("fallback", "Fallback")}</div>
      <div>${rosterSortButton("status", "Status")}</div>
    `;
    elements.rosterStats.append(header);

    const rosterIssues = renderRosterIssues(analysis.roster);
    if (rosterIssues) {
      elements.rosterStats.append(rosterIssues);
    }

    if (!analysis.roster.length) {
      elements.rosterStats.append(emptyState("No roster pasted"));
      return;
    }

    for (const member of sortedRosterMembers(analysis)) {
      const logsUrl = warcraftLogsUrl(member);
      const memberClass = classColorClass(member.className);
      const row = document.createElement("div");
      row.className = `member-row ${memberClass}`;
      row.innerHTML = `
        <div>
          <a class="logs-link compact class-text ${memberClass}" href="${escapeAttribute(logsUrl)}" target="_blank" rel="noopener noreferrer" title="Open Warcraft Logs">
            <strong>${escapeHtml(member.name)}</strong>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14zM5 5h6v2H7v10h10v-4h2v6H5z"/></svg>
          </a>
          <span class="class-text ${memberClass}">${escapeHtml(member.specName)} ${escapeHtml(member.className)}</span>
        </div>
        <div>${escapeHtml(member.role)}</div>
        <div>${formatIlvl(member.itemLevel)}</div>
        <div>${progressionLabel(member)}</div>
        <div>${parseCell(bestPerfForDifficulty(member, analysis.target, 5), { average: true })}</div>
        <div>${parseCell(bestPerfForDifficulty(member, analysis.target, 4), { average: true })}</div>
        <div>${parseCell(member.primaryParse)}</div>
        <div>${parseCell(member.fallbackParse)}</div>
        <div>${rosterLogStatus(member)}</div>
      `;
      elements.rosterStats.append(row);
    }
  }

  function rosterSortButton(key, label) {
    const isActive = state.rosterSort.key === key;
    const direction = isActive ? state.rosterSort.direction : "";
    const suffix = isActive ? `<span>${direction}</span>` : "";
    return `<button class="sort-button${isActive ? " is-active" : ""}" type="button" data-roster-sort="${escapeAttribute(key)}">${escapeHtml(label)}${suffix}</button>`;
  }

  function sortedRosterMembers(analysis) {
    const sort = state.rosterSort;
    return analysis.roster
      .map((member, index) => ({ member, index }))
      .sort((left, right) => {
        const comparison = compareRosterValues(
          rosterSortValue(left.member, sort.key, analysis),
          rosterSortValue(right.member, sort.key, analysis),
          sort.direction
        );
        if (comparison !== 0) return comparison;
        return left.index - right.index;
      })
      .map((entry) => entry.member);
  }

  function rosterSortValue(member, key, analysis) {
    if (key === "role") return member.role || "";
    if (key === "itemLevel") return member.itemLevel;
    if (key === "progress") return progressionSortValue(member);
    if (key === "mythicAvg") return bestPerfForDifficulty(member, analysis.target, 5);
    if (key === "heroicAvg") return bestPerfForDifficulty(member, analysis.target, 4);
    if (key === "target") return member.primaryParse;
    if (key === "fallback") return member.fallbackParse;
    if (key === "status") return logStatusSortValue(member);
    return `${member.name || ""} ${member.realm || ""}`;
  }

  function compareRosterValues(left, right, direction) {
    const leftMissing = left === null || left === undefined || left === "";
    const rightMissing = right === null || right === undefined || right === "";
    if (leftMissing && rightMissing) return 0;
    if (leftMissing) return 1;
    if (rightMissing) return -1;

    const leftNumber = Number(left);
    const rightNumber = Number(right);
    const multiplier = direction === "asc" ? 1 : -1;
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return (leftNumber - rightNumber) * multiplier;
    }

    return String(left).localeCompare(String(right), undefined, {
      numeric: true,
      sensitivity: "base",
    }) * multiplier;
  }

  function logStatusSortValue(member) {
    const order = {
      live: 1,
      manual: 2,
      pending: 3,
      fetching: 4,
      "no-data": 5,
      error: 6,
    };
    return order[member.logStatus] || 7;
  }

  function progressionSortValue(person) {
    const mythic = person.mythicProgress && Number(person.mythicProgress.killed);
    const heroic = person.heroicProgress && Number(person.heroicProgress.killed);
    return (Number.isFinite(mythic) ? mythic * 100 : 0) + (Number.isFinite(heroic) ? heroic : 0);
  }

  function averageIlvlLabel(people) {
    const itemLevels = people
      .map((person) => person.itemLevel)
      .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
    if (!itemLevels.length) return "";

    const averageItemLevel = itemLevels.reduce((sum, value) => sum + Number(value), 0) / itemLevels.length;
    return `${formatIlvl(averageItemLevel)} avg ilvl`;
  }

  function summarizeLogResults(people, fallbackLabel) {
    if (!people.length) return fallbackLabel;

    const fetched = people.filter((person) => person.logStatus === "live").length;
    const cached = people.filter((person) => person.cacheHit).length;
    const noData = people.filter((person) => person.logStatus === "no-data").length;
    const errors = people.filter((person) => person.logStatus === "error").length;
    const fetching = people.filter((person) => person.logStatus === "fetching").length;
    const queued = people.filter((person) => person.logStatus === "pending").length;

    if (!fetched && !cached && !noData && !errors && !fetching && !queued) {
      return fallbackLabel;
    }

    if (fetching || queued) {
      return `${fetched} live${cached ? `, ${cached} cached` : ""}${noData ? `, ${noData} no data` : ""}${errors ? `, ${errors} errors` : ""}${fetching ? `, ${fetching} fetching` : ""}${queued ? `, ${queued} queued` : ""}`;
    }

    return `${fetched} live${cached ? `, ${cached} cached` : ""}${noData ? `, ${noData} no data` : ""}${errors ? `, ${errors} errors` : ""}`;
  }

  function hasResolvedLogResults(people) {
    return people.some((person) => ["live", "no-data", "error"].includes(person.logStatus));
  }

  function renderRosterIssues(people) {
    const noDataNames = people.filter((person) => person.logStatus === "no-data").map((person) => person.name);
    const errorNames = people.filter((person) => person.logStatus === "error").map((person) => person.name);
    if (!noDataNames.length && !errorNames.length) return null;

    const banner = document.createElement("div");
    banner.className = "member-issue-banner";
    banner.innerHTML = [
      noDataNames.length ? `<span class="status-chip warn">No data: ${escapeHtml(formatNameList(noDataNames))}</span>` : "",
      errorNames.length ? `<span class="status-chip error">Errors: ${escapeHtml(formatNameList(errorNames))}</span>` : "",
    ].filter(Boolean).join("");
    return banner;
  }

  function formatNameList(names) {
    if (!names.length) return "";
    if (names.length <= 3) return names.join(", ");
    return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
  }

  function setScoreLabel(value) {
    if (!elements.scoreLabel) return;
    elements.scoreLabel.textContent = value;
  }

  function reasonChip(reason) {
    return `<span class="reason-chip">${escapeHtml(reason)}</span>`;
  }

  function applicationNoteBlock(applicant) {
    const note = normalizeApplicationNote(applicant.applicationNote);
    if (!note) return "";
    return `
      <div class="application-note">
        <strong>Note</strong>
        <span>${escapeHtml(note)}</span>
      </div>
    `;
  }

  function progressionStrip(applicant) {
    const label = progressionLabel(applicant);
    if (label === "-") return "";

    return `<div class="progression-strip">${progressionChips(applicant)}</div>`;
  }

  function progressionChips(person) {
    return [
      progressionChip(person.mythicProgress, "M"),
      progressionChip(person.heroicProgress, "H"),
    ].filter(Boolean).join("");
  }

  function progressionChip(progress, label) {
    if (!progress || !progress.total) return "";
    return `<span class="progress-chip ${label === "M" ? "mythic" : "heroic"}">${progress.killed}/${progress.total}${label}</span>`;
  }

  function progressionLabel(person) {
    const label = progressionChips(person);
    return label || "-";
  }

  function personProviderChip(person, isSelected) {
    const className = classColorClass(person.className);
    const specLabel = person.specName ? `${person.specName} ` : "";
    const title = `${person.name} - ${specLabel}${person.className}${isSelected ? " (best pick)" : ""}`;
    return `<span class="class-chip ${className}${isSelected ? " is-selected" : ""}" title="${escapeAttribute(title)}">${escapeHtml(person.name)}</span>`;
  }

  function providerClassChip(provider) {
    const className = classColorClass(provider.className);
    const specLabel = provider.specName ? `${provider.specName} ` : "";
    const label = `${specLabel}${provider.className}`;
    return `<span class="class-chip ${className} is-option">${escapeHtml(label)}</span>`;
  }

  function perfStrip(score, target) {
    const applicant = score.applicant;
    return `
      <div class="perf-strip" aria-label="Score detail">
        <span><strong>Mythic Avg</strong>${parseCell(bestPerfForDifficulty(applicant, target, 5), { average: true })}</span>
        <span><strong>Heroic Avg</strong>${parseCell(bestPerfForDifficulty(applicant, target, 4), { average: true })}</span>
        <span><strong>Target</strong>${parseCell(applicant.primaryParse)}</span>
        <span><strong>Fallback</strong>${parseCell(applicant.fallbackParse)}</span>
        <span title="${escapeAttribute(parseSourceLabel(score.parse.source))}"><strong>Parse</strong>${formatPoints(score.parse.points)}</span>
        <span><strong>Role</strong>${formatPoints(score.role.points)}</span>
        <span><strong>Buff</strong>${formatPoints(score.buffs.points)}</span>
      </div>
    `;
  }

  function formatPoints(value) {
    const rounded = Math.round(Number(value) || 0);
    return rounded > 0 ? `+${rounded}` : String(rounded);
  }

  function formatIlvl(value) {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "-";
    return number % 1 === 0 ? String(number) : number.toFixed(1);
  }

  function parseSourceLabel(source) {
    if (source === "primary") return "Using the selected boss and difficulty";
    if (source === "fallback") return "Using fallback difficulty for this boss";
    return "No selected or fallback parse found";
  }

  function bestPerfForDifficulty(applicant, target, difficulty) {
    if (difficulty === 5 && applicant.mythicBestPerfAvg !== null && applicant.mythicBestPerfAvg !== undefined) {
      return applicant.mythicBestPerfAvg;
    }

    if (difficulty === 4 && applicant.heroicBestPerfAvg !== null && applicant.heroicBestPerfAvg !== undefined) {
      return applicant.heroicBestPerfAvg;
    }

    if (target.difficulty === difficulty) {
      return applicant.primaryParse;
    }

    if (target.fallbackDifficulty === difficulty) {
      return applicant.fallbackParse;
    }

    return null;
  }

  function rosterLogStatus(member) {
    if (member.logStatus === "live") {
      const label = member.cacheHit ? "Cached" : member.resolvedZoneName || "Live";
      const title = member.cacheHit ? `Cached result${member.cacheExpiresInSeconds ? `, expires in ${formatDuration(member.cacheExpiresInSeconds)}` : ""}` : member.resolvedZoneName || "Live Warcraft Logs result";
      return `<span class="status-chip ok" title="${escapeAttribute(title)}">${escapeHtml(label)}</span>`;
    }

    if (member.logStatus === "error") {
      const message = shortError(member.logError || "Warcraft Logs error");
      return `<span class="status-chip error" title="${escapeAttribute(member.logError || "Warcraft Logs error")}">${escapeHtml(message)}</span>`;
    }

    if (member.logStatus === "no-data") {
      const message = shortError(member.logError || "No public data");
      return `<span class="status-chip warn" title="${escapeAttribute(member.logError || "No public Warcraft Logs data found")}">${escapeHtml(message)}</span>`;
    }

    if (member.logStatus === "fetching") {
      return `<span class="status-chip fetching">Fetching</span>`;
    }

    if (member.logStatus === "pending") {
      return `<span class="status-chip">Queued</span>`;
    }

    return `<span class="status-chip">Not fetched</span>`;
  }

  function shortError(message) {
    const normalized = String(message || "").replace(/^Warcraft Logs GraphQL error:\s*/i, "").trim();
    if (/no public warcraft logs data/i.test(normalized)) return "No data";
    if (/character.*not found|not found/i.test(normalized)) return "Not found";
    if (/missing/i.test(normalized)) return "Missing data";
    if (/rate/i.test(normalized)) return "Rate limit";
    return normalized.length > 24 ? `${normalized.slice(0, 21)}...` : normalized;
  }

  function emptyState(text) {
    const element = document.createElement("div");
    element.className = "empty-state";
    element.textContent = text;
    return element;
  }

  function formatParse(value, options = {}) {
    if (value === null || value === undefined) return "-";
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    if (options.average) return number.toFixed(1);
    return String(Math.floor(number));
  }

  function parseCell(value, options = {}) {
    return `<span class="parse-value ${parseClass(value)}">${escapeHtml(formatParse(value, options))}</span>`;
  }

  function parseClass(value) {
    if (value === null || value === undefined || value === "") return "parse-none";
    const number = Number(value);
    if (!Number.isFinite(number)) return "parse-none";
    const rounded = Math.floor(number);
    if (rounded >= 100) return "parse-gold";
    if (rounded >= 99) return "parse-pink";
    if (rounded >= 95) return "parse-orange";
    if (rounded >= 75) return "parse-purple";
    if (rounded >= 50) return "parse-blue";
    if (rounded >= 25) return "parse-green";
    return "parse-gray";
  }

  function normalizeRole(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "tank") return "Tank";
    if (normalized === "healer" || normalized === "heal") return "Healer";
    return "DPS";
  }

  function normalizeClass(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function parsePercentile(value) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.max(0, Math.min(100, number));
  }

  function parseCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function parseItemLevel(value) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function normalizeApplicationNote(value) {
    return String(value || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function firstNumber(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === "") continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }

    return null;
  }

  function firstPositiveNumber(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === "") continue;
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }

    return null;
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function clampNumberWithDefault(input, fallback, min, max) {
    const value = input && "value" in input ? input.value : input;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function sameText(left, right) {
    return String(left || "").toLowerCase() === String(right || "").toLowerCase();
  }

  function groupRaidVisualPeople(analysis) {
    const grouped = {
      Tank: [],
      Healer: [],
      DPS: [],
    };

    for (const person of analysis.roster) {
      grouped[person.role].push({ person, isSelected: false });
    }

    for (const person of analysis.selected) {
      grouped[person.role].push({ person, isSelected: true });
    }

    return grouped;
  }

  function roleClass(role) {
    if (role === "Tank") return "tank";
    if (role === "Healer") return "healer";
    return "dps";
  }

  function classColorClass(className) {
    const slug = String(className || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return slug ? `class-${slug}` : "class-unknown";
  }

  function initials(name) {
    return String(name || "?").slice(0, 2).toUpperCase();
  }

  function warcraftLogsUrl(applicant) {
    const region = encodeURIComponent(String(applicant.region || "US").toUpperCase());
    const realm = encodeURIComponent(warcraftLogsRealmSlug(applicant.realm));
    const name = encodeURIComponent(String(applicant.name || "").trim());
    return `https://www.warcraftlogs.com/character/${region}/${realm}/${name}`;
  }

  function warcraftLogsRealmSlug(realm) {
    const slug = String(realm || "")
      .trim()
      .toLowerCase()
      .replace(/['.]/g, "")
      .replace(/\s+/g, "-");

    if (slug === "area52") return "area-52";
    return slug;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }
})();
