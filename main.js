/*
Author: aidanelm
File: main.js
Date: 2026-09-15
Description: JavaScript functionality for ScoreViewer page.
Uses Scoreboard API for today's games with Schedule API fallbacks.
*/

const ESPN_API_BASE = "https://site.api.espn.com/apis/site/v2/sports";

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
 * Returns empty string if the game hasn't started yet.
 */
function getStatusDisplay(status) {
  const state = status?.type?.state;
  const detail = status?.type?.shortDetail || status?.type?.detail || "";

  // 1. Post-Game States
  if (state === "post") {
    return detail.includes("OT") ? "FINAL / OT" : "FINAL";
  }

  // 2. In-Game (Live) States
  if (state === "in") {
    const period = status?.period;

    // Baseball logic (Innings)
    if (
      detail.toLowerCase().includes("top") ||
      detail.toLowerCase().includes("bot") ||
      detail.toLowerCase().includes("mid") ||
      detail.toLowerCase().includes("end")
    ) {
      if (detail.toLowerCase().includes("top")) return `Top ${period}`;
      if (detail.toLowerCase().includes("bot")) return `Bottom ${period}`;
      if (detail.toLowerCase().includes("mid")) return `Mid ${period}`;
      if (detail.toLowerCase().includes("end")) return `End ${period}`;
    }

    // Default short detail provided by ESPN (e.g., "3rd 4:12", "Halftime")
    if (detail) return detail;

    // Fallback if detail string isn't present
    return period ? `P${period}` : "LIVE";
  }

  // 3. Pre-Game States
  return "";
}

/**
 * Helper to check if a given date string matches today's date in local time.
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
 * Helper to format a Date object into ESPN's YYYYMMDD string format.
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/**
 * Helper to get default record based on league/sport.
 */
function getDefaultRecord(sport, league) {
  return league?.toLowerCase() === "nhl" || sport?.toLowerCase() === "hockey"
    ? "0-0-0"
    : "0-0";
}

/**
 * Fallback loader using the team-specific Schedule API.
 */
async function loadFromSchedule(id, sport, league, team) {
  const element = document.getElementById(id);
  const url = `${ESPN_API_BASE}/${sport}/${league}/teams/${team}/schedule`;

  const response = await fetch(url);
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

  // Attach root-level team record summary to the event competitors if missing
  const rootRecord =
    data.team?.recordSummary || data.requestedItem?.record?.summary;
  if (rootRecord && game.competitions?.[0]?.competitors) {
    const targetTeam = String(team).toLowerCase();
    game.competitions[0].competitors.forEach((comp) => {
      const cTeam = comp.team || {};
      const isTarget =
        String(cTeam.id).toLowerCase() === targetTeam ||
        String(cTeam.abbreviation).toLowerCase() === targetTeam;

      if (isTarget && (!comp.records || comp.records.length === 0)) {
        comp.records = [{ type: "overall", summary: rootRecord }];
      }
    });
  }

  renderGame(element, game, sport, league);
}

/**
 * Render matchup into DOM target element.
 */
function renderGame(element, game, sport, league) {
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

  const defaultRecord = getDefaultRecord(sport, league);

  // Extract record summary, falling back to default record format if missing
  const awayRecord =
    away.records?.find((r) => r.type === "total" || r.type === "overall")
      ?.summary ||
    away.records?.[0]?.summary ||
    defaultRecord;

  const homeRecord =
    home.records?.find((r) => r.type === "total" || r.type === "overall")
      ?.summary ||
    home.records?.[0]?.summary ||
    defaultRecord;

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

  // Build bottom info section: Hide date/time if live or final
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

  // Ensure inner element is flexible to support equal-height cards
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
 * Primary loader: Checks today's Scoreboard API first.
 * Reverts to Schedule API if no game is played today, or on HTTP errors.
 */
async function load(id, sport, league, team) {
  const element = document.getElementById(id);

  if (!element) {
    console.warn(`Unable to find element with ID "${id}".`);
    return;
  }

  try {
    const url = `${ESPN_API_BASE}/${sport}/${league}/scoreboard`;
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(
        `Scoreboard HTTP ${response.status} for ${sport}/${league}. Reverting to schedule.`,
      );
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
      return renderGame(element, teamGame, sport, league);
    }

    return await loadFromSchedule(id, sport, league, team);
  } catch (error) {
    console.warn(
      `Scoreboard fetch failed (${error.message}). Reverting to schedule...`,
    );
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
