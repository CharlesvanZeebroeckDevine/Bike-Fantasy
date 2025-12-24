import { createClient } from "@supabase/supabase-js";
import { debugLog } from "./debug";

// --- ENV & CONFIG ---
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;
const OFFLINE_MODE = process.env.REACT_APP_OFFLINE === "true";

// Used for local state management (JWT)
const TOKEN_STORAGE_KEY = "megabike_token";
const MOCK_USER_KEY = "megabike_mock_user";
const MOCK_TEAM_KEY = "megabike_mock_team";

if (!OFFLINE_MODE && (!SUPABASE_URL || !SUPABASE_ANON_KEY)) {
  console.warn("Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY");
}

// Global Supabase Client management
// We use a custom JWT, so we cannot relying on supabase.auth.setSession (which expects GoTrue users).
// Instead, we recreate the client with the Authorization header whenever the token changes.

let supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function getSupabase() {
  return supabase;
}

export function getAuthToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export async function setAuthToken(token) {
  if (!token) {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    // Reset to anon client
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    // Create client with custom header for RLS
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        // Disable auto refresh/persist as we manage it manually
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      }
    });
  }
}

// Sync token on load
const savedToken = getAuthToken();
if (savedToken) setAuthToken(savedToken);


// --- API FUNCTIONS ---


// Helper to parse JWT locally
function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch (e) {
    return null;
  }
}

// 1. Auth: Calls Serverless Function /api/verify-code
export async function verifyAccessCode(accessCode) {
  if (OFFLINE_MODE) return mockLogin(accessCode);

  try {
    const res = await fetch("/api/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Login failed");
    }

    const data = await res.json();
    setAuthToken(data.token); // IMPORTANT: Update the client immediately
    return data; // { token, user: { id, displayName... } }
  } catch (err) {
    debugLog("verifyAccessCode error", err);
    throw err;
  }
}

// 2. User Profile: Supabase Direct
export async function getMe() {
  if (OFFLINE_MODE) return mockGetMe();

  const token = getAuthToken();
  if (!token) throw new Error("Not authenticated");

  const jwt = parseJwt(token);
  if (!jwt || !jwt.sub) throw new Error("Invalid token");

  const userId = jwt.sub;

  const { data, error } = await getSupabase()
    .from("users")
    .select("id, display_name, profile_image_url")
    .eq("id", userId) // Explicitly filter by ID
    .single();

  if (error) {
    debugLog("getMe error", error);
    if (error.code === "PGRST116" || error.code === "401" || error.message?.includes("JWT")) {
      console.error("CRITICAL AUTH ERROR:", error);
      console.error("Current Token:", token);
      console.warn("Retaining token for debugging purposes. Normally this would auto-logout.");
    }
    throw error;
  }

  return {
    id: data.id,
    displayName: data.display_name,
    profileImageUrl: data.profile_image_url
  };
}

export async function updateMe(payload) {
  if (OFFLINE_MODE) return mockUpdateMe(payload);

  const token = getAuthToken();
  if (!token) throw new Error("Not authenticated");
  const jwt = parseJwt(token);
  if (!jwt || !jwt.sub) throw new Error("Invalid token");
  const userId = jwt.sub;

  const updates = {};
  if (payload.displayName) updates.display_name = payload.displayName;
  if (payload.profileImageUrl !== undefined) updates.profile_image_url = payload.profileImageUrl;

  const { data, error } = await getSupabase()
    .from("users")
    .update(updates)
    .eq("id", userId)
    .select()
    .single();

  if (error) throw error;
  return {
    id: data.id,
    displayName: data.display_name,
    profileImageUrl: data.profile_image_url
  };
}


// 3. Races: Public Read
export async function getLatestRace() {
  if (OFFLINE_MODE) return mockLatestRace();

  const today = new Date().toISOString().slice(0, 10);

  // Latest race
  const { data: race, error: raceErr } = await getSupabase()
    .from("races")
    .select("id, name, race_date")
    .lte("race_date", today)
    .order("race_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (raceErr) throw raceErr;
  if (!race) return null;

  // Results
  const { data: results, error: resErr } = await getSupabase()
    .from("race_results")
    .select("rank, points_awarded, riders(rider_name, team_name)")
    .eq("race_id", race.id)
    .order("rank", { ascending: true })
    .limit(50);

  if (resErr) throw resErr;

  return {
    name: race.name,
    date: race.race_date,
    results: (results || []).map(r => ({
      rider: r.riders?.rider_name,
      team: r.riders?.team_name ?? "",
      points: r.points_awarded,
      rank: r.rank
    }))
  };
}

export async function getNextRace() {
  if (OFFLINE_MODE) return mockNextRace();

  const today = new Date().toISOString().slice(0, 10);
  const { data: race, error } = await getSupabase()
    .from("races")
    .select("id, name, race_date")
    .gt("race_date", today)
    .order("race_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!race) return null;

  return {
    name: race.name,
    date: race.race_date
  };
}


// 4. Teams & Leaderboard
export async function getMyTeam() {
  if (OFFLINE_MODE) return mockMyTeam();

  const token = getAuthToken();
  if (!token) return null;
  const jwt = parseJwt(token);
  if (!jwt || !jwt.sub) return null;
  const userId = jwt.sub;

  // TODO: support current season dynamic
  const season = 2025;

  const { data: team, error } = await getSupabase()
    .from("teams")
    .select("*")
    .eq("user_id", userId)
    .eq("season_year", season)
    .maybeSingle();

  if (error) throw error;
  // Fetch riders with prices and points
  console.log("DEBUG: getMyTeam user:", userId, "season:", season);
  console.log("DEBUG: getMyTeam found team:", team);

  if (!team) return null;

  const { data: teamRiders } = await getSupabase()
    .from("team_riders")
    .select(`
      slot,
      riders (
        id, rider_name, team_name, nationality, active,
        rider_prices(season_year, price),
        rider_points(season_year, points)
      )
    `)
    .eq("team_id", team.id);

  // Format response to match expected frontend structure
  return {
    id: team.id,
    teamName: team.team_name,
    totalPrice: team.total_cost,
    points: team.points,
    riders: (teamRiders || []).map(tr => {
      const r = tr.riders;
      // Extract specific season data (or default to 0)
      const priceObj = r.rider_prices?.find(p => p.season_year === season);
      const pointsObj = r.rider_points?.find(p => p.season_year === season);

      return {
        id: r.id,
        rider_name: r.rider_name,
        team_name: r.team_name,
        nationality: r.nationality,
        active: r.active,
        price: priceObj ? priceObj.price : 0,
        points: pointsObj ? pointsObj.points : 0
      };
    })
  };
}

export async function createMyTeam(payload) {
  if (OFFLINE_MODE) return;

  // 1. Get User ID (implicitly handled by RLS, but we need ID for foreign keys)
  const token = getAuthToken();
  if (!token) throw new Error("Not authenticated");
  const jwt = parseJwt(token);
  if (!jwt || !jwt.sub) throw new Error("Invalid token");
  const userId = jwt.sub;

  const season = 2025;

  // 2. Create Team
  const { data: team, error: teamErr } = await getSupabase()
    .from("teams")
    .insert({
      user_id: userId,
      team_name: payload.teamName,
      season_year: season,
      total_cost: 0, // Should calculate server-side or assume valid if trusted. (TODO: calculate from riders)
      points: 0
    })
    .select()
    .single();

  if (teamErr) {
    debugLog("createMyTeam teamErr", teamErr);
    throw teamErr;
  }

  // 3. Insert Riders
  // Payload riders is [{rider_name: "..."}] ?? or IDs?
  // TeamBuilder sends: riders: slots.map((r) => ({ rider_name: r.rider_name }))
  // Wait, we need Rider IDs. TeamBuilder slots contain rider objects with ID.
  // Let's verify TeamBuilder.jsx line 98. It sends just rider_name?
  // Checking TeamBuilder: riders: slots.map((r) => ({ rider_name: r.rider_name }))
  // That's bad for us. We need IDs. We should really fix TeamBuilder or look them up.
  // BUT, looking at TeamBuilder, `slots` contains objects from `RiderPicker`.
  // We can assume we should change TeamBuilder to send IDs, or look them up here.
  // Looking up by name is risky.

  // NOTE: I will assume I should patch TeamBuilder to send IDs too, but for now let's hope names are unique enough or fix the payload on client side.
  // Actually, let's fix the logic here to look up IDs if needed, but better to fix input.

  // Assuming payload.riders might lack IDs, let's fetch them all first?
  // No, let's fix TeamBuilder in a next step. 
  // Wait, looking at TeamBuilder again... it has access to the full rider object.
  // I will assume for now I will modify this function to Expect riders to have IDs if possible, or lookup.

  // Let's rely on looking up by name for now as a fallback if ID missing, 
  // but standard practice is IDs.
  // Actually, I'll update this function to work with IDs, and then (or simultaneously) I should update TeamBuilder. 
  // Wait, I can't update TeamBuilder in this tool call. 
  // I will implement this assuming we can get IDs.

  // Wait, let's look at autocomplete output. API autocomplete returns `*` from riders.
  // So `slots` has `id`.
  // I will update TeamBuilder payload in next step.
  // For now, let's implement this assuming we receive `{ id, rider_name }` in the array.

  const riderInserts = payload.riders.map((r, idx) => ({
    team_id: team.id,
    rider_id: r.id, // We need this!
    slot: idx + 1
  }));

  // If r.id is missing, this will fail. 
  // I will handle this by fetching IDs by name if ID is undefined.

  for (let i = 0; i < riderInserts.length; i++) {
    if (!riderInserts[i].rider_id) {
      const name = payload.riders[i].rider_name;
      const { data: r } = await getSupabase().from("riders").select("id").eq("rider_name", name).maybeSingle();
      if (r) riderInserts[i].rider_id = r.id;
    }
  }

  const { error: ridersErr } = await getSupabase()
    .from("team_riders")
    .insert(riderInserts);

  if (ridersErr) {
    debugLog("createMyTeam ridersErr", ridersErr);
    // verify cleanup?
    throw ridersErr;
  }

  return team;
}

export async function getCurrentLeaderboard() {
  if (OFFLINE_MODE) return mockLeaderboard();

  const season = 2025;
  const { data, error } = await getSupabase()
    .from("teams")
    .select("id, team_name, points, users(display_name)")
    .eq("season_year", season)
    .order("points", { ascending: false })
    .limit(200);

  if (error) throw error;

  return {
    teams: data.map(t => ({
      id: t.id,
      teamName: t.team_name,
      points: t.points,
      ownerName: t.users?.display_name
    }))
  };
}

export async function getTeamById(teamId) {
  if (OFFLINE_MODE) return null;

  const { data: team, error } = await getSupabase()
    .from("teams")
    .select("*, users(display_name)")
    .eq("id", teamId)
    .single();

  if (error) return null;

  const { data: teamRiders } = await getSupabase()
    .from("team_riders")
    .select(`
      slot,
      riders (
        id, rider_name, team_name, nationality, active,
        rider_prices(season_year, price),
        rider_points(season_year, points)
      )
    `)
    .eq("team_id", team.id);

  const season = 2025; // TODO: make dynamic if needed

  return {
    id: team.id,
    teamName: team.team_name,
    ownerName: team.users?.display_name,
    points: team.points,
    riders: (teamRiders || []).map(tr => {
      const r = tr.riders;
      const priceObj = r.rider_prices?.find(p => p.season_year === season);
      const pointsObj = r.rider_points?.find(p => p.season_year === season);

      return {
        id: r.id,
        rider_name: r.rider_name,
        team_name: r.team_name,
        nationality: r.nationality,
        active: r.active,
        price: priceObj ? priceObj.price : 0,
        points: pointsObj ? pointsObj.points : 0
      };
    })
  };
}

export async function autocompleteRiders(query) {
  if (OFFLINE_MODE) return [];

  const season = 2025;

  const { data, error } = await getSupabase()
    .from("riders")
    .select(`
      *,
      rider_prices(season_year, price)
    `)
    .ilike("rider_name", `%${query}%`)
    .limit(10);

  if (error) return [];

  return data.map(r => {
    // Flatten price
    const priceObj = r.rider_prices?.find(p => p.season_year === season);
    return {
      ...r,
      price: priceObj ? priceObj.price : 0
    };
  });
}

export async function getHistory() {
  // Simple fetch from 'seasons' table
  const { data } = await getSupabase().from("seasons").select("*").order("season_year", { ascending: false });
  // adapt to frontend expected format...
  return { podium: [], mostTitles: [] }; // placeholder
}


// --- MOCKS (Offline Mode) ---
function mockLogin(code) {
  const user = { id: "mock", displayName: code, profileImageUrl: null };
  setAuthToken("mock-token");
  return Promise.resolve({ token: "mock-token", user });
}
function mockGetMe() { return Promise.resolve({ id: "mock", displayName: "Mock User", profileImageUrl: null }); }
function mockUpdateMe(p) { return Promise.resolve({ id: "mock", displayName: p.displayName, profileImageUrl: p.profileImageUrl }); }
function mockLatestRace() { return Promise.resolve({ name: "Mock Race", date: "2025-01-01", results: [] }); }
function mockNextRace() { return Promise.resolve({ name: "Next Mock", date: "2025-02-01" }); }
function mockMyTeam() { return Promise.resolve(null); }
function mockLeaderboard() { return Promise.resolve({ teams: [] }); }