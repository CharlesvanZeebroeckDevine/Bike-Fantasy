require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

async function inspectDB() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
        console.error("Missing credentials.");
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    console.log("--- Inspecting Users & Teams ---");

    // Fetch Users with Access Codes
    const { data: users, error: uErr } = await supabase
        .from('users')
        .select(`
      id, 
      display_name, 
      created_at,
      access_codes ( code )
    `)
        .limit(10)
        .order('created_at', { ascending: false });

    if (uErr) {
        console.error("Error fetching users:", uErr);
        return;
    }

    // Fetch Teams
    const { data: teams, error: tErr } = await supabase
        .from('teams')
        .select('id, team_name, user_id, season_year, locked')
        .limit(20);

    if (tErr) {
        console.error("Error fetching teams:", tErr);
        return;
    }

    // Join and Print
    users.forEach(u => {
        const userTeams = teams.filter(t => t.user_id === u.id);
        console.log(`User: ${u.display_name} (ID: ${u.id})`);
        console.log(`  Access Code: ${u.access_codes?.code || 'N/A'}`);
        if (userTeams.length > 0) {
            userTeams.forEach(t => {
                console.log(`  -> Team: [${t.season_year}] ${t.team_name} (Locked: ${t.locked})`);
            });
        } else {
            console.log(`  -> NO TEAMS FOUND`);
        }
        console.log("");
    });
}

inspectDB();
