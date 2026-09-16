/*
Author: aidanelm
File: main.js
Date: 2026-09-15
Description: JavaScript functionality for ScoreViewer page.
Uses Scoreboard API for today's games with Schedule API fallbacks, 
alongside a dedicated scoreboard loader for Philadelphia Union.
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

  renderGame(element, game);
}

/**
 * Render matchup into DOM target element.
 */
function renderGame(element, game) {
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

  const gameDate = new Date(game.date);
  const now = new Date();

  const date = gameDate.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const time = gameDate.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const isUpcoming = gameDate > now && competition.status?.type?.state !== "in";

  const awayScore = isUpcoming ? "—" : parseScore(away);
  const homeScore = isUpcoming ? "—" : parseScore(home);

  element.innerHTML = `
    <div class="d-flex align-items-center">
      <div class="team text-center">
        <div class="score">${awayScore}</div>
        <div class="team-name-large">
          ${away.team.shortDisplayName || away.team.displayName}
        </div>
      </div>

      <div class="at">@</div>

      <div class="team text-center">
        <div class="score">${homeScore}</div>
        <div class="team-name-large">
          ${home.team.shortDisplayName || home.team.displayName}
        </div>
      </div>
    </div>

    <div class="game-info">
      ${date} · ${time}
    </div>
  `;
}

/**
 * Primary loader: Checks today's Scoreboard API first.
 * Reverts to Schedule API if no game is played *today*, or on HTTP errors.
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
      return renderGame(element, teamGame);
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

/**
 * Load and display the next/current Philadelphia Union match.
 * Custom implementation required for MLS date-ranged scoreboard filtering.
 */
async function loadUnion(id) {
  const element = document.getElementById(id);

  if (!element) {
    console.warn(`Unable to find element with ID "${id}".`);
    return;
  }

  const UNION_ID = "10739";
  const ESPN_SCOREBOARD_URL = `${ESPN_API_BASE}/soccer/usa.1/scoreboard`;

  try {
    const now = new Date();
    const startDate = formatDate(now);

    const endDateObject = new Date(now);
    endDateObject.setDate(endDateObject.getDate() + 30);
    const endDate = formatDate(endDateObject);

    const url = `${ESPN_SCOREBOARD_URL}?dates=${startDate}-${endDate}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const events = data.events || [];

    const unionGames = events.filter((event) => {
      const competitors = event.competitions?.[0]?.competitors || [];
      return competitors.some(
        (competitor) => String(competitor.team?.id) === UNION_ID,
      );
    });

    const liveGame = unionGames.find((event) => {
      return event.competitions?.[0]?.status?.type?.state === "in";
    });

    const upcomingGames = unionGames
      .filter((event) => {
        const gameDate = new Date(event.date);
        return !Number.isNaN(gameDate.getTime()) && gameDate > now;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const game = liveGame || upcomingGames[0];

    if (!game) {
      element.textContent = "No upcoming games.";
      return;
    }

    renderGame(element, game);
  } catch (error) {
    console.error("Union schedule error:", error);
    element.textContent = "Unable to load.";
  }
}

/*
 * TEAM SCHEDULE CALLS
 */
load("phillies", "baseball", "mlb", "phi");
load("sixers", "basketball", "nba", "phi");
load("eagles", "football", "nfl", "phi");
load("flyers", "hockey", "nhl", "phi");
loadUnion("union");
load("sju", "basketball", "mens-college-basketball", 2603);
load("wcu", "football", "college-football", 223);
