import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    const botToken = process.env.BOT_TOKEN;

    if (!supabaseUrl || !supabaseKey) {
        return res.status(500).json({ status: 'error', message: 'Database configuration missing' });
    }

    const cleanUrl = supabaseUrl.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
    const supabase = createClient(cleanUrl, supabaseKey.trim());

    // User identifier: user_id (Telegram ID) ya api token
    const tgUserId = req.query.user_id || req.body?.user_id;
    const apiToken = req.query.api || req.query.api_token || req.body?.api || req.body?.api_token;
    const longUrl = req.query.url || req.body?.url;

    if (!tgUserId && !apiToken) {
        return res.status(401).json({ status: 'error', message: 'user_id or api token is required' });
    }

    if (!longUrl || !longUrl.startsWith('http')) {
        return res.status(400).json({ status: 'error', message: 'A valid URL (http/https) is required' });
    }

    try {
        // User find karein telegram_id ya api_token se
        let query = supabase.from('users').select('*');
        if (tgUserId) {
            query = query.eq('telegram_id', Number(tgUserId));
        } else {
            query = query.eq('api_token', apiToken.trim());
        }

        const { data: user, error: userErr } = await query.maybeSingle();

        if (userErr || !user) {
            return res.status(403).json({ status: 'error', message: 'User not found. Open the mini app first.' });
        }

        if (user.is_blocked) {
            return res.status(403).json({ status: 'error', message: 'User account is suspended' });
        }

        // Unique short link ID generate karein
        const shortId = Math.random().toString(36).substring(2, 8);

        const { error: insertErr } = await supabase
            .from('links')
            .insert([{
                original_url: longUrl.trim(),
                short_id: shortId,
                user_id: user.id,
                clicks: 0,
                earnings: 0
            }]);

        if (insertErr) {
            return res.status(500).json({ status: 'error', message: 'Failed to create short link' });
        }

        const botUsername = process.env.BOT_USERNAME || 'SeetuOfficialbot';
        const appName = process.env.APP_SHORT_NAME || 'Mynexify';
        const shortUrl = `https://t.me/${botUsername}/${appName}?startapp=link_${shortId}`;

        // Agar user ka first link hai toh use Telegram par notification bhejo
        let welcomeSent = false;
        if (!user.is_bot_notified && user.telegram_id && botToken) {
            try {
                const messageText = `🎉 <b>Shortener Linked Successfully!</b>\n\n` +
                    `Aapka account <b>Short2Earn</b> se link ho chuka hai.\n` +
                    `Ab aap kisi bhi link ya post ko yahan send kar sakte hain, bot automatically use convert kar dega.\n\n` +
                    `🔗 <b>Your Converted Link:</b>\n${shortUrl}`;
                
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: user.telegram_id,
                        text: messageText,
                        parse_mode: 'HTML'
                    })
                });

                await supabase.from('users').update({ is_bot_notified: true }).eq('id', user.id);
                welcomeSent = true;
            } catch (notifyErr) {
                console.error("Telegram notification error:", notifyErr.message);
            }
        }

        return res.status(200).json({
            status: 'success',
            shortenedUrl: shortUrl,
            short_id: shortId,
            welcome_sent: welcomeSent
        });

    } catch (e) {
        return res.status(500).json({ status: 'error', message: e.message });
    }
}

