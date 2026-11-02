import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    // 1. Enable CORS for Telegram Webview
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { short_id } = req.body || {};

    if (!short_id) {
        return res.status(400).json({ error: 'short_id is required' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ error: 'Vercel ENV variables missing' });
    }

    const cleanUrl = supabaseUrl.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");

    try {
        const supabase = createClient(cleanUrl, supabaseKey.trim());

        // 1. Fetch Link Data
        const { data: linkData, error: linkErr } = await supabase
            .from('links')
            .select('*')
            .eq('short_id', short_id)
            .single();

        if (linkErr || !linkData) {
            return res.status(404).json({ error: 'Link not found' });
        }

        // 2. Fetch Admin Settings (Default CPM fallback $2)
        const { data: adminSettings } = await supabase
            .from('settings')
            .select('*')
            .limit(1)
            .single();

        const cpm = adminSettings && adminSettings.cpm ? parseFloat(adminSettings.cpm) : 2.0;
        const earn_amount = cpm / 1000;

        // 3. Update LINK table (Clicks and Earnings)
        await supabase.from('links').update({
            clicks: (linkData.clicks || 0) + 1,
            earnings: (parseFloat(linkData.earnings) || 0) + earn_amount
        }).eq('id', linkData.id);

        // 4. Fetch and Update USER table
        const { data: userData } = await supabase
            .from('users')
            .select('*')
            .eq('id', linkData.user_id)
            .single();
        
        if (userData) {
            await supabase.from('users').update({
                balance: (parseFloat(userData.balance) || 0) + earn_amount,
                today_earnings: (parseFloat(userData.today_earnings) || 0) + earn_amount,
                total_clicks: (userData.total_clicks || 0) + 1
            }).eq('id', userData.id);

            // 5. Referral Commission Logic (Safe execution)
            const referPercent = adminSettings && adminSettings.refer_percent ? parseFloat(adminSettings.refer_percent) : 10;
            if (referPercent > 0 && userData.telegram_id) {
                try {
                    const { data: referralData } = await supabase
                        .from('referrals')
                        .select('referrer_tg_id')
                        .eq('referred_tg_id', userData.telegram_id)
                        .maybeSingle();

                    if (referralData && referralData.referrer_tg_id) {
                        const { data: referrerData } = await supabase
                            .from('users')
                            .select('*')
                            .eq('telegram_id', referralData.referrer_tg_id)
                            .maybeSingle();

                        if (referrerData) {
                            const referComm = earn_amount * (referPercent / 100);
                            await supabase.from('users').update({
                                balance: (parseFloat(referrerData.balance) || 0) + referComm
                            }).eq('id', referrerData.id);
                        }
                    }
                } catch(refErr) {
                    console.log("Referral calculation skipped:", refErr.message);
                }
            }
        }

        return res.status(200).json({ success: true, message: 'Reward & Views added successfully' });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
