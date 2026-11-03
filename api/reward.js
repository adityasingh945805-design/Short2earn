import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
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

    const { short_id, clicker_tg_id } = req.body || {};

    if (!short_id) {
        return res.status(400).json({ error: 'short_id is required' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ error: 'Vercel ENV variables missing (SUPABASE_URL or SUPABASE_SERVICE_KEY)' });
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

        // 2. Fetch Admin Settings
        const { data: adminSettings } = await supabase
            .from('settings')
            .select('*')
            .limit(1)
            .maybeSingle();

        const cpm = adminSettings && adminSettings.cpm ? parseFloat(adminSettings.cpm) : 2.0;
        const earn_amount = Number((cpm / 1000).toFixed(6));

        // 3. Update LINK table (Increment views count & earnings)
        const newClicks = (Number(linkData.clicks) || 0) + 1;
        const newLinkEarnings = (parseFloat(linkData.earnings) || 0) + earn_amount;

        await supabase.from('links').update({
            clicks: newClicks,
            earnings: newLinkEarnings
        }).eq('id', linkData.id);

        // 4. Record into click_logs table for Admin Stats & Unique Tracking
        if (clicker_tg_id) {
            await supabase.from('click_logs').insert([{
                link_id: linkData.id,
                clicker_tg_id: Number(clicker_tg_id)
            }]);
        }

        // 5. Fetch & Update LINK OWNER User Record
        const { data: userData } = await supabase
            .from('users')
            .select('*')
            .eq('id', linkData.user_id)
            .single();

        if (userData) {
            const newBalance = (parseFloat(userData.balance) || 0) + earn_amount;
            const newToday = (parseFloat(userData.today_earnings) || 0) + earn_amount;
            const newTotalClicks = (Number(userData.total_clicks) || 0) + 1;

            await supabase.from('users').update({
                balance: newBalance,
                today_earnings: newToday,
                total_clicks: newTotalClicks
            }).eq('id', userData.id);

            // 6. Referral Commission
            const referPercent = adminSettings && adminSettings.refer_percent ? parseFloat(adminSettings.refer_percent) : 10;
            if (referPercent > 0 && userData.telegram_id) {
                try {
                    const { data: refRow } = await supabase
                        .from('referrals')
                        .select('referrer_tg_id')
                        .eq('referred_tg_id', userData.telegram_id)
                        .maybeSingle();

                    if (refRow && refRow.referrer_tg_id) {
                        const { data: referrer } = await supabase
                            .from('users')
                            .select('id, balance')
                            .eq('telegram_id', refRow.referrer_tg_id)
                            .maybeSingle();

                        if (referrer) {
                            const referComm = Number((earn_amount * (referPercent / 100)).toFixed(6));
                            await supabase.from('users').update({
                                balance: (parseFloat(referrer.balance) || 0) + referComm
                            }).eq('id', referrer.id);
                        }
                    }
                } catch (rErr) {
                    console.error("Referral Error:", rErr.message);
                }
            }
        }

        return res.status(200).json({ 
            success: true, 
            message: 'View and reward credited successfully',
            views: newClicks 
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
