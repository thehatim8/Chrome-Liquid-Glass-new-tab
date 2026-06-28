import { storage } from './storage.js';

const SPORTS_CACHE_KEY = 'sportsWidgetCache';

const CRIC_API_SCORE_URL = 'https://api.cricapi.com/v1/cricScore';
const CRIC_API_CURRENT_URL = 'https://api.cricapi.com/v1/currentMatches';
const RAPID_API_HOST = 'cricket-api-free-data.p.rapidapi.com';
const RAPID_API_KEY = 'c50c1e96bcmshe6832aac5f50547p1f7dadjsnc4f27566266d';
const RAPID_API_LIVE_URL = 'https://cricket-api-free-data.p.rapidapi.com/cricket-livescores';
const RAPID_API_UPCOMING_URL = 'https://cricket-api-free-data.p.rapidapi.com/cricket-matches-upcoming';
const RAPID_API_SCHEDULE_URL = 'https://cricket-api-free-data.p.rapidapi.com/cricket-schedule';
const RAPID_API_SERIES_URL = 'https://cricket-api-free-data.p.rapidapi.com/cricket-series';

const FOOTBALL_DATA_BASE = 'https://api.football-data.org/v4';
const DEFAULT_FOOTBALL_API_KEY = '3c226b12077041858fb70b864b69df08';

const DEFAULT_SPORTS_SETTINGS = {
  sport: 'cricket',
  apiKey: '0dc568e8-bca1-480e-bda6-46fe8a4f8007',
  apiKeys: [
    '0dc568e8-bca1-480e-bda6-46fe8a4f8007',
    '5eee9248-7ab3-41f0-a70a-f8cb699c5714',
    '02f80f78-1f29-4ce5-b912-f36d1cf73d32',
    '7a209ecc-49a9-4172-831a-cc255dfd70f1'
  ],
  footballApiKey: '',
  tournament: "ICC Men's T20 World Cup"
};

function resolveSport(settings) {
  return normalizeText(settings?.sport) === 'football' ? 'football' : 'cricket';
}

function normalizeText(v) {
  return String(v || '').toLowerCase().trim();
}

function includesTournament(match, keyword) {
  const key = normalizeText(keyword || '');
  if (!key) return true;
  const text = normalizeText([
    match?.series,
    match?.name,
    match?.matchType,
    match?.status,
    match?.ms
  ].join(' '));
  if (!text) return false;
  if (text.includes(key)) return true;

  const tokens = key
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length >= 3);
  if (!tokens.length) return true;
  const hitCount = tokens.filter((t) => text.includes(t)).length;
  return hitCount >= Math.min(tokens.length, 3);
}

function isLiveStatus(status) {
  const s = normalizeText(status);
  return (
    s.includes('live') ||
    s.includes('break') ||
    s.includes('innings') ||
    s.includes('stumps') ||
    s.includes('yet to bat')
  );
}

function toTeamLines(match) {
  const t1 = match?.t1 || (Array.isArray(match?.teams) ? match.teams[0] : 'Team A') || 'Team A';
  const t2 = match?.t2 || (Array.isArray(match?.teams) ? match.teams[1] : 'Team B') || 'Team B';
  const t1s = match?.t1s || '';
  const t2s = match?.t2s || '';

  const scores = Array.isArray(match?.score) ? match.score : [];
  const s1 = scores.find((s) => normalizeText(s?.inning).includes(normalizeText(t1))) || scores[0] || null;
  const s2 = scores.find((s) => normalizeText(s?.inning).includes(normalizeText(t2))) || scores[1] || null;

  function scoreText(s) {
    if (!s) return '-';
    const r = s?.r ?? '-';
    const w = s?.w ?? '-';
    const o = s?.o ?? '-';
    return `${r}/${w} (${o})`;
  }

  return {
    team1: `${t1}: ${t1s || scoreText(s1)}`,
    team2: `${t2}: ${t2s || scoreText(s2)}`
  };
}

function statusRank(match) {
  const s = normalizeText(match?.status || match?.ms);
  if (isLiveStatus(s)) return 0;
  if (s.includes('yet to start') || s.includes('upcoming')) return 1;
  return 2;
}

function pickBestMatch(matches) {
  if (!matches.length) return null;
  return matches.slice().sort((a, b) => {
    const rs = statusRank(a) - statusRank(b);
    if (rs !== 0) return rs;
    const ta = Date.parse(a?.dateTimeGMT || a?.date || '') || 0;
    const tb = Date.parse(b?.dateTimeGMT || b?.date || '') || 0;
    return Math.abs(ta - Date.now()) - Math.abs(tb - Date.now());
  })[0];
}

function renderState(container, patch) {
  if (!container) return;
  const compEl = container.querySelector('#sportsCompetition');
  const statusEl = container.querySelector('#sportsStatus');
  const team1El = container.querySelector('#sportsTeam1');
  const team2El = container.querySelector('#sportsTeam2');
  const metaEl = container.querySelector('#sportsMeta');

  if (compEl && typeof patch.competition === 'string') compEl.textContent = patch.competition;
  if (statusEl && typeof patch.status === 'string') statusEl.textContent = patch.status;
  if (team1El && typeof patch.team1 === 'string') team1El.textContent = patch.team1;
  if (team2El && typeof patch.team2 === 'string') team2El.textContent = patch.team2;
  if (metaEl && typeof patch.meta === 'string') metaEl.textContent = patch.meta;
}

function dedupeMatches(matches) {
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    const id = String(m?.id || `${m?.name || ''}-${m?.dateTimeGMT || m?.date || ''}`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(m);
  }
  return out;
}

function flattenAnyArray(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  const out = [];
  Object.keys(input).forEach((k) => {
    const v = input[k];
    if (Array.isArray(v)) out.push(...v);
  });
  return out;
}

function firstDefined(...vals) {
  for (const v of vals) {
    if (typeof v !== 'undefined' && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

function normalizeRapidScoreText(v) {
  if (typeof v === 'string') return v.trim();
  if (!v || typeof v !== 'object') return '';
  const r = firstDefined(v.runs, v.run, v.r);
  const w = firstDefined(v.wickets, v.wicket, v.w);
  const o = firstDefined(v.overs, v.over, v.o);
  if (r || w || o) return `${r || '-'}${w || w === 0 ? `/${w}` : ''}${o ? ` (${o})` : ''}`.trim();
  return '';
}

function normalizeRapidMatch(m) {
  const teams = Array.isArray(m?.teams) ? m.teams : [];
  const t1 = firstDefined(m?.team1, m?.teamOne, m?.t1, teams[0], m?.homeTeam, m?.teamA, 'Team A');
  const t2 = firstDefined(m?.team2, m?.teamTwo, m?.t2, teams[1], m?.awayTeam, m?.teamB, 'Team B');
  const t1s = normalizeRapidScoreText(firstDefined(m?.team1Score, m?.t1s, m?.score1, m?.homeScore));
  const t2s = normalizeRapidScoreText(firstDefined(m?.team2Score, m?.t2s, m?.score2, m?.awayScore));
  const series = firstDefined(m?.series, m?.seriesName, m?.competition, m?.league, m?.tournament, 'Cricket');
  const status = firstDefined(m?.status, m?.matchStatus, m?.state, m?.ms, 'Match update unavailable');
  const name = firstDefined(m?.name, m?.matchName, `${t1} vs ${t2}`);
  const venue = firstDefined(m?.venue, m?.ground, m?.stadium);
  const date = firstDefined(m?.date, m?.dateTimeGMT, m?.startTime, m?.matchDate);
  const matchType = firstDefined(m?.matchType, m?.format, m?.type);
  return {
    id: firstDefined(m?.id, m?.matchId, m?._id, name),
    t1,
    t2,
    t1s,
    t2s,
    series,
    status,
    name,
    venue,
    date,
    dateTimeGMT: firstDefined(m?.dateTimeGMT, m?.startTime, m?.date),
    matchType
  };
}

function resolveRapidSeriesName(seriesPayload, keyword) {
  const list = Array.isArray(seriesPayload?.response) ? seriesPayload.response : [];
  if (!list.length) return '';
  const key = String(keyword || '').trim();
  if (!key) return '';

  const scored = list
    .map((it) => {
      const series = String(it?.series || '').trim();
      const text = normalizeText([series, it?.title, it?.dates].join(' '));
      if (!series || !text) return null;

      let score = 0;
      if (text.includes(normalizeText(key))) score += 10;

      const tokens = normalizeText(key)
        .split(/\s+/)
        .map((t) => t.replace(/[^a-z0-9]/g, ''))
        .filter((t) => t.length >= 3);
      tokens.forEach((t) => {
        if (text.includes(t)) score += 1;
      });

      // Prefer the specific 2026 edition when both generic and year-specific exist.
      if (text.includes('2026')) score += 2;
      return { series, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!scored.length || scored[0].score <= 0) return '';
  return scored[0].series;
}

async function fetchMatchesFrom(url, apiKey) {
  const candidates = [
    `${url}?apikey=${encodeURIComponent(apiKey)}`,
    `${url}?apikey=${encodeURIComponent(apiKey)}&offset=0`
  ];

  let lastErr = null;
  for (const full of candidates) {
    try {
      const res = await fetch(full, {
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const ok = json?.status !== 'failure';
      if (!ok) {
        const reason = json?.reason || json?.message || 'API returned failure';
        throw new Error(reason);
      }

      const list = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.matches)
          ? json.matches
          : Array.isArray(json?.matchList)
            ? json.matchList
            : [];
      return list;
    } catch (err) {
      lastErr = err;
    }
  }
  throw (lastErr || new Error('Unable to load CricAPI endpoint'));
}

async function fetchRapidEndpoint(url) {
  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'x-rapidapi-key': RAPID_API_KEY,
      'x-rapidapi-host': RAPID_API_HOST
    }
  });
  if (!res.ok) throw new Error(`RapidAPI HTTP ${res.status}`);
  return await res.json();
}

function extractRapidMatches(payload) {
  const primary = firstDefined(payload?.data, payload?.response, payload?.matches, payload?.matchList, payload?.result);
  const list = flattenAnyArray(primary);
  if (list.length) return list;
  const backup = flattenAnyArray(payload);
  return backup;
}

async function fetchRapidFallbackMatches(settings) {
  const [seriesPayload, livePayload, upcomingPayload, schedulePayload] = await Promise.allSettled([
    fetchRapidEndpoint(RAPID_API_SERIES_URL),
    fetchRapidEndpoint(RAPID_API_LIVE_URL),
    fetchRapidEndpoint(RAPID_API_UPCOMING_URL),
    fetchRapidEndpoint(RAPID_API_SCHEDULE_URL)
  ]);

  const liveList = livePayload.status === 'fulfilled' ? extractRapidMatches(livePayload.value) : [];
  const upcomingList = upcomingPayload.status === 'fulfilled' ? extractRapidMatches(upcomingPayload.value) : [];
  const scheduleList = schedulePayload.status === 'fulfilled' ? extractRapidMatches(schedulePayload.value) : [];
  const all = [...liveList, ...upcomingList, ...scheduleList].map(normalizeRapidMatch);
  const deduped = dedupeMatches(all);
  const resolvedSeries =
    seriesPayload.status === 'fulfilled'
      ? resolveRapidSeriesName(seriesPayload.value, settings?.tournament)
      : '';
  if (deduped.length) return { matches: deduped, resolvedSeries };

  const reasonLive = livePayload.status === 'rejected' ? String(livePayload.reason?.message || '') : '';
  const reasonUpcoming = upcomingPayload.status === 'rejected' ? String(upcomingPayload.reason?.message || '') : '';
  const reasonSchedule = schedulePayload.status === 'rejected' ? String(schedulePayload.reason?.message || '') : '';
  const reasonSeries = seriesPayload.status === 'rejected' ? String(seriesPayload.reason?.message || '') : '';
  const reason = [reasonLive, reasonUpcoming, reasonSchedule].filter(Boolean).join(' | ');
  throw new Error(reason || reasonSeries || `No RapidAPI matches for ${settings?.tournament || 'selected tournament'}`);
}

function normalizeApiKeys(settings) {
  const list = [];
  const pushKey = (v) => {
    const key = String(v || '').trim();
    if (key) list.push(key);
  };

  if (Array.isArray(settings?.apiKeys)) {
    settings.apiKeys.forEach(pushKey);
  } else if (typeof settings?.apiKeys === 'string') {
    settings.apiKeys.split(/\r?\n/).forEach(pushKey);
  }

  pushKey(settings?.apiKey);
  pushKey(DEFAULT_SPORTS_SETTINGS.apiKey);

  return Array.from(new Set(list));
}

function looksLikeRateLimitError(err) {
  const text = normalizeText(err?.message || err);
  return (
    text.includes('limit') ||
    text.includes('quota') ||
    text.includes('too many') ||
    text.includes('429') ||
    text.includes('blocked')
  );
}

async function fetchCricScores(settings) {
  const apiKeys = normalizeApiKeys(settings);
  if (!apiKeys.length) throw new Error('Missing CricAPI key');

  let lastErr = null;

  for (let i = 0; i < apiKeys.length; i++) {
    const apiKey = apiKeys[i];
    let scoreMatches = [];
    let currentMatches = [];
    let scoreErr = null;
    let currentErr = null;

    try {
      scoreMatches = await fetchMatchesFrom(CRIC_API_SCORE_URL, apiKey);
    } catch (err) {
      scoreErr = err;
    }

    try {
      currentMatches = await fetchMatchesFrom(CRIC_API_CURRENT_URL, apiKey);
    } catch (err) {
      currentErr = err;
    }

    const combined = dedupeMatches([...currentMatches, ...scoreMatches]);
    if (combined.length) return { matches: combined, usedKey: apiKey, keyIndex: i };

    const candidateErr = currentErr || scoreErr || new Error('No matches in CricAPI response');
    lastErr = candidateErr;
    if (!looksLikeRateLimitError(candidateErr) && i < apiKeys.length - 1) continue;
  }

  throw (lastErr || new Error('No matches in CricAPI response'));
}

function footballApiKey(settings) {
  return String(settings?.footballApiKey || '').trim() || DEFAULT_FOOTBALL_API_KEY;
}

// Maps common keywords to football-data.org competition codes. Users can also
// type a code directly (e.g. "WC", "PL"). See football-data.org/coverage.
const FOOTBALL_COMPETITION_CODES = {
  'world cup': 'WC',
  'fifa world cup': 'WC',
  'champions league': 'CL',
  'uefa champions league': 'CL',
  'premier league': 'PL',
  'epl': 'PL',
  'english premier league': 'PL',
  'la liga': 'PD',
  'primera division': 'PD',
  'laliga': 'PD',
  'serie a': 'SA',
  'bundesliga': 'BL1',
  'ligue 1': 'FL1',
  'eredivisie': 'DED',
  'primeira liga': 'PPL',
  'portuguese liga': 'PPL',
  'championship': 'ELC',
  'efl championship': 'ELC',
  'european championship': 'EC',
  'euros': 'EC',
  'euro': 'EC',
  'copa libertadores': 'CLI',
  'brasileirao': 'BSA',
  'campeonato brasileiro': 'BSA'
};

function resolveCompetitionCode(keyword) {
  const key = normalizeText(keyword);
  if (!key) return '';
  if (FOOTBALL_COMPETITION_CODES[key]) return FOOTBALL_COMPETITION_CODES[key];
  // Allow typing a raw code such as "WC" or "BL1".
  if (/^[a-z]{2}[a-z0-9]?$/i.test(key)) return key.toUpperCase();
  // Partial match against known names (e.g. "champions" -> CL).
  const hit = Object.keys(FOOTBALL_COMPETITION_CODES).find(
    (name) => name.includes(key) || key.includes(name)
  );
  return hit ? FOOTBALL_COMPETITION_CODES[hit] : '';
}

async function fetchFootballData(path, apiKey) {
  const res = await fetch(`${FOOTBALL_DATA_BASE}${path}`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'X-Auth-Token': apiKey
    }
  });
  let json = null;
  try {
    json = await res.json();
  } catch (err) {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.message || `football-data.org HTTP ${res.status}`;
    throw new Error(msg);
  }
  return Array.isArray(json?.matches) ? json.matches : [];
}

function normalizeFootballMatch(m) {
  const status = String(m?.status || '').toUpperCase();
  const liveStatuses = ['IN_PLAY', 'PAUSED', 'LIVE'];
  const finishedStatuses = ['FINISHED', 'AWARDED'];

  const home = firstDefined(m?.homeTeam?.shortName, m?.homeTeam?.name, m?.homeTeam?.tla, 'Home');
  const away = firstDefined(m?.awayTeam?.shortName, m?.awayTeam?.name, m?.awayTeam?.tla, 'Away');
  const ft = m?.score?.fullTime || {};
  const hg = ft?.home;
  const ag = ft?.away;
  const hasHome = hg !== null && typeof hg !== 'undefined';
  const hasAway = ag !== null && typeof ag !== 'undefined';

  let statusText;
  if (liveStatuses.includes(status)) {
    statusText = `LIVE${typeof m?.minute !== 'undefined' && m?.minute !== null ? ` · ${m.minute}'` : status === 'PAUSED' ? ' · Half Time' : ''}`;
  } else if (finishedStatuses.includes(status)) {
    statusText = 'Full Time';
  } else {
    let when = '';
    if (m?.utcDate) {
      const dt = new Date(m.utcDate);
      if (!Number.isNaN(dt.getTime())) {
        when = dt.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    }
    const label = status === 'POSTPONED' ? 'Postponed' : status === 'SUSPENDED' ? 'Suspended' : 'Upcoming';
    statusText = `${label}${when ? ` · ${when}` : ''}`;
  }

  const competition = firstDefined(m?.competition?.name, 'Football');
  const stageGroup = [
    m?.stage ? String(m.stage).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : '',
    m?.group || (m?.matchday ? `Matchday ${m.matchday}` : '')
  ].filter(Boolean).join(' · ');

  return {
    id: firstDefined(m?.id, `${home}-${away}-${m?.utcDate || ''}`),
    t1: home,
    t2: away,
    t1s: hasHome ? String(hg) : '',
    t2s: hasAway ? String(ag) : '',
    series: competition,
    status: statusText,
    name: `${home} vs ${away}`,
    venue: firstDefined(m?.venue, ''),
    date: m?.utcDate || '',
    dateTimeGMT: m?.utcDate || '',
    matchType: stageGroup
  };
}

async function fetchFootballMatches(settings) {
  const apiKey = footballApiKey(settings);
  if (!apiKey) throw new Error('Add your football-data.org API token in settings');

  const keyword = String(settings?.tournament || '').trim();
  const code = resolveCompetitionCode(keyword);

  // With a competition keyword/code, pull that competition's whole current
  // season and let pickBestMatch sort to live > next upcoming > most recent.
  // Without one, fall back to today's matches across subscribed competitions.
  const path = code ? `/competitions/${encodeURIComponent(code)}/matches` : '/matches';
  const matches = await fetchFootballData(path, apiKey);
  const normalized = matches.map(normalizeFootballMatch);
  const deduped = dedupeMatches(normalized);
  if (deduped.length) return deduped;
  throw new Error(
    code ? `No matches found for "${keyword}" right now` : 'No matches today for your subscribed competitions'
  );
}

function buildView(match, settings) {
  if (!match) {
    return {
      competition: settings?.tournament || DEFAULT_SPORTS_SETTINGS.tournament,
      status: 'No match found right now',
      team1: '-',
      team2: '-',
      meta: 'Try a shorter tournament keyword in settings'
    };
  }

  const teams = toTeamLines(match);
  const status = match?.status || match?.ms || 'Match update unavailable';
  const competition = match?.series || settings?.tournament || 'Cricket';
  const meta = [match?.matchType, match?.venue, match?.date].filter(Boolean).join(' | ');

  return {
    competition,
    status,
    team1: teams.team1,
    team2: teams.team2,
    meta
  };
}

export function initSportsWidget(appState) {
  const container = document.getElementById('widget-sports');
  if (!container) return;

  const refreshBtn = document.getElementById('sportsRefresh');

  // Cache per sport so each sport's last refreshed scores stay put until that
  // sport is refreshed again (switching sports won't wipe the other's scores).
  async function saveCache(view, tournament, sport) {
    try {
      const res = await storage.get([SPORTS_CACHE_KEY]);
      const existing =
        res?.[SPORTS_CACHE_KEY] && typeof res[SPORTS_CACHE_KEY] === 'object'
          ? res[SPORTS_CACHE_KEY]
          : {};
      const bySport =
        existing.bySport && typeof existing.bySport === 'object' ? existing.bySport : {};
      bySport[sport || 'cricket'] = {
        view,
        tournament: tournament || '',
        cachedAt: Date.now()
      };
      await storage.set({ [SPORTS_CACHE_KEY]: { ...existing, bySport } });
    } catch (err) {
      // Ignore cache write failures.
    }
  }

  async function renderFromCacheIfAvailable() {
    try {
      const settings = appState?.sportsSettings || DEFAULT_SPORTS_SETTINGS;
      const sport = resolveSport(settings);
      const currentTournament = settings?.tournament || '';
      const res = await storage.get([SPORTS_CACHE_KEY]);
      const cache = res?.[SPORTS_CACHE_KEY];
      if (!cache || typeof cache !== 'object') return false;

      // Prefer the per-sport entry; fall back to the legacy flat shape.
      let entry = cache.bySport ? cache.bySport[sport] : null;
      if (!entry && String(cache.sport || 'cricket') === sport) entry = cache;

      const cachedView = entry?.view;
      if (!cachedView || typeof cachedView !== 'object') return false;
      const cachedTournament = String(entry?.tournament || '').trim();
      if (cachedTournament && cachedTournament !== currentTournament) return false;
      renderState(container, cachedView);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function refreshCricket(settings) {
    try {
      renderState(container, { competition: settings.tournament, status: 'Loading live scores...' });
      const { matches: allMatches, usedKey } = await fetchCricScores(settings);
      const filtered = allMatches.filter((m) => includesTournament(m, settings?.tournament));
      const pool = filtered.length ? filtered : allMatches;
      const match = pickBestMatch(pool);
      const view = buildView(match, settings);
      renderState(container, view);
      await saveCache(view, settings?.tournament || DEFAULT_SPORTS_SETTINGS.tournament, 'cricket');

      if (usedKey && appState?.sportsSettings) {
        appState.sportsSettings.apiKey = usedKey;
      }
    } catch (err) {
      try {
        const rapid = await fetchRapidFallbackMatches(settings);
        const rapidMatches = rapid?.matches || [];
        const resolvedTournament = rapid?.resolvedSeries || settings?.tournament;
        const filtered = rapidMatches.filter((m) => includesTournament(m, resolvedTournament));
        const pool = filtered.length ? filtered : rapidMatches;
        const match = pickBestMatch(pool);
        const view = buildView(match, { ...settings, tournament: resolvedTournament });
        if (!match && resolvedTournament) view.competition = resolvedTournament;
        view.meta = [view.meta, 'Source: RapidAPI fallback'].filter(Boolean).join(' | ');
        renderState(container, view);
        await saveCache(view, resolvedTournament || DEFAULT_SPORTS_SETTINGS.tournament, 'cricket');
      } catch (rapidErr) {
        // Keep the last successfully loaded scores instead of nulling them out.
        const restored = await renderFromCacheIfAvailable();
        if (restored) return;
        const hasKey = normalizeApiKeys(settings).length > 0;
        const details = String(err?.message || '').trim();
        const fallbackDetails = String(rapidErr?.message || '').trim();
        renderState(container, {
          competition: settings?.tournament || DEFAULT_SPORTS_SETTINGS.tournament,
          status: hasKey ? 'Failed to load scores' : 'Add CricAPI key in settings',
          team1: '-',
          team2: '-',
          meta: [
            details || 'All configured CricAPI keys failed.',
            fallbackDetails ? `RapidAPI: ${fallbackDetails}` : 'RapidAPI fallback unavailable.'
          ].join(' | ')
        });
      }
    }
  }

  async function refreshFootball(settings) {
    const label = settings?.tournament || 'Football';
    try {
      renderState(container, { competition: label, status: 'Loading live scores...' });
      const allMatches = await fetchFootballMatches(settings);
      const filtered = allMatches.filter((m) => includesTournament(m, settings?.tournament));
      const pool = filtered.length ? filtered : allMatches;
      const match = pickBestMatch(pool);
      const view = buildView(match, settings);
      if (!match) view.competition = label;
      renderState(container, view);
      await saveCache(view, settings?.tournament || '', 'football');
    } catch (err) {
      // Keep the last successfully loaded scores instead of nulling them out.
      const restored = await renderFromCacheIfAvailable();
      if (restored) return;
      renderState(container, {
        competition: label,
        status: 'Failed to load football scores',
        team1: '-',
        team2: '-',
        meta: String(err?.message || 'Football API request failed')
      });
    }
  }

  async function refresh() {
    const settings = appState?.sportsSettings || DEFAULT_SPORTS_SETTINGS;
    if (resolveSport(settings) === 'football') {
      await refreshFootball(settings);
    } else {
      await refreshCricket(settings);
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      void refresh();
    });
  }

  void (async () => {
    const hasCache = await renderFromCacheIfAvailable();
    if (hasCache) return;
    renderState(container, {
      competition: (appState?.sportsSettings?.tournament || DEFAULT_SPORTS_SETTINGS.tournament),
      status: 'Press Refresh to load scores',
      team1: '-',
      team2: '-',
      meta: 'Manual refresh mode enabled to save API credits'
    });
  })();
}


