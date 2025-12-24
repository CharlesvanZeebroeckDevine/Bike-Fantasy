require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function testAuth() {
    const code = "TEST_CODE_" + Math.random().toString(36).substring(7);
    console.log("1. Generating test Access Code:", code);

    const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
        console.error("Missing credentials in .env.local", { supabaseUrl, hasKey: !!serviceKey });
        process.exit(1);
    }

    const sbAdmin = createClient(supabaseUrl, serviceKey);

    // Create Code
    const { data: codeData, error: codeErr } = await sbAdmin
        .from('access_codes')
        .insert({ code: code, is_active: true })
        .select()
        .single();

    if (codeErr) {
        console.error("Failed to create access code:", codeErr);
        process.exit(1);
    }
    console.log("   Created Access Code ID:", codeData.id);

    // Call Local API
    console.log("2. Calling Local API /api/verify-code...");
    try {
        const fetch = await import('node-fetch').then(m => m.default).catch(() => global.fetch);
        const res = await fetch('http://127.0.0.1:3000/api/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessCode: code })
        });

        if (!res.ok) {
            console.error("   API Failed:", res.status, await res.text());
            process.exit(1);
        }

        const json = await res.json();
        console.log("   API Success! Token received length:", json.token?.length);
        console.log("   User:", json.user);

        // Verify Token against RLS
        console.log("3. Verifying Token with Supabase RLS...");
        const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
        const sbUser = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: `Bearer ${json.token}` } }
        });

        const { data: me, error: meErr } = await sbUser
            .from('users')
            .select('id, display_name')
            .single();

        if (meErr) {
            console.error("   RLS Verification Failed:", meErr);
            console.log("   Possible Cause: Token signature mismatch (Secret might be wrong).");
        } else {
            console.log("   RLS Success! Fetched Profile:", me);
            console.log("   CONCLUSION: Auth flow IS WORKING locally.");
        }

        // Cleanup
        await sbAdmin.from('access_codes').delete().eq('id', codeData.id);

    } catch (err) {
        console.error("Fetch Error (is vercel dev running?):", err);
    }
}

testAuth();
