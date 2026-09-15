/*
Author: aidanelm
File: main.js
Date: 2026-09-15
Description: JavaScript functionality for ScoreViewer page.
*/

/**
 * ESPN API base URL.
 *
 * Most team schedule requests are built from this endpoint using:
 *   /{sport}/{league}/teams/{team}/schedule
 */
const ESPN_API_BASE = "https://site.api.espn.com/apis/site/v2/sports";

/**
 * Load and display the next/current game for an ESPN team.
 *
 * The function:
 * 1. Requests the team's schedule from ESPN.
 * 2. Prioritizes a game currently in progress.
 * 3. Otherwise selects the next upcoming game.
 * 4. Falls back to the most recent game if no upcoming/live game exists.
 * 5. Renders the matchup, scores, date, and time into the target element.
 *
 * @param {string} id - ID of the DOM element where the game should be rendered.
 * @param {string} sport - ESPN sport identifier (e.g. "baseball", "football").
 * @param {string} league - ESPN league identifier (e.g. "mlb", "nfl").
 * @param {string|number} team - ESPN team ID.
 */
async function load(id, sport, league, team) {
  const element = document.getElementById(id);

  // Stop early if the target element does not exist.
  if (!element) {
    console.warn(`Unable to find element with ID "${id}".`);
    return;
  }

  try {
    // Build the ESPN team schedule endpoint.
    const url = `${ESPN_API_BASE}/${sport}/${league}/teams/${team}/schedule`;

    const response = await fetch(url);

    // fetch() only rejects on network failures, so explicitly handle
    // non-2xx HTTP responses here.
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const games = data.events || [];
    const now = Date.now();

    /*
     * Select the most relevant game:
     *
     * 1. A game currently in progress takes priority.
     * 2. Otherwise, use the next game that has not started.
     * 3. If there are no future games, display the most recent game.
     */
    const game =
      games.find(
        (game) => game.competitions?.[0]?.status?.type?.state === "in",
      ) ||
      games.find((game) => new Date(game.date).getTime() >= now) ||
      games[games.length - 1];

    // ESPN returned no games for this team.
    if (!game) {
      element.textContent = "No games.";
      return;
    }

    const competition = game.competitions?.[0];

    // A schedule event should contain at least one competition.
    if (!competition) {
      element.textContent = "Unable to load.";
      return;
    }

    const teams = competition.competitors || [];

    // Identify the away and home teams from ESPN's competitor data.
    const away = teams.find((team) => team.homeAway === "away");
    const home = teams.find((team) => team.homeAway === "home");

    if (!away || !home) {
      element.textContent = "Unable to load.";
      return;
    }

    const gameDate = new Date(game.date);

    /*
     * Format the game date using the browser's locale.
     *
     * Using toLocaleDateString() means the date is displayed according
     * to the user's regional settings rather than being hard-coded.
     */
    const date = gameDate.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    // Format the start time using the user's local timezone.
    const time = gameDate.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });

    /*
     * Render the matchup.
     *
     * ESPN may provide a score as a number/string, or the value may
     * be missing for an upcoming game. Use an em dash when no score
     * is available.
     */
    element.innerHTML = `
      <div class="d-flex align-items-center">
        <div class="team text-center">
          <div class="score">${away.score ?? "—"}</div>
          <div class="team-name-large">
            ${away.team.shortDisplayName}
          </div>
        </div>

        <div class="at">@</div>

        <div class="team text-center">
          <div class="score">${home.score ?? "—"}</div>
          <div class="team-name-large">
            ${home.team.shortDisplayName}
          </div>
        </div>
      </div>

      <div class="game-info">
        ${date} · ${time}
      </div>
    `;
  } catch (error) {
    // Log the technical error for debugging while showing a
    // message in the interface.
    console.error(`Unable to load ${sport}/${league} schedule:`, error);
    element.textContent = "Unable to load.";
  }
}

/**
 * Load and display the next/current Philadelphia Union match.
 *
 * Unlike the other teams, the Union schedule is retrieved from ESPN's
 * MLS scoreboard endpoint rather than the team schedule endpoint.
 *
 * The scoreboard contains games for the entire MLS, so the response
 * is filtered to events involving Philadelphia Union.
 *
 * @param {string} id - ID of the DOM element where the game is rendered.
 */
async function loadUnion(id) {
  const element = document.getElementById(id);

  // Stop early if the target element does not exist.
  if (!element) {
    console.warn(`Unable to find element with ID "${id}".`);
    return;
  }

  /**
   * Philadelphia Union's ESPN team ID.
   * ESPN uses this ID to identify the Union in scoreboard events.
   */
  const UNION_ID = "10739";

  /**
   * ESPN scoreboard endpoint for Major League Soccer.
   *
   * The endpoint supports date ranges through the `dates` query
   * parameter in YYYYMMDD-YYYYMMDD format.
   */
  const ESPN_SCOREBOARD_URL =
    "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard";

  try {
    const now = new Date();

    /**
     * Convert a Date object into ESPN's YYYYMMDD date format.
     *
     * @param {Date} date - Date to format.
     * @returns {string} Date formatted as YYYYMMDD.
     */
    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");

      return `${year}${month}${day}`;
    };

    const startDate = formatDate(now);

    /*
     * Search thirty days into the future.
     *
     * This keeps the scoreboard response relatively small while
     * normally providing enough range to find the Union's next match.
     */
    const endDateObject = new Date(now);
    endDateObject.setDate(endDateObject.getDate() + 30);

    const endDate = formatDate(endDateObject);

    const url = `${ESPN_SCOREBOARD_URL}?dates=${startDate}-${endDate}`;

    const response = await fetch(url);

    // fetch() does not reject on HTTP errors, so check the status.
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const events = data.events || [];

    /*
     * The scoreboard includes every MLS match in the requested date
     * range. Filter the results down to matches involving Philadelphia.
     */
    const unionGames = events.filter((event) => {
      const competitors = event.competitions?.[0]?.competitors || [];

      return competitors.some(
        (competitor) => String(competitor.team?.id) === UNION_ID,
      );
    });

    /*
     * If the Union is currently playing, that match takes priority
     * over all upcoming matches.
     */
    const liveGame = unionGames.find((event) => {
      return event.competitions?.[0]?.status?.type?.state === "in";
    });

    /*
     * Otherwise, find all future Union matches.
     *
     * Sort them chronologically because ESPN does not guarantee that
     * the events array will be ordered by kickoff time.
     */
    const upcomingGames = unionGames
      .filter((event) => {
        const gameDate = new Date(event.date);

        return !Number.isNaN(gameDate.getTime()) && gameDate > now;
      })
      .sort((a, b) => {
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });

    /*
     * Prefer a live game. If there isn't one, use the earliest
     * upcoming match.
     */
    const game = liveGame || upcomingGames[0];

    /*
     * Do not fall back to an old game here.
     *
     * For the Union component, the desired behavior is specifically
     * to show the next/current match rather than a previous result,
     * since the API behaves differently.
     */
    if (!game) {
      element.textContent = "No upcoming games.";
      return;
    }

    const competition = game.competitions?.[0];

    if (!competition) {
      element.textContent = "Unable to load.";
      return;
    }

    const competitors = competition.competitors || [];

    // Identify the two sides of the matchup.
    const away = competitors.find((team) => team.homeAway === "away");
    const home = competitors.find((team) => team.homeAway === "home");

    if (!away || !home) {
      element.textContent = "Unable to load.";
      return;
    }

    const gameDate = new Date(game.date);

    /*
     * Display the kickoff date/time in the user's local timezone.
     */
    const date = gameDate.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    const time = gameDate.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });

    /*
     * Upcoming matches do not have a meaningful score yet.
     *
     * For live or completed matches, ESPN's displayValue provides
     * the formatted score.
     */
    const isUpcoming =
      gameDate > now && competition.status?.type?.state !== "in";

    const awayScore = isUpcoming ? "—" : (away.score?.displayValue ?? "—");

    const homeScore = isUpcoming ? "—" : (home.score?.displayValue ?? "—");

    /*
     * Render the matchup.
     */
    element.innerHTML = `
      <div class="d-flex align-items-center">
        <div class="team text-center">
          <div class="score">
            ${awayScore}
          </div>

          <div class="team-name-large">
            ${away.team.shortDisplayName}
          </div>
        </div>

        <div class="at">@</div>

        <div class="team text-center">
          <div class="score">
            ${homeScore}
          </div>

          <div class="team-name-large">
            ${home.team.shortDisplayName}
          </div>
        </div>
      </div>

      <div class="game-info">
        ${date} · ${time}
      </div>
    `;
  } catch (error) {
    // Keep technical details in the console while displaying a
    // message to the user.
    console.error("Union schedule error:", error);
    element.textContent = "Unable to load.";
  }
}

/*
 * --------------------------------------------------------------------------
 * TEAM SCHEDULES
 * --------------------------------------------------------------------------
 *
 * Each call maps a DOM element to the corresponding ESPN sport, league,
 * and team ID.
 */

/** Philadelphia Phillies — MLB */
load("phillies", "baseball", "mlb", "phi");

/** Philadelphia 76ers — NBA */
load("sixers", "basketball", "nba", "phi");

/** Philadelphia Eagles — NFL */
load("eagles", "football", "nfl", "phi");

/** Philadelphia Flyers — NHL */
load("flyers", "hockey", "nhl", "phi");

/** Philadelphia Union — MLS - Different API*/
loadUnion("union");

/** St. Joseph's Hawks — Men's College Basketball */
load("sju", "basketball", "mens-college-basketball", 2603);

/** West Chester Golden Rams — College Football */
load("wcu", "football", "college-football", 223);
