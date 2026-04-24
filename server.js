const http = require("node:http");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
loadDotEnv(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 4177);
const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";
const GRAPHQL_URL = "https://www.warcraftlogs.com/api/v2/client";
const RAIDERIO_CHARACTER_URL = "https://raider.io/api/v1/characters/profile";
const RANKING_CACHE_TTL_MS = 180 * 60 * 1000;
const WCL_PARTITION_PREFERENCE_TTL_MS = 15 * 60 * 1000;
const MIN_SCORING_RAID_DIFFICULTY = 4;
const SHARE_TOKEN = String(process.env.RAA_SHARE_TOKEN || "").trim();
const DECISION_FILE = path.resolve(ROOT, process.env.RAA_DECISIONS_FILE || path.join("artifacts", "shared-decisions.json"));
const MYTHIC_PLUS_RANGES = [
  { id: "2-3", min: 2, max: 3, targetRuns: 3 },
  { id: "4-6", min: 4, max: 6, targetRuns: 4 },
  { id: "7-9", min: 7, max: 9, targetRuns: 5 },
  { id: "10-11", min: 10, max: 11, targetRuns: 6 },
  { id: "12-14", min: 12, max: 14, targetRuns: 6 },
  { id: "15+", min: 15, max: null, targetRuns: 7 },
];

let cachedToken = null;
const zoneByEncounter = new Map();
let cachedWorldZones = null;
const characterMetadataCache = new Map();
const rankingResultCache = new Map();
const zoneRankingResultCache = new Map();
const zoneRankingPartitionPreferences = new Map();
const cacheStats = { hits: 0, misses: 0, zoneHits: 0, zoneMisses: 0 };
let latestRateLimit = null;
const clipboardBridge = createClipboardBridgeState();
const sharedDecisions = loadSharedDecisions();

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
    const access = authorizeShareRequest(url, req);
    if (access.setCookie) {
      res.setHeader("Set-Cookie", access.setCookie);
    }
    if (!access.ok) {
      return sendText(res, 403, "Share link required.");
    }
    if (access.redirectTo) {
      return sendRedirect(res, access.redirectTo);
    }
    if (access.pathname) {
      url.pathname = access.pathname;
    }

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

    if (req.method === "GET" && url.pathname === "/api/decisions") {
      return sendJson(res, 200, sharedDecisionSnapshot());
    }

    if (req.method === "POST" && url.pathname === "/api/decisions") {
      const body = await readJson(req);
      const result = applySharedDecision(body);
      if (!result.ok) return sendJson(res, 400, result);
      return sendJson(res, 200, sharedDecisionSnapshot());
    }

    if (req.method === "POST" && url.pathname === "/api/decisions/clear") {
      const body = await readJson(req);
      const result = clearSharedDecisions(body);
      if (!result.ok) return sendJson(res, 400, result);
      return sendJson(res, 200, {
        ...sharedDecisionSnapshot(),
        cleared: result.cleared,
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
      const body = await readJson(req);
      if (!hasWarcraftLogsCredentials() && !isMythicPlusScoreTarget(body && body.target)) {
        return sendJson(res, 400, {
          error: "Missing WCL_CLIENT_ID or WCL_CLIENT_SECRET.",
        });
      }

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
  const normalized = normalizeBridgeExport(text);
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
  const normalized = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  const encodedMatch = normalized.match(/^RAA_EXPORT_ESCAPED_V1:(\S+)$/i);
  if (!encodedMatch) return normalized;

  try {
    return decodeURIComponent(encodedMatch[1]).trim();
  } catch (_error) {
    return normalized;
  }
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

function createEmptyDecisionState() {
  return {
    revision: 0,
    accepted: {},
    declined: {},
  };
}

function loadSharedDecisions() {
  try {
    if (!fs.existsSync(DECISION_FILE)) return createEmptyDecisionState();
    const parsed = JSON.parse(fs.readFileSync(DECISION_FILE, "utf8"));
    return normalizeDecisionState(parsed);
  } catch (error) {
    return createEmptyDecisionState();
  }
}

function normalizeDecisionState(input) {
  const state = createEmptyDecisionState();
  state.revision = Math.max(0, Number(input && input.revision) || 0);

  for (const record of Object.values(input && input.accepted || {})) {
    const normalized = normalizeDecisionRecord(record);
    if (normalized && normalized.line) state.accepted[normalized.key] = normalized;
  }

  for (const record of Object.values(input && input.declined || {})) {
    const normalized = normalizeDecisionRecord(record);
    if (normalized) state.declined[normalized.key] = normalized;
  }

  return state;
}

function normalizeDecisionRecord(record) {
  const key = normalizeDecisionKey(record && record.key);
  if (!key) return null;

  const updatedAt = String(record && record.updatedAt || "").trim();
  return {
    key,
    name: cleanDecisionText(record && record.name, 120),
    line: cleanDecisionText(record && record.line, 1000),
    updatedBy: cleanDecisionText(record && record.updatedBy, 120),
    updatedAt: Number.isFinite(Date.parse(updatedAt)) ? updatedAt : new Date().toISOString(),
  };
}

function sharedDecisionSnapshot() {
  return {
    ok: true,
    revision: sharedDecisions.revision,
    accepted: sortedDecisionRecords(sharedDecisions.accepted),
    declined: sortedDecisionRecords(sharedDecisions.declined),
  };
}

function sortedDecisionRecords(records) {
  return Object.values(records || {}).sort((left, right) => {
    const timeDelta = Date.parse(left.updatedAt || "") - Date.parse(right.updatedAt || "");
    if (timeDelta) return timeDelta;
    return String(left.key || "").localeCompare(String(right.key || ""));
  });
}

function applySharedDecision(body) {
  const action = normalizeDecisionAction(body && (body.action || body.status));
  if (!action) {
    return { ok: false, error: "Expected action to be accept or decline." };
  }

  const key = normalizeDecisionKey(body && (body.key || body.applicantKey || body.applicant && body.applicant.key));
  if (!key) {
    return { ok: false, error: "Expected an applicant key." };
  }

  const entry = {
    key,
    name: cleanDecisionText(body && (body.name || body.applicant && body.applicant.name), 120),
    line: cleanDecisionText(body && (body.line || body.rosterLine || body.applicant && body.applicant.line), 1000),
    updatedBy: cleanDecisionText(body && (body.clientId || body.updatedBy), 120),
    updatedAt: new Date().toISOString(),
  };

  if (action === "accepted") {
    if (!entry.line) {
      return { ok: false, error: "Accept decisions require a roster line." };
    }
    sharedDecisions.accepted[key] = entry;
    delete sharedDecisions.declined[key];
  } else {
    delete sharedDecisions.accepted[key];
    sharedDecisions.declined[key] = entry;
  }

  bumpSharedDecisionRevision();
  return { ok: true };
}

function clearSharedDecisions(body) {
  const scope = normalizeDecisionClearScope(body && (body.scope || body.status || body.type));
  if (!scope) {
    return { ok: false, error: "Expected scope to be accepted, declined, or all." };
  }

  const keys = Array.isArray(body && body.keys)
    ? body.keys.map(normalizeDecisionKey).filter(Boolean)
    : [];
  let cleared = 0;

  const clearMap = (records) => {
    if (!records) return;
    if (!keys.length) {
      cleared += Object.keys(records).length;
      for (const key of Object.keys(records)) delete records[key];
      return;
    }

    for (const key of keys) {
      if (!records[key]) continue;
      delete records[key];
      cleared += 1;
    }
  };

  if (scope === "accepted" || scope === "all") clearMap(sharedDecisions.accepted);
  if (scope === "declined" || scope === "all") clearMap(sharedDecisions.declined);

  if (cleared) bumpSharedDecisionRevision();
  return { ok: true, cleared };
}

function bumpSharedDecisionRevision() {
  sharedDecisions.revision += 1;
  persistSharedDecisions();
}

function persistSharedDecisions() {
  fs.mkdirSync(path.dirname(DECISION_FILE), { recursive: true });
  const payload = JSON.stringify({
    version: 1,
    revision: sharedDecisions.revision,
    accepted: sharedDecisions.accepted,
    declined: sharedDecisions.declined,
  }, null, 2);
  const tempPath = `${DECISION_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, payload, "utf8");
  fs.renameSync(tempPath, DECISION_FILE);
}

function normalizeDecisionAction(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "accept" || text === "accepted") return "accepted";
  if (text === "decline" || text === "declined") return "declined";
  return "";
}

function normalizeDecisionClearScope(value) {
  const text = String(value || "all").trim().toLowerCase();
  if (text === "accept" || text === "accepted") return "accepted";
  if (text === "decline" || text === "declined") return "declined";
  if (text === "all" || text === "both") return "all";
  return "";
}

function normalizeDecisionKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/-us$/i, "|us");
}

function cleanDecisionText(value, maxLength) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function authorizeShareRequest(url, req) {
  if (!SHARE_TOKEN) return { ok: true };

  const pathMatch = url.pathname.match(/^\/(?:r|share)\/([^/]+)(\/.*)?$/);
  if (pathMatch && tokenMatches(pathMatch[1])) {
    if (!pathMatch[2]) {
      return {
        ok: true,
        redirectTo: `${url.pathname}/${url.search}`,
        setCookie: shareCookieHeader(),
      };
    }

    return {
      ok: true,
      pathname: pathMatch[2] && pathMatch[2] !== "/" ? pathMatch[2] : "/",
      setCookie: shareCookieHeader(),
    };
  }

  const queryToken = url.searchParams.get("key") || url.searchParams.get("token");
  if (tokenMatches(queryToken)) {
    return {
      ok: true,
      setCookie: shareCookieHeader(),
    };
  }

  const cookies = parseCookies(req.headers.cookie || "");
  if (tokenMatches(cookies.raa_share_token)) {
    return { ok: true };
  }

  return { ok: false };
}

function tokenMatches(value) {
  const candidate = String(value || "").trim();
  if (!candidate || !SHARE_TOKEN) return false;

  const left = Buffer.from(candidate);
  const right = Buffer.from(SHARE_TOKEN);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
  return String(header || "")
    .split(";")
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index <= 0) return cookies;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key) cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function shareCookieHeader() {
  return `raa_share_token=${encodeURIComponent(SHARE_TOKEN)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`;
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

function sendRedirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
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
  const mplusOnly = isMythicPlusScoreTarget(target);
  const hasAddonClassSpec = Boolean(applicant.className && applicant.specName);
  const character = await fetchCharacterMetadata(applicant, { skipWarcraftLogs: mplusOnly || hasAddonClassSpec });
  if (mplusOnly) {
    const result = emptyRankingResult({
      character,
      reason: "Mythic+ Raider.IO mode does not request Warcraft Logs rankings.",
      mplusOnly: true,
    });
    setCachedRanking(cacheKey, result);
    return withCacheInfo(result, false, Math.round(RANKING_CACHE_TTL_MS / 1000));
  }

  const rankingApplicant = {
    ...applicant,
    className: applicant.className || character.className,
    specName: applicant.specName || character.specName,
  };
  const metric = metricForApplicant(target.metric, rankingApplicant.role);
  const pageMetric = pageMetricForApplicant(target.metric, rankingApplicant.role);
  const rankings = {};
  const zoneRankings = {};
  const difficulties = rankingDifficultiesForTarget(target, fallbackDifficulty);
  const encounterTarget = await resolveEncounterTarget(target);
  const encounterId = encounterTarget.encounterId || target.encounterId;
  const zone = encounterTarget.zone;
  let rankingDataLookups = 0;
  let rankingDataCacheHits = 0;

  if (zone && zone.id) {
    const zoneRankingResults = await fetchCachedCharacterZoneRankings({
      applicant: rankingApplicant,
      zoneId: zone.id,
      partitions: zone.partitions,
      difficulties,
      metric: pageMetric,
    });
    rankingDataLookups += zoneRankingResults.lookups;
    rankingDataCacheHits += zoneRankingResults.cacheHits;

    for (const difficulty of difficulties) {
      zoneRankings[difficulty] = zoneRankingResults.byDifficulty[difficulty] || null;
      rankings[difficulty] = encounterRankingFromZone(zoneRankings[difficulty], encounterId);
    }
  } else {
    for (const difficulty of difficulties) {
      rankings[difficulty] = await fetchCharacterEncounterRanking({
        applicant: rankingApplicant,
        encounterId,
        difficulty,
        metric,
      });
    }
  }

  const result = {
    primary: rankings[target.difficulty] || null,
    fallback: fallbackDifficulty ? rankings[fallbackDifficulty] || null : null,
    difficulties: {
      mythic: rankings[5] || null,
      heroic: rankings[4] || null,
      normal: rankings[3] || null,
      lfr: rankings[2] || null,
    },
    difficultyRankings: rankingsByDifficulty(rankings),
    zone,
    encounterId,
    character,
    zoneDifficulties: {
      mythic: zoneRankings[5] || null,
      heroic: zoneRankings[4] || null,
      normal: zoneRankings[3] || null,
      lfr: zoneRankings[2] || null,
    },
    zoneDifficultyRankings: rankingsByDifficulty(zoneRankings),
  };

  setCachedRanking(cacheKey, result);
  const reusedCachedRankingData = rankingDataLookups > 0 && rankingDataLookups === rankingDataCacheHits;
  return withCacheInfo(result, reusedCachedRankingData, Math.round(RANKING_CACHE_TTL_MS / 1000));
}

function emptyRankingResult({ character, reason, mplusOnly = false }) {
  const empty = emptyEncounterRanking(reason || "No ranking data requested.");
  return {
    primary: null,
    fallback: null,
    difficulties: {
      mythic: empty,
      heroic: empty,
      normal: empty,
      lfr: empty,
    },
    difficultyRankings: {},
    zone: null,
    encounterId: null,
    character,
    zoneDifficulties: {
      mythic: null,
      heroic: null,
      normal: null,
      lfr: null,
    },
    zoneDifficultyRankings: {},
    mplusOnly,
  };
}

function isMythicPlusScoreTarget(target) {
  return String(target && target.scoreMode || "").trim().toLowerCase() === "mplus";
}

function rankingDifficultiesForTarget(target, fallbackDifficulty) {
  const selected = Number(target && target.difficulty) || null;
  const fallback = Number(fallbackDifficulty) || null;
  const values = [selected, fallback];

  for (const difficulty of [5, 4, 3, 2]) {
    if (selected && difficulty > selected) values.push(difficulty);
  }

  const scoringValues = uniqueNumbers(values).filter((difficulty) => difficulty >= MIN_SCORING_RAID_DIFFICULTY);
  return scoringValues.length ? scoringValues : [5, 4];
}

function rankingsByDifficulty(rankings) {
  return [5, 4, 3, 2].reduce((byDifficulty, difficulty) => {
    byDifficulty[String(difficulty)] = rankings[difficulty] || null;
    return byDifficulty;
  }, {});
}

function fillEncounterRankingFromZone(encounterRanking, zoneRanking, encounterId) {
  if (!zoneRanking || !zoneRanking.encounters || !encounterId) {
    return {
      ...encounterRanking,
      partition: zoneRanking && zoneRanking.partition ? zoneRanking.partition : encounterRanking && encounterRanking.partition,
    };
  }

  const zoneEncounter = zoneRanking.encounters[String(encounterId)];
  if (!zoneEncounter) return encounterRanking;

  const base = encounterRanking || emptyEncounterRanking("No direct encounter ranking.");
  const zonePercentile = numberOrNull(zoneEncounter.percentile);
  const zoneKills = numberOrNull(zoneEncounter.kills);
  const zoneBestAmount = numberOrNull(zoneEncounter.bestAmount);

  return {
    ...base,
    exists: Boolean(base.exists || zonePercentile !== null || (zoneKills !== null && zoneKills > 0) || zoneBestAmount !== null),
    percentile: base.percentile !== null && base.percentile !== undefined ? base.percentile : zonePercentile,
    kills: zoneKills !== null ? zoneKills : base.kills,
    bestAmount: base.bestAmount !== null && base.bestAmount !== undefined ? base.bestAmount : zoneBestAmount,
    medianPercent: numberOrNull(zoneEncounter.medianPercent),
    partition: zoneRanking.partition || base.partition || null,
    zoneSource: "zoneRanking",
  };
}

function encounterRankingFromZone(zoneRanking, encounterId) {
  if (!zoneRanking) return emptyEncounterRanking("No zone ranking data available.");

  const base = emptyEncounterRanking(
    zoneRanking.reason || "No selected boss ranking found in the raid-wide Warcraft Logs data.",
    Boolean(zoneRanking.requestError)
  );
  base.partition = zoneRanking.partition || null;
  return fillEncounterRankingFromZone(base, zoneRanking, encounterId);
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
    zoneAnchorEncounterId: Number(target && target.zoneAnchorEncounterId) || null,
    raidAverage: Boolean(target && target.raidAverage),
    scoreMode: String((target && target.scoreMode) || "raid"),
    mythicPlusRange: String((target && target.mythicPlusRange) || ""),
    difficulty: Number(target && target.difficulty) || null,
    fallbackDifficulty: Number(fallbackDifficulty) || null,
    metric: String((target && target.metric) || "auto"),
  });
}

function zoneRankingCacheKey({ applicant, zoneId, difficulty, metric, partition }) {
  return JSON.stringify({
    name: String(applicant.name || "").toLowerCase(),
    realm: slugRealm(applicant.realm || ""),
    region: String(applicant.region || "US").toUpperCase(),
    className: warcraftLogsClassName(applicant.className) || "",
    specName: String(applicant.specName || ""),
    zoneId: Number(zoneId) || null,
    difficulty: Number(difficulty) || null,
    metric: String(metric || ""),
    partition: normalizeWarcraftLogsPartitionId(partition),
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

function getCachedZoneRanking(key) {
  const entry = zoneRankingResultCache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (entry.expiresAt <= now) {
    zoneRankingResultCache.delete(key);
    return null;
  }

  cacheStats.zoneHits += 1;
  return {
    value: deepClone(entry.value),
    hit: true,
    expiresInSeconds: Math.max(0, Math.round((entry.expiresAt - now) / 1000)),
  };
}

function setCachedRanking(key, value) {
  rankingResultCache.set(key, {
    value: deepClone(value),
    expiresAt: Date.now() + RANKING_CACHE_TTL_MS,
  });
}

function setCachedZoneRanking(key, value) {
  zoneRankingResultCache.set(key, {
    value: deepClone(value),
    expiresAt: Date.now() + RANKING_CACHE_TTL_MS,
  });
}

async function fetchCachedCharacterZoneRanking(args) {
  const results = await fetchCachedCharacterZoneRankings({
    ...args,
    difficulties: [args && args.difficulty],
  });
  const value = results.byDifficulty[Number(args && args.difficulty)] || emptyZoneRanking("No Warcraft Logs rankings returned.");
  return {
    value,
    hit: results.cacheHits > 0,
    expiresInSeconds: Math.round(RANKING_CACHE_TTL_MS / 1000),
  };
}

async function fetchCachedCharacterZoneRankings(args) {
  const states = uniqueNumbers(args.difficulties || [])
    .map((difficulty) => ({
      difficulty,
      attempts: zoneRankingPartitionAttempts({ ...args, difficulty }),
      index: 0,
      fallback: null,
      result: null,
      hit: false,
    }));
  const byDifficulty = {};
  if (!states.length) {
    return { byDifficulty, lookups: 0, cacheHits: 0 };
  }

  while (states.some((state) => !state.result)) {
    const batch = [];

    for (const state of states) {
      if (state.result) continue;

      while (state.index < state.attempts.length) {
        const attempt = state.attempts[state.index];
        const cached = getCachedZoneRanking(zoneRankingCacheKey(attempt));
        if (cached) {
          state.index += 1;
          if (hasZoneRankingData(cached.value)) {
            rememberZoneRankingPartition(attempt, cached.value.partition);
            state.result = cached.value;
            state.hit = true;
            break;
          }
          state.fallback = chooseZoneRankingFallback(state.fallback, cached);
          continue;
        }

        batch.push({ state, attempt });
        break;
      }

      if (!state.result && state.index >= state.attempts.length) {
        state.result = state.fallback
          ? state.fallback.value
          : emptyZoneRanking("No Warcraft Logs partitions were available for this raid.");
        state.hit = Boolean(state.fallback && state.fallback.hit);
      }
    }

    if (!batch.length) continue;

    cacheStats.zoneMisses += batch.length;
    const values = await fetchCharacterZoneRankingBatch({
      applicant: args.applicant,
      zoneId: args.zoneId,
      metric: args.metric,
      requests: batch.map((entry) => entry.attempt),
    });

    for (let index = 0; index < batch.length; index += 1) {
      const { state, attempt } = batch[index];
      const value = values[index] || emptyZoneRanking("No Warcraft Logs rankings returned.", false, attempt.partition);
      setCachedZoneRanking(zoneRankingCacheKey(attempt), value);
      state.index += 1;

      const result = {
        value: deepClone(value),
        hit: false,
        expiresInSeconds: Math.round(RANKING_CACHE_TTL_MS / 1000),
      };

      if (hasZoneRankingData(value)) {
        rememberZoneRankingPartition(attempt, value.partition);
        state.result = result.value;
        state.hit = false;
      } else {
        state.fallback = chooseZoneRankingFallback(state.fallback, result);
      }
    }
  }

  let cacheHits = 0;
  for (const state of states) {
    byDifficulty[state.difficulty] = state.result;
    if (state.hit) cacheHits += 1;
  }

  return {
    byDifficulty,
    lookups: states.length,
    cacheHits,
  };
}

function chooseZoneRankingFallback(current, candidate) {
  if (!current) return candidate;
  if (current.value && current.value.requestError && candidate.value && !candidate.value.requestError) {
    return candidate;
  }
  return current;
}

function zoneRankingPartitionAttempts(args) {
  const partitions = normalizeWarcraftLogsPartitions(args && args.partitions);
  const aggregate = aggregateWarcraftLogsPartition();
  if (!partitions.length) {
    return [{ ...args, partition: aggregate }];
  }

  const ordered = [];
  addUniquePartition(ordered, aggregate);
  addUniquePartition(ordered, preferredZoneRankingPartition(args));
  for (const partition of partitions.filter((item) => !item.default).sort((left, right) => right.id - left.id)) {
    addUniquePartition(ordered, partition);
  }
  for (const partition of partitions.filter((item) => item.default)) addUniquePartition(ordered, partition);

  return ordered.map((partition) => ({ ...args, partition }));
}

function addUniquePartition(partitions, partition) {
  const normalized = normalizeWarcraftLogsPartition(partition);
  if (!normalized) return;
  if (partitions.some((item) => item.id === normalized.id)) return;
  partitions.push(normalized);
}

function preferredZoneRankingPartition(args) {
  const key = zoneRankingPartitionPreferenceKey(args);
  const entry = key ? zoneRankingPartitionPreferences.get(key) : null;
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    zoneRankingPartitionPreferences.delete(key);
    return null;
  }
  return entry.partition;
}

function rememberZoneRankingPartition(args, partition) {
  const normalized = normalizeWarcraftLogsPartition(partition);
  const key = zoneRankingPartitionPreferenceKey(args);
  if (!normalized || !key) return;
  if (normalized.aggregate) return;

  zoneRankingPartitionPreferences.set(key, {
    partition: normalized,
    expiresAt: Date.now() + WCL_PARTITION_PREFERENCE_TTL_MS,
  });
}

function zoneRankingPartitionPreferenceKey({ zoneId, difficulty, metric }) {
  const normalizedZoneId = Number(zoneId) || null;
  const normalizedDifficulty = Number(difficulty) || null;
  if (!normalizedZoneId || !normalizedDifficulty) return null;
  return JSON.stringify({
    zoneId: normalizedZoneId,
    difficulty: normalizedDifficulty,
    metric: String(metric || ""),
  });
}

function normalizeWarcraftLogsPartitions(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeWarcraftLogsPartition)
    .filter(Boolean)
    .sort((left, right) => Number(right.default) - Number(left.default) || right.id - left.id);
}

function normalizeWarcraftLogsPartition(value) {
  if (isWarcraftLogsAggregatePartition(value)) {
    return aggregateWarcraftLogsPartition();
  }

  const id = normalizeWarcraftLogsPartitionId(value);
  if (id === null) return null;
  const name = typeof value === "object" && value ? String(value.name || "").trim() : "";
  const compactName = typeof value === "object" && value ? String(value.compactName || "").trim() : "";
  return {
    id,
    name,
    compactName,
    label: compactName || name || `Partition ${id}`,
    default: Boolean(value && typeof value === "object" && value.default),
  };
}

function aggregateWarcraftLogsPartition() {
  return {
    id: -1,
    name: "All",
    compactName: "All",
    label: "All",
    default: false,
    aggregate: true,
  };
}

function isWarcraftLogsAggregatePartition(value) {
  if (value === -1) return true;
  if (!value || typeof value !== "object") return false;
  if (value.aggregate) return true;
  if ("partition" in value && Number(value.partition) === -1) return true;
  if ("id" in value && Number(value.id) === -1) return true;
  return false;
}

function normalizeWarcraftLogsPartitionId(value) {
  if (value === null || value === undefined || value === "") return null;
  const source = typeof value === "object" ? value.id : value;
  const id = Number(source);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function warcraftLogsPartitionForResult(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeWarcraftLogsPartition(candidate);
    if (normalized) return normalized;
  }
  return aggregateWarcraftLogsPartition();
}

function hasZoneRankingData(value) {
  if (!value || value.requestError) return false;
  if (value.exists) return true;
  if ((numberOrNull(value.bestPerfAvg) || 0) > 0) return true;
  if ((numberOrNull(value.medianPerfAvg) || 0) > 0) return true;
  if ((numberOrNull(value.kills) || 0) > 0) return true;

  const encounters = value.encounters && typeof value.encounters === "object" ? Object.values(value.encounters) : [];
  return encounters.some((encounter) => (
    (numberOrNull(encounter.percentile) || 0) > 0 ||
    (numberOrNull(encounter.medianPercent) || 0) > 0 ||
    (numberOrNull(encounter.kills) || 0) > 0
  ));
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
  const hits = cacheStats.hits + cacheStats.zoneHits;
  const misses = cacheStats.misses + cacheStats.zoneMisses;
  return {
    hits,
    misses,
    entries: rankingResultCache.size + zoneRankingResultCache.size,
    resultHits: cacheStats.hits,
    resultMisses: cacheStats.misses,
    resultEntries: rankingResultCache.size,
    zoneHits: cacheStats.zoneHits,
    zoneMisses: cacheStats.zoneMisses,
    zoneEntries: zoneRankingResultCache.size,
    ttlSeconds: Math.round(RANKING_CACHE_TTL_MS / 1000),
  };
}

function pruneRankingCache() {
  const now = Date.now();
  for (const [key, entry] of rankingResultCache.entries()) {
    if (!entry || entry.expiresAt <= now) rankingResultCache.delete(key);
  }
  for (const [key, entry] of zoneRankingResultCache.entries()) {
    if (!entry || entry.expiresAt <= now) zoneRankingResultCache.delete(key);
  }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function fetchCharacterMetadata(applicant, options = {}) {
  if (!applicant.name || !applicant.realm || !applicant.region) {
    return {
      className: applicant.className || null,
      specName: applicant.specName || null,
      role: applicant.role || null,
      itemLevel: numberOrNull(applicant.itemLevel),
      raiderIoRunSummary: emptyRaiderIoRunSummary(),
    };
  }

  const skipWarcraftLogs = Boolean(options.skipWarcraftLogs);
  const keyPrefix = skipWarcraftLogs ? "rio" : "full";
  const key = `${keyPrefix}/${applicant.region.toUpperCase()}/${slugRealm(applicant.realm)}/${applicant.name.toLowerCase()}`;
  if (characterMetadataCache.has(key)) return characterMetadataCache.get(key);
  const raiderMetadataPromise = shouldFetchRaiderIoMetadata(applicant)
    ? fetchRaiderIoMetadata(applicant).catch((error) => ({
        requestError: true,
        reason: error.message || "Raider.IO metadata unavailable.",
      }))
    : Promise.resolve(null);

  if (skipWarcraftLogs) {
    const raiderMetadata = await raiderMetadataPromise;
    const metadata = buildCharacterMetadata({
      applicant,
      raiderMetadata,
      reason: raiderMetadata && raiderMetadata.requestError ? raiderMetadata.reason : null,
    });
    characterMetadataCache.set(key, metadata);
    return metadata;
  }

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
  return Boolean(applicant.name && applicant.realm && applicant.region);
}

async function fetchRaiderIoMetadata(applicant) {
  const params = new URLSearchParams({
    region: String(applicant.region || "us").toLowerCase(),
    realm: slugRealm(applicant.realm),
    name: applicant.name,
    fields: [
      "gear",
      "mythic_plus_scores_by_season:current",
      "mythic_plus_best_runs:all",
      "mythic_plus_alternate_runs",
      "mythic_plus_recent_runs",
      "mythic_plus_highest_level_runs",
      "mythic_plus_weekly_highest_level_runs",
      "mythic_plus_previous_weekly_highest_level_runs",
    ].join(","),
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
  const timedKeyStats = extractTimedKeyStats(body);
  return {
    name: body.name || applicant.name,
    className: body.class || null,
    specName: body.active_spec_name || null,
    role: roleFromRaiderIo(body.active_spec_role),
    itemLevel: numberOrNull(body.gear && body.gear.item_level_equipped),
    raiderIoScore: currentRaiderIoScore(body),
    raiderIoTimedTenPlus: extractTimedTenPlusCount(body),
    raiderIoKeyRanges: timedKeyStats.ranges,
    raiderIoBestTimedLevel: timedKeyStats.bestTimedLevel,
    raiderIoRunSummary: timedKeyStats.runSummary,
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
    raiderIoScore: raider ? numberOrNull(raider.raiderIoScore) : null,
    raiderIoTimedTenPlus: raider ? numberOrNull(raider.raiderIoTimedTenPlus) : null,
    raiderIoKeyRanges: raider ? normalizeKeyRangeCounts(raider.raiderIoKeyRanges) : normalizeKeyRangeCounts(null),
    raiderIoBestTimedLevel: raider ? numberOrNull(raider.raiderIoBestTimedLevel) : null,
    raiderIoRunSummary: raider ? normalizeRaiderIoRunSummary(raider.raiderIoRunSummary) : emptyRaiderIoRunSummary(),
  };

  if (reason) metadata.reason = reason;
  if (raiderMetadata && raiderMetadata.requestError) metadata.raiderIoReason = raiderMetadata.reason;
  return metadata;
}

function currentRaiderIoScore(body) {
  const seasons = Array.isArray(body && body.mythic_plus_scores_by_season)
    ? body.mythic_plus_scores_by_season
    : [];
  const current = seasons[0] || {};
  return firstNumber(
    current.scores && current.scores.all,
    current.segments && current.segments.all && current.segments.all.score
  );
}

function extractTimedTenPlusCount(body) {
  const explicit = findTimedTenPlusValue(body);
  if (explicit !== null) return explicit;

  const stats = extractTimedKeyStats(body);
  return Number(stats.ranges["10-11"] || 0) + Number(stats.ranges["12-14"] || 0) + Number(stats.ranges["15+"] || 0);
}

function extractTimedKeyStats(body) {
  const ranges = normalizeKeyRangeCounts(null);
  const seen = new Set();
  const levels = [];
  const rangeLevels = MYTHIC_PLUS_RANGES.reduce((summary, range) => {
    summary[range.id] = [];
    return summary;
  }, {});
  let bestTimedLevel = null;

  for (const run of collectRaiderIoRuns(body)) {
    const level = firstNumber(run.mythic_level, run.keystone_level, run.level);
    if (level === null || !isTimedMythicPlusRun(run)) continue;

    const key = [
      run.url || run.keystone_run_id || run.keystoneRunId || "",
      run.completed_at || run.completedAt || "",
      run.dungeon || run.short_name || run.shortName || "",
      level,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    const range = mythicPlusRangeForLevel(level);
    levels.push(level);
    if (range) {
      ranges[range.id] += 1;
      rangeLevels[range.id].push(level);
    }
    bestTimedLevel = bestTimedLevel === null ? level : Math.max(bestTimedLevel, level);
  }

  return {
    ranges,
    bestTimedLevel,
    runSummary: summarizeRaiderIoRunSummary(levels, rangeLevels, bestTimedLevel),
  };
}

function normalizeKeyRangeCounts(value) {
  const source = value && typeof value === "object" ? value : {};
  return MYTHIC_PLUS_RANGES.reduce((ranges, range) => {
    ranges[range.id] = Math.max(0, Math.round(numberOrNull(source[range.id]) || 0));
    return ranges;
  }, {});
}

function mythicPlusRangeForLevel(level) {
  const number = Number(level);
  if (!Number.isFinite(number)) return null;
  return MYTHIC_PLUS_RANGES.find((range) => (
    number >= range.min && (range.max === null || number <= range.max)
  )) || null;
}

function emptyRaiderIoRunSummary() {
  return {
    timedRunCount: 0,
    averageTimedLevel: null,
    medianTimedLevel: null,
    maxTimedLevel: null,
    ranges: MYTHIC_PLUS_RANGES.reduce((summary, range) => {
      summary[range.id] = {
        count: 0,
        averageLevel: null,
        medianLevel: null,
        maxLevel: null,
      };
      return summary;
    }, {}),
  };
}

function normalizeRaiderIoRunSummary(value) {
  const source = value && typeof value === "object" ? value : {};
  const summary = emptyRaiderIoRunSummary();
  summary.timedRunCount = Math.max(0, Math.round(numberOrNull(source.timedRunCount) || 0));
  summary.averageTimedLevel = numberOrNull(source.averageTimedLevel);
  summary.medianTimedLevel = numberOrNull(source.medianTimedLevel);
  summary.maxTimedLevel = numberOrNull(source.maxTimedLevel);
  const sourceRanges = source.ranges && typeof source.ranges === "object" ? source.ranges : {};
  for (const range of MYTHIC_PLUS_RANGES) {
    const entry = sourceRanges[range.id] && typeof sourceRanges[range.id] === "object" ? sourceRanges[range.id] : {};
    summary.ranges[range.id] = {
      count: Math.max(0, Math.round(numberOrNull(entry.count) || 0)),
      averageLevel: numberOrNull(entry.averageLevel),
      medianLevel: numberOrNull(entry.medianLevel),
      maxLevel: numberOrNull(entry.maxLevel),
    };
  }
  return summary;
}

function summarizeRaiderIoRunSummary(levels, rangeLevels, bestTimedLevel) {
  const summary = emptyRaiderIoRunSummary();
  const overall = summarizeTimedLevels(levels, bestTimedLevel);
  summary.timedRunCount = Array.isArray(levels) ? levels.length : 0;
  summary.averageTimedLevel = overall.averageLevel;
  summary.medianTimedLevel = overall.medianLevel;
  summary.maxTimedLevel = overall.maxLevel;
  for (const range of MYTHIC_PLUS_RANGES) {
    const bucketLevels = Array.isArray(rangeLevels && rangeLevels[range.id]) ? rangeLevels[range.id] : [];
    const bucket = summarizeTimedLevels(bucketLevels, bestTimedLevel);
    summary.ranges[range.id] = {
      count: bucketLevels.length,
      averageLevel: bucket.averageLevel,
      medianLevel: bucket.medianLevel,
      maxLevel: bucket.maxLevel,
    };
  }
  return summary;
}

function summarizeTimedLevels(levels, bestTimedLevel) {
  const numbers = (Array.isArray(levels) ? levels : [])
    .map(numberOrNull)
    .filter((value) => value !== null && value > 0)
    .sort((left, right) => left - right);
  if (!numbers.length) {
    return {
      averageLevel: null,
      medianLevel: null,
      maxLevel: numberOrNull(bestTimedLevel),
    };
  }

  return {
    averageLevel: averageNumber(numbers),
    medianLevel: medianNumber(numbers),
    maxLevel: numberOrNull(bestTimedLevel) || numbers[numbers.length - 1],
  };
}

function averageNumber(values) {
  const numbers = (Array.isArray(values) ? values : [])
    .map(numberOrNull)
    .filter((value) => value !== null);
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function medianNumber(values) {
  const numbers = (Array.isArray(values) ? values : [])
    .map(numberOrNull)
    .filter((value) => value !== null)
    .sort((left, right) => left - right);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  if (numbers.length % 2) return numbers[middle];
  return (numbers[middle - 1] + numbers[middle]) / 2;
}

function findTimedTenPlusValue(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);

  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const looksLikeTimedTenPlus = (
      normalized.includes("timed10") ||
      normalized.includes("timedten") ||
      normalized.includes("keystonetenplus") ||
      normalized.includes("keystone10plus")
    );
    if (looksLikeTimedTenPlus) {
      const number = numberOrNull(entry);
      if (number !== null) return number;
    }
  }

  for (const entry of Object.values(value)) {
    const found = findTimedTenPlusValue(entry, seen);
    if (found !== null) return found;
  }

  return null;
}

function collectRaiderIoRuns(body) {
  const keys = [
    "mythic_plus_best_runs",
    "mythic_plus_alternate_runs",
    "mythic_plus_recent_runs",
    "mythic_plus_highest_level_runs",
    "mythic_plus_weekly_highest_level_runs",
    "mythic_plus_previous_weekly_highest_level_runs",
  ];
  return keys.flatMap((key) => Array.isArray(body && body[key]) ? body[key] : []);
}

function isTimedMythicPlusRun(run) {
  const upgrades = firstNumber(run.num_keystone_upgrades, run.keystone_upgrades, run.upgrades);
  if (upgrades !== null) return upgrades > 0;

  const clearTime = firstNumber(run.clear_time_ms, run.clearTimeMs);
  const parTime = firstNumber(run.par_time_ms, run.parTimeMs);
  if (clearTime !== null && parTime !== null) return clearTime <= parTime;

  return false;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number !== null) return number;
  }
  return null;
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
    const nameMatch = await resolveLiveEncounterByName(target && target.bossName);
    if (Number(nameMatch && nameMatch.encounterId) === id) {
      return nameMatch;
    }

    const current = await fetchEncounterZone(id);
    if (!current || !isBetaZone(current.zone)) {
      return { encounterId: id, zone: current && current.zone };
    }

    const liveMatch = await resolveLiveEncounterByName(current.encounterName);
    return liveMatch || { encounterId: id, zone: current.zone };
  }

  const zoneAnchorId = Number(target && target.zoneAnchorEncounterId);
  if (Number.isFinite(zoneAnchorId) && zoneAnchorId > 0) {
    const current = await fetchEncounterZone(zoneAnchorId);
    return {
      encounterId: null,
      zone: current && current.zone,
    };
  }

  return resolveLiveEncounterByName(target && target.bossName);
}

async function resolveLiveEncounterByName(name) {
  const wantedName = normalizeEncounterName(name);
  if (!wantedName) {
    return { encounterId: null, zone: null };
  }

  const zones = await fetchWorldZones();
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
            partitions: normalizeWarcraftLogsPartitions(zone.partitions),
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
            partitions {
              id
              name
              compactName
              default
            }
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
      partitions: normalizeWarcraftLogsPartitions(encounter.zone.partitions),
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
          partitions {
            id
            name
            compactName
            default
          }
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

async function fetchCharacterZoneRankingBatch({ applicant, zoneId, metric, requests }) {
  const rankingRequests = Array.isArray(requests) ? requests : [];
  if (!rankingRequests.length) return [];

  if (!applicant.name || !applicant.realm || !applicant.region || !zoneId) {
    return rankingRequests.map((request) => (
      emptyZoneRanking("Missing character, realm, region, or zone.", false, request.partition)
    ));
  }

  const fields = rankingRequests.map((request, index) => {
    const difficulty = Number(request.difficulty) || 0;
    const partitionId = normalizeWarcraftLogsPartitionId(request.partition);
    const partitionArg = partitionId ? `,\n            partition: ${partitionId}` : "";
    return `
          z${index}: zoneRankings(
            zoneID: $zoneID,
            difficulty: ${difficulty},
            metric: $metric,
            className: $className,
            specName: $specName${partitionArg}
          )`;
  }).join("\n");

  const query = `
    query ApplicantZoneRankingBatch(
      $name: String!,
      $serverSlug: String!,
      $serverRegion: String!,
      $zoneID: Int!,
      $metric: CharacterPageRankingMetricType,
      $className: String,
      $specName: String
    ) {
      characterData {
        character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
          id
          name
${fields}
        }
      }
      rateLimitData {
        limitPerHour
        pointsSpentThisHour
        pointsResetIn
      }
    }
  `;

  let data;
  try {
    data = await warcraftLogsGraphql(query, {
      name: applicant.name,
      serverSlug: slugRealm(applicant.realm),
      serverRegion: applicant.region.toUpperCase(),
      zoneID: Number(zoneId),
      metric,
      className: warcraftLogsClassName(applicant.className) || "",
      specName: applicant.specName || "",
    });
  } catch (error) {
    return rankingRequests.map((request) => (
      emptyZoneRanking(normalizeWarcraftLogsError(error), !isNoDataWarcraftLogsError(error), request.partition)
    ));
  }

  const character = data.characterData && data.characterData.character;
  if (!character) {
    return rankingRequests.map((request) => (
      emptyZoneRanking("Character not found or no public rankings.", false, request.partition)
    ));
  }

  return rankingRequests.map((request, index) => {
    const ranking = normalizeZoneRanking(character[`z${index}`]);
    return {
      exists: ranking.exists,
      bestPerfAvg: ranking.bestPerfAvg,
      medianPerfAvg: ranking.medianPerfAvg,
      kills: ranking.kills,
      encounters: ranking.encounters,
      partition: warcraftLogsPartitionForResult(character[`z${index}`] && character[`z${index}`].partition, request.partition),
      raw: character[`z${index}`] || null,
      rateLimit: data.rateLimitData || null,
    };
  });
}

async function fetchCharacterZoneRanking({ applicant, zoneId, difficulty, metric, partition }) {
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
      $specName: String,
      $partition: Int
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
            specName: $specName,
            partition: $partition
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
      partition: normalizeWarcraftLogsPartitionId(partition),
    });
  } catch (error) {
    return emptyZoneRanking(normalizeWarcraftLogsError(error), !isNoDataWarcraftLogsError(error), partition);
  }

  const character = data.characterData && data.characterData.character;
  if (!character) {
    return emptyZoneRanking("Character not found or no public rankings.", false, partition);
  }

  const ranking = normalizeZoneRanking(character && character.zoneRankings);

  return {
    exists: ranking.exists,
    bestPerfAvg: ranking.bestPerfAvg,
    medianPerfAvg: ranking.medianPerfAvg,
    kills: ranking.kills,
    encounters: ranking.encounters,
    partition: warcraftLogsPartitionForResult(character && character.zoneRankings && character.zoneRankings.partition, partition),
    raw: character ? character.zoneRankings : null,
    rateLimit: data.rateLimitData || null,
  };
}

function emptyZoneRanking(reason, requestError = false, partition = null) {
  return {
    exists: false,
    bestPerfAvg: null,
    medianPerfAvg: null,
    kills: 0,
    encounters: {},
    partition: warcraftLogsPartitionForResult(partition),
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
