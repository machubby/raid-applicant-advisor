const http = require("node:http");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 4177);
const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";
const GRAPHQL_URL = "https://www.warcraftlogs.com/api/v2/client";
const RAIDERIO_CHARACTER_URL = "https://raider.io/api/v1/characters/profile";
const RANKING_CACHE_TTL_MS = 60 * 60 * 1000;

loadDotEnv(path.join(ROOT, ".env"));

let cachedToken = null;
const zoneByEncounter = new Map();
let cachedWorldZones = null;
const characterMetadataCache = new Map();
const rankingResultCache = new Map();
const cacheStats = { hits: 0, misses: 0 };
let latestRateLimit = null;
const clipboardBridge = createClipboardBridgeState();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      setCorsHeaders(res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        hasWarcraftLogsCredentials: hasWarcraftLogsCredentials(),
        rateLimit: latestRateLimit,
        cache: cacheSummary(),
        clipboardBridge: clipboardBridgeStatus(),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/bridge/status") {
      return sendJson(res, 200, {
        ok: true,
        clipboardBridge: clipboardBridgeStatus(),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/bridge/export") {
      return sendJson(res, 200, latestBridgeExportPayload());
    }

    if (req.method === "POST" && url.pathname === "/api/bridge/export") {
      const body = await readJson(req);
      const text = String(body.text || body.export || "");
      if (!looksLikeAddonExport(text)) {
        return sendJson(res, 400, {
          ok: false,
          error: "Expected RAA_EXPORT_V1 addon export text.",
        });
      }

      const accepted = publishBridgeExport(text, body.source || "post");
      return sendJson(res, 200, {
        ok: true,
        accepted,
        latest: bridgeExportSummary(clipboardBridge.latest),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/warcraftlogs/rate-limit") {
      if (!hasWarcraftLogsCredentials()) {
        return sendJson(res, 400, {
          error: "Missing WCL_CLIENT_ID or WCL_CLIENT_SECRET.",
        });
      }

      const rateLimit = await fetchRateLimitData();
      return sendJson(res, 200, {
        rateLimit,
        cache: cacheSummary(),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/warcraftlogs/rankings") {
      if (!hasWarcraftLogsCredentials()) {
        return sendJson(res, 400, {
          error: "Missing WCL_CLIENT_ID or WCL_CLIENT_SECRET.",
        });
      }

      const body = await readJson(req);
      const result = await fetchApplicantRankings(body);
      return sendJson(res, 200, result);
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Unexpected server error.",
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Raid Applicant Advisor running at http://127.0.0.1:${PORT}`);
  startClipboardBridge();
});

function createClipboardBridgeState() {
  const disabledByEnv = process.env.RAA_CLIPBOARD_BRIDGE === "0";
  const unsupportedPlatform = process.platform !== "win32";
  return {
    enabled: !disabledByEnv && !unsupportedPlatform,
    reason: disabledByEnv
      ? "Disabled by RAA_CLIPBOARD_BRIDGE=0."
      : unsupportedPlatform
        ? "Clipboard bridge only runs on Windows."
        : "",
    polling: false,
    timer: null,
    latest: null,
    nextId: 1,
    lastHash: "",
    lastCheckedAt: null,
    lastReceivedAt: null,
    lastError: null,
  };
}

function startClipboardBridge() {
  if (!clipboardBridge.enabled) {
    console.log(`Clipboard bridge disabled: ${clipboardBridge.reason}`);
    return;
  }

  if (clipboardBridge.timer) return;
  clipboardBridge.timer = setInterval(checkClipboardBridge, 1000);
  checkClipboardBridge();
  console.log("Clipboard bridge watching for RAA_EXPORT_V1 exports.");
}

function checkClipboardBridge() {
  if (!clipboardBridge.enabled || clipboardBridge.polling) return;

  clipboardBridge.polling = true;
  readClipboardText()
    .then((text) => {
      clipboardBridge.lastCheckedAt = new Date().toISOString();
      clipboardBridge.lastError = null;
      if (looksLikeAddonExport(text)) {
        publishBridgeExport(text, "clipboard");
      }
    })
    .catch((error) => {
      clipboardBridge.lastCheckedAt = new Date().toISOString();
      clipboardBridge.lastError = error.message || "Clipboard read failed.";
    })
    .finally(() => {
      clipboardBridge.polling = false;
    });
}

function readClipboardText() {
  return new Promise((resolve, reject) => {
    const script = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "$text = Get-Clipboard -Raw -Format Text",
      "if ($null -ne $text) { [Console]::Write($text) }",
    ].join("; ");

    execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 5000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr && stderr.trim()) || error.message || "Clipboard read failed."));
          return;
        }

        resolve(stdout || "");
      }
    );
  });
}

function looksLikeAddonExport(text) {
  const normalized = String(text || "");
  if (!/\bRAA_EXPORT_V1\b/i.test(normalized)) return false;
  return /\[(ROSTER|APPLICANTS)\]/i.test(normalized);
}

function publishBridgeExport(text, source) {
  const normalized = normalizeBridgeExport(text);
  const hash = crypto.createHash("sha256").update(normalized).digest("hex");
  if (hash === clipboardBridge.lastHash) return false;

  clipboardBridge.lastHash = hash;
  clipboardBridge.lastReceivedAt = new Date().toISOString();
  clipboardBridge.latest = {
    id: clipboardBridge.nextId,
    hash,
    text: normalized,
    source: source || "clipboard",
    receivedAt: clipboardBridge.lastReceivedAt,
    size: Buffer.byteLength(normalized, "utf8"),
  };
  clipboardBridge.nextId += 1;
  return true;
}

function normalizeBridgeExport(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function latestBridgeExportPayload() {
  if (!clipboardBridge.latest) {
    return { ok: true, latest: null, text: "" };
  }

  return {
    ok: true,
    latest: bridgeExportSummary(clipboardBridge.latest),
    text: clipboardBridge.latest.text,
  };
}

function bridgeExportSummary(exportData) {
  if (!exportData) return null;
  return {
    id: exportData.id,
    hash: exportData.hash,
    source: exportData.source,
    receivedAt: exportData.receivedAt,
    size: exportData.size,
  };
}

function clipboardBridgeStatus() {
  return {
    enabled: clipboardBridge.enabled,
    reason: clipboardBridge.reason,
    polling: clipboardBridge.polling,
    latest: bridgeExportSummary(clipboardBridge.latest),
    lastCheckedAt: clipboardBridge.lastCheckedAt,
    lastReceivedAt: clipboardBridge.lastReceivedAt,
    lastError: clipboardBridge.lastError,
  };
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

function hasWarcraftLogsCredentials() {
  return Boolean(process.env.WCL_CLIENT_ID && process.env.WCL_CLIENT_SECRET);
}

function serveStatic(requestPath, res) {
  const safePath = requestPath === "/" ? "/index.html" : decodeURIComponent(requestPath);
  const resolved = path.resolve(PUBLIC_DIR, `.${safePath}`);

  if (!resolved.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden");
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      return sendText(res, 404, "Not found");
    }

    const ext = path.extname(resolved);
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

function sendText(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function fetchApplicantRankings(payload) {
  const applicant = payload.applicant || {};
  const target = payload.target || {};
  const fallbackDifficulty = payload.fallbackDifficulty;
  const cacheKey = rankingCacheKey({ applicant, target, fallbackDifficulty });
  const cached = getCachedRanking(cacheKey);
  if (cached) {
    return withCacheInfo(cached.value, true, cached.expiresInSeconds);
  }

  cacheStats.misses += 1;
  const character = await fetchCharacterMetadata(applicant);
  const rankingApplicant = {
    ...applicant,
    className: applicant.className || character.className,
    specName: applicant.specName || character.specName,
  };
  const metric = metricForApplicant(target.metric, rankingApplicant.role);
  const pageMetric = pageMetricForApplicant(target.metric, rankingApplicant.role);
  const rankings = {};
  const zoneRankings = {};
  const difficulties = uniqueNumbers([target.difficulty, fallbackDifficulty, 5, 4]);
  const encounterTarget = await resolveEncounterTarget(target);
  const encounterId = encounterTarget.encounterId || target.encounterId;
  const zone = encounterTarget.zone;

  for (const difficulty of difficulties) {
    rankings[difficulty] = await fetchCharacterEncounterRanking({
      applicant: rankingApplicant,
      encounterId,
      difficulty,
      metric,
    });

    if (zone && zone.id) {
      zoneRankings[difficulty] = await fetchCharacterZoneRanking({
        applicant: rankingApplicant,
        zoneId: zone.id,
        difficulty,
        metric: pageMetric,
      });
      rankings[difficulty] = fillEncounterRankingFromZone(rankings[difficulty], zoneRankings[difficulty], encounterId);
    }
  }

  const result = {
    primary: rankings[target.difficulty] || null,
    fallback: fallbackDifficulty ? rankings[fallbackDifficulty] || null : null,
    difficulties: {
      mythic: rankings[5] || null,
      heroic: rankings[4] || null,
    },
    zone,
    encounterId,
    character,
    zoneDifficulties: {
      mythic: zoneRankings[5] || null,
      heroic: zoneRankings[4] || null,
    },
  };

  setCachedRanking(cacheKey, result);
  return withCacheInfo(result, false, Math.round(RANKING_CACHE_TTL_MS / 1000));
}

function fillEncounterRankingFromZone(encounterRanking, zoneRanking, encounterId) {
  if (!zoneRanking || !zoneRanking.encounters || !encounterId) return encounterRanking;
  if (encounterRanking && encounterRanking.percentile !== null && encounterRanking.percentile !== undefined) {
    return encounterRanking;
  }

  const zoneEncounter = zoneRanking.encounters[String(encounterId)];
  if (!zoneEncounter) return encounterRanking;

  return {
    ...(encounterRanking || emptyEncounterRanking("No direct encounter ranking.")),
    exists: zoneEncounter.percentile !== null,
    percentile: zoneEncounter.percentile,
    kills: zoneEncounter.kills,
    bestAmount: zoneEncounter.bestAmount,
    source: "zoneRanking",
  };
}

async function fetchRateLimitData() {
  const query = `
    query RateLimit {
      rateLimitData {
        limitPerHour
        pointsSpentThisHour
        pointsResetIn
      }
    }
  `;

  const data = await warcraftLogsGraphql(query, {});
  latestRateLimit = data.rateLimitData || latestRateLimit;
  return latestRateLimit;
}

function rankingCacheKey({ applicant, target, fallbackDifficulty }) {
  return JSON.stringify({
    name: String(applicant.name || "").toLowerCase(),
    realm: slugRealm(applicant.realm || ""),
    region: String(applicant.region || "US").toUpperCase(),
    role: String(applicant.role || ""),
    className: String(applicant.className || ""),
    specName: String(applicant.specName || ""),
    bossName: normalizeEncounterName(target && target.bossName),
    encounterId: Number(target && target.encounterId) || null,
    difficulty: Number(target && target.difficulty) || null,
    fallbackDifficulty: Number(fallbackDifficulty) || null,
    metric: String((target && target.metric) || "auto"),
  });
}

function getCachedRanking(key) {
  const entry = rankingResultCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (entry.expiresAt <= now) {
    rankingResultCache.delete(key);
    return null;
  }

  cacheStats.hits += 1;
  return {
    value: deepClone(entry.value),
    expiresInSeconds: Math.max(0, Math.round((entry.expiresAt - now) / 1000)),
  };
}

function setCachedRanking(key, value) {
  rankingResultCache.set(key, {
    value: deepClone(value),
    expiresAt: Date.now() + RANKING_CACHE_TTL_MS,
  });
}

function withCacheInfo(value, hit, expiresInSeconds) {
  return {
    ...deepClone(value),
    rateLimit: latestRateLimit,
    cache: {
      hit,
      expiresInSeconds,
      ttlSeconds: Math.round(RANKING_CACHE_TTL_MS / 1000),
      ...cacheSummary(),
    },
  };
}

function cacheSummary() {
  pruneRankingCache();
  return {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    entries: rankingResultCache.size,
    ttlSeconds: Math.round(RANKING_CACHE_TTL_MS / 1000),
  };
}

function pruneRankingCache() {
  const now = Date.now();
  for (const [key, entry] of rankingResultCache.entries()) {
    if (!entry || entry.expiresAt <= now) rankingResultCache.delete(key);
  }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function fetchCharacterMetadata(applicant) {
  if (!applicant.name || !applicant.realm || !applicant.region) {
    return {
      className: applicant.className || null,
      specName: applicant.specName || null,
      role: applicant.role || null,
      itemLevel: numberOrNull(applicant.itemLevel),
    };
  }

  const key = `${applicant.region.toUpperCase()}/${slugRealm(applicant.realm)}/${applicant.name.toLowerCase()}`;
  if (characterMetadataCache.has(key)) return characterMetadataCache.get(key);
  const raiderMetadataPromise = shouldFetchRaiderIoMetadata(applicant)
    ? fetchRaiderIoMetadata(applicant).catch((error) => ({
        requestError: true,
        reason: error.message || "Raider.IO metadata unavailable.",
      }))
    : Promise.resolve(null);

  const query = `
    query CharacterMetadata($name: String!, $serverSlug: String!, $serverRegion: String!) {
      characterData {
        character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
          id
          name
          classID
          gameData
        }
      }
    }
  `;

  try {
    const [data, raiderMetadata] = await Promise.all([
      warcraftLogsGraphql(query, {
        name: applicant.name,
        serverSlug: slugRealm(applicant.realm),
        serverRegion: applicant.region.toUpperCase(),
      }),
      raiderMetadataPromise,
    ]);
    const character = data.characterData && data.characterData.character;
    const global = character && character.gameData && character.gameData.global;
    const metadata = buildCharacterMetadata({
      applicant,
      id: character && character.id,
      name: character && character.name,
      warcraftLogsClassName: global && global.character_class && global.character_class.name,
      warcraftLogsSpecName: global && global.active_spec && global.active_spec.name,
      raiderMetadata,
    });
    characterMetadataCache.set(key, metadata);
    return metadata;
  } catch (error) {
    const raiderMetadata = await raiderMetadataPromise;
    const metadata = buildCharacterMetadata({
      applicant,
      raiderMetadata,
      reason: normalizeWarcraftLogsError(error),
    });
    characterMetadataCache.set(key, metadata);
    return metadata;
  }
}

function shouldFetchRaiderIoMetadata(applicant) {
  return (
    numberOrNull(applicant.itemLevel) === null ||
    !applicant.className ||
    !applicant.specName ||
    !applicant.role
  );
}

async function fetchRaiderIoMetadata(applicant) {
  const params = new URLSearchParams({
    region: String(applicant.region || "us").toLowerCase(),
    realm: slugRealm(applicant.realm),
    name: applicant.name,
    fields: "gear",
  });
  const response = await fetch(`${RAIDERIO_CHARACTER_URL}?${params}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "RaidApplicantAdvisor/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Raider.IO metadata request failed (${response.status}).`);
  }

  const body = await response.json();
  return {
    name: body.name || applicant.name,
    className: body.class || null,
    specName: body.active_spec_name || null,
    role: roleFromRaiderIo(body.active_spec_role),
    itemLevel: numberOrNull(body.gear && body.gear.item_level_equipped),
    profileUrl: body.profile_url || null,
    lastCrawledAt: body.last_crawled_at || null,
    source: "raider.io",
  };
}

function buildCharacterMetadata({ applicant, id, name, warcraftLogsClassName, warcraftLogsSpecName, raiderMetadata, reason }) {
  const raider = raiderMetadata && !raiderMetadata.requestError ? raiderMetadata : null;
  const applicantItemLevel = numberOrNull(applicant.itemLevel);
  const raiderItemLevel = raider ? numberOrNull(raider.itemLevel) : null;
  const metadata = {
    id,
    name: name || (raider && raider.name) || applicant.name,
    className: applicant.className || warcraftLogsClassName || (raider && raider.className) || null,
    specName: applicant.specName || warcraftLogsSpecName || (raider && raider.specName) || null,
    role: applicant.role || (raider && raider.role) || null,
    itemLevel: applicantItemLevel !== null ? applicantItemLevel : raiderItemLevel,
    itemLevelSource: applicantItemLevel !== null ? "addon" : (raiderItemLevel !== null ? "raider.io" : null),
    itemLevelUpdatedAt: applicantItemLevel !== null ? null : (raider && raider.lastCrawledAt) || null,
    raiderIoProfileUrl: (raider && raider.profileUrl) || null,
  };

  if (reason) metadata.reason = reason;
  if (raiderMetadata && raiderMetadata.requestError) metadata.raiderIoReason = raiderMetadata.reason;
  return metadata;
}

function roleFromRaiderIo(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "tank") return "Tank";
  if (normalized === "healing" || normalized === "healer") return "Healer";
  if (normalized === "dps" || normalized === "damage") return "DPS";
  return null;
}

async function resolveEncounterTarget(target) {
  const id = Number(target && target.encounterId);

  if (Number.isFinite(id) && id > 0) {
    const current = await fetchEncounterZone(id);
    if (!current || !isBetaZone(current.zone)) {
      return { encounterId: id, zone: current && current.zone };
    }

    const liveMatch = await resolveLiveEncounterByName(current.encounterName);
    return liveMatch || { encounterId: id, zone: current.zone };
  }

  return resolveLiveEncounterByName(target && target.bossName);
}

async function resolveLiveEncounterByName(name) {
  const zones = await fetchWorldZones();
  const wantedName = normalizeEncounterName(name);
  if (!wantedName) {
    return { encounterId: null, zone: null };
  }

  const matches = [];

  for (const zone of zones) {
    if (isBetaZone(zone)) continue;

    for (const encounter of zone.encounters || []) {
      const encounterName = normalizeEncounterName(encounter.name);
      if (encounterName === wantedName || encounterName.includes(wantedName) || wantedName.includes(encounterName)) {
        matches.push({
          encounterId: encounter.id,
          zone: {
            id: zone.id,
            name: zone.name,
            encounterName: encounter.name,
          },
          frozen: zone.frozen,
        });
      }
    }
  }

  matches.sort((a, b) => Number(a.frozen) - Number(b.frozen) || b.zone.id - a.zone.id);
  return matches[0] || { encounterId: null, zone: null };
}

async function fetchEncounterZone(encounterId) {
  const id = Number(encounterId);
  if (!Number.isFinite(id) || id <= 0) return null;
  if (zoneByEncounter.has(id)) return zoneByEncounter.get(id);

  const query = `
    query EncounterZone($encounterID: Int!) {
      worldData {
        encounter(id: $encounterID) {
          id
          name
          zone {
            id
            name
          }
        }
      }
    }
  `;

  const data = await warcraftLogsGraphql(query, { encounterID: id });
  const encounter = data.worldData && data.worldData.encounter;
  const result = encounter ? {
    encounterId: encounter.id,
    encounterName: encounter.name,
    zone: encounter.zone ? {
      id: encounter.zone.id,
      name: encounter.zone.name,
      encounterName: encounter.name,
    } : null,
  } : null;

  zoneByEncounter.set(id, result);
  return result;
}

async function fetchWorldZones() {
  if (cachedWorldZones) return cachedWorldZones;

  const query = `
    query WorldZones {
      worldData {
        zones {
          id
          name
          frozen
          encounters {
            id
            name
          }
        }
      }
    }
  `;

  const data = await warcraftLogsGraphql(query, {});
  cachedWorldZones = data.worldData && data.worldData.zones ? data.worldData.zones : [];
  return cachedWorldZones;
}

async function fetchCharacterEncounterRanking({ applicant, encounterId, difficulty, metric }) {
  if (!applicant.name || !applicant.realm || !applicant.region || !encounterId || !difficulty) {
    return {
      exists: false,
      reason: "Missing character, realm, region, encounter, or difficulty.",
    };
  }

  let data;
  const query = `
    query ApplicantRanking(
      $name: String!,
      $serverSlug: String!,
      $serverRegion: String!,
      $encounterID: Int!,
      $difficulty: Int!,
      $metric: CharacterRankingMetricType
    ) {
      characterData {
        character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
          id
          name
          classID
          encounterRankings(
            encounterID: $encounterID,
            difficulty: $difficulty,
            metric: $metric
          )
        }
      }
      rateLimitData {
        limitPerHour
        pointsSpentThisHour
        pointsResetIn
      }
    }
  `;

  try {
    data = await warcraftLogsGraphql(query, {
      name: applicant.name,
      serverSlug: slugRealm(applicant.realm),
      serverRegion: applicant.region.toUpperCase(),
      encounterID: Number(encounterId),
      difficulty: Number(difficulty),
      metric,
    });
  } catch (error) {
    return emptyEncounterRanking(normalizeWarcraftLogsError(error), !isNoDataWarcraftLogsError(error));
  }

  const character = data.characterData && data.characterData.character;
  if (!character) {
    return emptyEncounterRanking("Character not found or no public rankings.");
  }

  const ranking = normalizeRanking(character && character.encounterRankings);

  return {
    exists: ranking.exists,
    percentile: ranking.percentile,
    bestPerfAvg: ranking.bestPerfAvg,
    kills: ranking.kills,
    bestAmount: ranking.bestAmount,
    raw: character ? character.encounterRankings : null,
    rateLimit: data.rateLimitData || null,
  };
}

function emptyEncounterRanking(reason, requestError = false) {
  return {
    exists: false,
    percentile: null,
    bestPerfAvg: null,
    kills: 0,
    bestAmount: null,
    reason,
    requestError,
    raw: null,
    rateLimit: null,
  };
}

async function fetchCharacterZoneRanking({ applicant, zoneId, difficulty, metric }) {
  if (!applicant.name || !applicant.realm || !applicant.region || !zoneId || !difficulty) {
    return {
      exists: false,
      reason: "Missing character, realm, region, zone, or difficulty.",
    };
  }

  let data;
  const query = `
    query ApplicantZoneRanking(
      $name: String!,
      $serverSlug: String!,
      $serverRegion: String!,
      $zoneID: Int!,
      $difficulty: Int!,
      $metric: CharacterPageRankingMetricType,
      $className: String,
      $specName: String
    ) {
      characterData {
        character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
          id
          name
          zoneRankings(
            zoneID: $zoneID,
            difficulty: $difficulty,
            metric: $metric,
            className: $className,
            specName: $specName
          )
        }
      }
      rateLimitData {
        limitPerHour
        pointsSpentThisHour
        pointsResetIn
      }
    }
  `;

  try {
    data = await warcraftLogsGraphql(query, {
      name: applicant.name,
      serverSlug: slugRealm(applicant.realm),
      serverRegion: applicant.region.toUpperCase(),
      zoneID: Number(zoneId),
      difficulty: Number(difficulty),
      metric,
      className: warcraftLogsClassName(applicant.className) || "",
      specName: applicant.specName || "",
    });
  } catch (error) {
    return emptyZoneRanking(normalizeWarcraftLogsError(error), !isNoDataWarcraftLogsError(error));
  }

  const character = data.characterData && data.characterData.character;
  if (!character) {
    return emptyZoneRanking("Character not found or no public rankings.");
  }

  const ranking = normalizeZoneRanking(character && character.zoneRankings);

  return {
    exists: ranking.exists,
    bestPerfAvg: ranking.bestPerfAvg,
    medianPerfAvg: ranking.medianPerfAvg,
    kills: ranking.kills,
    encounters: ranking.encounters,
    raw: character ? character.zoneRankings : null,
    rateLimit: data.rateLimitData || null,
  };
}

function emptyZoneRanking(reason, requestError = false) {
  return {
    exists: false,
    bestPerfAvg: null,
    medianPerfAvg: null,
    kills: 0,
    encounters: {},
    reason,
    requestError,
    raw: null,
    rateLimit: null,
  };
}

async function warcraftLogsGraphql(query, variables) {
  const token = await getWarcraftLogsToken();
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await response.json();
  if (!response.ok || body.errors) {
    const message = body.errors ? body.errors.map((error) => error.message).join("; ") : response.statusText;
    throw new Error(`Warcraft Logs GraphQL error: ${message}`);
  }

  if (body.data && body.data.rateLimitData) {
    latestRateLimit = body.data.rateLimitData;
  }

  return body.data;
}

async function getWarcraftLogsToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.accessToken;
  }

  const credentials = Buffer.from(`${process.env.WCL_CLIENT_ID}:${process.env.WCL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Warcraft Logs OAuth error: ${body.error_description || body.error || response.statusText}`);
  }

  cachedToken = {
    accessToken: body.access_token,
    expiresAt: now + Number(body.expires_in || 3600) * 1000,
  };

  return cachedToken.accessToken;
}

function normalizeRanking(value) {
  if (!value) {
    return { exists: false, percentile: null, bestPerfAvg: null, kills: 0, bestAmount: null };
  }

  const candidates = [];
  collectRankingCandidates(value, candidates);

  const ranked = candidates
    .map((candidate) => ({
      percentile: numberOrNull(
        candidate.rankPercentile ??
        candidate.rankPercent ??
        candidate.percentile ??
        candidate.bestPerformanceAverage ??
        candidate.averagePerformance ??
        candidate.medianPerformance
      ),
      bestPerfAvg: numberOrNull(
        candidate.bestPerformanceAverage ??
        candidate.averagePerformance ??
        candidate.medianPerformance ??
        candidate.rankPercentile ??
        candidate.rankPercent ??
        candidate.percentile
      ),
      kills: numberOrNull(candidate.totalKills ?? candidate.kills ?? candidate.killCount) || 0,
      bestAmount: numberOrNull(candidate.bestAmount ?? candidate.amount),
    }))
    .filter((candidate) => candidate.percentile !== null || candidate.bestPerfAvg !== null || candidate.kills > 0);

  if (ranked.length === 0) {
    const percentile = numberOrNull(
      value.rankPercentile ??
      value.rankPercent ??
      value.percentile ??
      value.bestPerformanceAverage ??
      value.averagePerformance ??
      value.medianPerformance
    );
    const bestPerfAvg = numberOrNull(
      value.bestPerformanceAverage ??
      value.averagePerformance ??
      value.medianPerformance ??
      value.rankPercentile ??
      value.rankPercent ??
      value.percentile
    );
    const kills = numberOrNull(value.totalKills ?? value.kills ?? value.killCount) || 0;
    return {
      exists: percentile !== null || bestPerfAvg !== null || kills > 0,
      percentile,
      bestPerfAvg,
      kills,
      bestAmount: numberOrNull(value.bestAmount ?? value.amount),
    };
  }

  ranked.sort((a, b) => (b.bestPerfAvg ?? b.percentile ?? -1) - (a.bestPerfAvg ?? a.percentile ?? -1));
  return { exists: true, ...ranked[0] };
}

function normalizeZoneRanking(value) {
  if (!value) {
    return { exists: false, bestPerfAvg: null, medianPerfAvg: null, kills: 0 };
  }

  const bestPerfAvg = numberOrNull(value.bestPerformanceAverage);
  const medianPerfAvg = numberOrNull(value.medianPerformanceAverage);
  const rankings = Array.isArray(value.rankings) ? value.rankings : [];
  const killRankings = rankings.filter((ranking) => numberOrNull(ranking.totalKills) > 0);
  const rankPercents = killRankings
    .map((ranking) => numberOrNull(ranking.rankPercent ?? ranking.percentile))
    .filter((number) => number !== null);
  const medianPercents = killRankings
    .map((ranking) => numberOrNull(ranking.medianPercent))
    .filter((number) => number !== null);
  const kills = killRankings.reduce((sum, ranking) => sum + (numberOrNull(ranking.totalKills) || 0), 0);
  const encounterMap = {};
  for (const ranking of rankings) {
    const encounter = ranking.encounter || {};
    if (!encounter.id) continue;

    encounterMap[String(encounter.id)] = {
      id: encounter.id,
      name: encounter.name,
      percentile: numberOrNull(ranking.rankPercent ?? ranking.percentile),
      medianPercent: numberOrNull(ranking.medianPercent),
      kills: numberOrNull(ranking.totalKills) || 0,
      bestAmount: numberOrNull(ranking.bestAmount),
    };
  }
  const hasRankingSignal = kills > 0 || rankPercents.some((percent) => percent > 0) || medianPercents.some((percent) => percent > 0);
  const normalizedBestPerfAvg = hasRankingSignal && bestPerfAvg !== null && bestPerfAvg > 0 ? bestPerfAvg : averagePositive(rankPercents);
  const normalizedMedianPerfAvg = hasRankingSignal && medianPerfAvg !== null && medianPerfAvg > 0 ? medianPerfAvg : averagePositive(medianPercents);

  return {
    exists: normalizedBestPerfAvg !== null || normalizedMedianPerfAvg !== null,
    bestPerfAvg: normalizedBestPerfAvg,
    medianPerfAvg: normalizedMedianPerfAvg,
    kills,
    encounters: encounterMap,
    reason: hasRankingSignal ? null : "No public Warcraft Logs data for this raid.",
  };
}

function collectRankingCandidates(value, candidates) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectRankingCandidates(item, candidates);
    return;
  }

  if (
    "rankPercentile" in value ||
    "rankPercent" in value ||
    "percentile" in value ||
    "bestPerformanceAverage" in value ||
    "averagePerformance" in value ||
    "medianPerformance" in value ||
    "bestAmount" in value
  ) {
    candidates.push(value);
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") collectRankingCandidates(child, candidates);
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function metricForApplicant(metric, role) {
  if (metric && metric !== "auto") return metric;
  return metricForRole(role);
}

function pageMetricForApplicant(metric, role) {
  if (metric && metric !== "auto") {
    if (metric.includes("hps")) return "hps";
    if (metric === "bossdps" || metric.includes("dps")) return "dps";
    return metric;
  }

  return String(role || "").toLowerCase() === "healer" ? "hps" : "dps";
}

function metricForRole(role) {
  const normalized = String(role || "").toLowerCase();
  if (normalized === "healer") return "hps";
  return "dps";
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter((value) => Number.isFinite(value) && value > 0))];
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averagePositive(values) {
  return average(values.filter((value) => value > 0));
}

function normalizeWarcraftLogsError(error) {
  if (isNoDataWarcraftLogsError(error)) {
    return "No public Warcraft Logs data for this raid.";
  }

  return error && error.message ? error.message : "Warcraft Logs request failed.";
}

function isNoDataWarcraftLogsError(error) {
  return /internal server error/i.test(error && error.message ? error.message : "");
}

function isBetaZone(zone) {
  return Boolean(zone && /\bbeta\b/i.test(zone.name || ""));
}

function normalizeEncounterName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['â€™]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugRealm(realm) {
  const slug = String(realm || "")
    .trim()
    .toLowerCase()
    .replace(/['.]/g, "")
    .replace(/\s+/g, "-");
  const aliases = {
    area52: "area-52",
    moonguard: "moon-guard",
    wyrmrestaccord: "wyrmrest-accord",
  };

  return aliases[slug] || slug;
}

function warcraftLogsClassName(className) {
  const normalized = String(className || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  const classNames = {
    deathknight: "DeathKnight",
    demonhunter: "DemonHunter",
    druid: "Druid",
    evoker: "Evoker",
    hunter: "Hunter",
    mage: "Mage",
    monk: "Monk",
    paladin: "Paladin",
    priest: "Priest",
    rogue: "Rogue",
    shaman: "Shaman",
    warlock: "Warlock",
    warrior: "Warrior",
  };

  return classNames[normalized] || "";
}
