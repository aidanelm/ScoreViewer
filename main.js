/*
Author: aidanelm
File: main.js
Date: 2026-09-15
Description: JavaScript functionality for ScoreViewer page.
Uses Scoreboard API for today's games with Schedule API fallbacks.
*/

const ESPN_API_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const recordCache = new Map();

/**
 * Helper to parse score value regardless of structure returned.
 */
function parseScore(competitor) {
  if (competitor.score === undefined || competitor.score === null) return "—";
  if (typeof competitor.score === "object") {
    return competitor.score.displayValue ?? competitor.score.value ?? "—";
  }
  return competitor.score;
}

/**
 * Helper to generate status text (Final, Innings, Quarters/Periods).
 */
function getStatusDisplay(status) {
  const state = status?.type?.state;
  const detail = status?.type?.shortDetail || status?.type?.detail || "";

  if (state === "post") {
    return detail.includes("OT") ? "FINAL / OT" : "FINAL";
  }

  if (state === "in") {
    const period = status?.period;
    const lowerDetail = detail.toLowerCase();

    if (
      ["top", "bot", "mid", "end"].some((term) => lowerDetail.includes(term))
    ) {
      if (lowerDetail.includes("top")) return `Top ${period}`;
      if (lowerDetail.includes("bot")) return `Bottom ${period}`;
      if (lowerDetail.includes("mid")) return `Mid ${period}`;
      if (lowerDetail.includes("end")) return `End ${period}`;
    }

    return detail || (period ? `P${period}` : "LIVE");
  }

  return "";
}

/**
 * Checks if a given date string matches today's date in local time.
 */
function isToday(dateString) {
  const gameDate = new Date(dateString);
  const today = new Date();
  return (
    gameDate.getFullYear() === today.getFullYear() &&
    gameDate.getMonth() === today.getMonth() &&
    gameDate.getDate() === today.getDate()
  );
}

/**
 * Fetches true team record from ESPN's primary team endpoint.
 */
async function fetchTrueTeamRecord(sport, league, teamId, defaultRecord) {
  if (!teamId) return defaultRecord;

  const cacheKey = `${sport}-${league}-${teamId}`;
  if (recordCache.has(cacheKey)) return recordCache.get(cacheKey);

  try {
    const res = await fetch(
      `${ESPN_API_BASE}/${sport}/${league}/teams/${teamId}`,
    );
    if (!res.ok) return defaultRecord;

    const data = await res.json();
    const summary =
      data.team?.record?.items?.[0]?.summary || data.team?.recordSummary;

    if (summary && summary !== "0-0" && summary !== "0-0-0") {
      recordCache.set(cacheKey, summary);
      return summary;
    }
  } catch (err) {
    console.warn(`Record fetch failed for team ${teamId}:`, err);
  }

  return defaultRecord;
}

/**
 * Resolves a team's record cleanly with direct API fallback.
 */
async function resolveTeamRecord(competitor, sport, league) {
  const defaultRecord =
    league?.toLowerCase() === "nhl" || sport?.toLowerCase() === "hockey"
      ? "0-0-0"
      : "0-0";
  const summary = competitor?.records?.[0]?.summary || competitor?.record;

  if (summary && summary !== "0-0" && summary !== "0-0-0") {
    return summary;
  }

  const teamId = competitor?.team?.id || competitor?.id;
  return await fetchTrueTeamRecord(sport, league, teamId, defaultRecord);
}

/**
 * Render matchup into DOM target element.
 */
async function renderGame(element, game, sport, league) {
  const competition = game.competitions?.[0];
  if (!competition) {
    element.textContent = "Unable to load.";
    return;
  }

  const competitors = competition.competitors || [];
  const away = competitors.find((comp) => comp.homeAway === "away");
  const home = competitors.find((comp) => comp.homeAway === "home");

  if (!away || !home) {
    element.textContent = "Unable to load.";
    return;
  }

  const [awayRecord, homeRecord] = await Promise.all([
    resolveTeamRecord(away, sport, league),
    resolveTeamRecord(home, sport, league),
  ]);

  const gameDate = new Date(game.date);
  const state = competition.status?.type?.state;
  const isLive = state === "in";
  const isFinal = state === "post";
  const isUpcoming = state === "pre";

  const date = gameDate.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const time = gameDate.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const awayScore = isUpcoming ? "—" : parseScore(away);
  const homeScore = isUpcoming ? "—" : parseScore(home);
  const gameStatusText = getStatusDisplay(competition.status);

  let infoContentHTML = "";
  if (isLive) {
    infoContentHTML = `<div class="status-live">${gameStatusText}</div>`;
  } else if (isFinal) {
    infoContentHTML = `<div class="game-status">${gameStatusText}</div>`;
  } else {
    infoContentHTML = `
      <div>${date} · ${time}</div>
      ${gameStatusText ? `<div class="game-status">${gameStatusText}</div>` : ""}
    `;
  }

  element.classList.add("d-flex", "flex-column", "h-100");

  element.innerHTML = `
    <div class="d-flex align-items-center justify-content-between">
      <div class="team text-center flex-fill">
        <div class="score">${awayScore}</div>
        <div class="team-name-large">
          ${away.team.shortDisplayName || away.team.displayName}
        </div>
        <div class="team-record small">${awayRecord}</div>
      </div>

      <div class="at px-2">@</div>

      <div class="team text-center flex-fill">
        <div class="score">${homeScore}</div>
        <div class="team-name-large">
          ${home.team.shortDisplayName || home.team.displayName}
        </div>
        <div class="team-record small">${homeRecord}</div>
      </div>
    </div>

    <div class="game-info text-center mt-auto pt-2">
      ${infoContentHTML}
    </div>
  `;
}

/**
 * Fallback loader using the team-specific Schedule API.
 */
async function loadFromSchedule(id, sport, league, team) {
  const element = document.getElementById(id);
  const response = await fetch(
    `${ESPN_API_BASE}/${sport}/${league}/teams/${team}/schedule`,
  );

  if (!response.ok) {
    throw new Error(`Schedule API HTTP ${response.status}`);
  }

  const data = await response.json();
  const games = data.events || [];
  const now = Date.now();

  const game =
    games.find((g) => g.competitions?.[0]?.status?.type?.state === "in") ||
    games.find((g) => new Date(g.date).getTime() >= now) ||
    games[games.length - 1];

  if (!game) {
    element.textContent = "No games.";
    return;
  }

  await renderGame(element, game, sport, league);
}

/**
 * Primary loader: Checks today's Scoreboard API first, then falls back to Schedule API.
 */
async function load(id, sport, league, team) {
  const element = document.getElementById(id);
  if (!element) return;

  try {
    const response = await fetch(
      `${ESPN_API_BASE}/${sport}/${league}/scoreboard`,
    );

    if (!response.ok) {
      return await loadFromSchedule(id, sport, league, team);
    }

    const data = await response.json();
    const events = data.events || [];
    const targetTeam = String(team).toLowerCase();

    const teamGame = events.find((event) => {
      const competitors = event.competitions?.[0]?.competitors || [];
      return competitors.some((competitor) => {
        const cTeam = competitor.team || {};
        return (
          String(cTeam.id).toLowerCase() === targetTeam ||
          String(cTeam.abbreviation).toLowerCase() === targetTeam
        );
      });
    });

    if (teamGame && isToday(teamGame.date)) {
      return await renderGame(element, teamGame, sport, league);
    }

    return await loadFromSchedule(id, sport, league, team);
  } catch (error) {
    try {
      await loadFromSchedule(id, sport, league, team);
    } catch (fallbackError) {
      console.error(`Both APIs failed for ${sport}/${league}:`, fallbackError);
      element.textContent = "Unable to load.";
    }
  }
}

/*
 * TEAM SCHEDULE CALLS
 */
load("phillies", "baseball", "mlb", "phi");
load("sixers", "basketball", "nba", "phi");
load("eagles", "football", "nfl", "phi");
load("flyers", "hockey", "nhl", "phi");
load("sju", "basketball", "mens-college-basketball", 2603);
load("wcu", "football", "college-football", 223);
