const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// 初始化 Supabase 数据库客户端
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabase = null;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
}

// 初始化 Resend 发信服务
const resendKey = process.env.RESEND_API_KEY;
let resend = null;
if (resendKey) {
    resend = new Resend(resendKey);
}

// 内存验证码缓存
const verificationStore = new Map();

app.get('/', (req, res) => {
    res.status(200).send('AI-Small Backend Service is Running on Vercel!');
});

// 1. POST /api/auth/send-code (发送邮箱验证码)
app.post('/api/auth/send-code', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: '请提供有效的邮箱地址' });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        verificationStore.set(email, { code, expires: Date.now() + 5 * 60 * 1000 });

        if (resend) {
            await resend.emails.send({
                from: 'ai-small <onboarding@resend.dev>',
                to: email,
                subject: '【ai-small.xyz】您的登录验证码',
                html: `<div style="padding:20px;font-family:sans-serif;">
                    <h2>欢迎登录 ai-small.xyz</h2>
                    <p>您的验证码为：<strong style="font-size:24px;color:#06b6d4;">${code}</strong></p>
                    <p>验证码 5 分钟内有效，请勿泄露给他人。</p>
                </div>`
            });
        }

        return res.json({ success: true, message: '验证码发送成功！' });
    } catch (err) {
        console.error('Send code error:', err);
        return res.status(500).json({ success: false, message: '发送验证码失败: ' + err.message });
    }
});

// 2. POST /api/auth/verify (校验验证码)
app.post('/api/auth/verify', async (req, res) => {
    try {
        const { email, code } = req.body;
        const record = verificationStore.get(email);

        if (!record || record.code !== code || Date.now() > record.expires) {
            return res.status(400).json({ success: false, message: '验证码无效或已过期' });
        }

        verificationStore.delete(email);

        let user = { id: 'usr_' + Date.now(), email: email };
        if (supabase) {
            const { data } = await supabase.from('users').select('*').eq('email', email).single();
            if (data) {
                user = data;
            } else {
                const { data: newUser } = await supabase.from('users').insert([{ email, nickname: email.split('@')[0] }]).select().single();
                if (newUser) user = newUser;
            }
        }

        return res.json({ success: true, token: 'token_' + Date.now(), user });
    } catch (err) {
        return res.status(500).json({ success: false, message: '登录校验失败: ' + err.message });
    }
});

// 3. POST /api/ai/chat (Google Gemini API 官方代理接口)
app.post('/api/ai/chat', async (req, res) => {
    try {
        const { prompt, model = 'gemini-1.5-flash', history = [] } = req.body;
        if (!prompt) {
            return res.status(400).json({ success: false, message: '提示词不能为空' });
        }

        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ success: false, message: '后端未成功配置 GEMINI_API_KEY 环境变量' });
        }

        const targetModel = model.includes('gemini') ? model : 'gemini-1.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

        const contents = [];
        if (Array.isArray(history) && history.length > 0) {
            history.forEach(item => {
                contents.push({
                    role: item.role === 'user' ? 'user' : 'model',
                    parts: [{ text: item.content }]
                });
            });
        }
        contents.push({
            role: 'user',
            parts: [{ text: prompt }]
        });

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents })
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                message: data.error?.message || '调用 Gemini API 失败'
            });
        }

        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Gemini 未返回有效数据。';
        return res.json({ success: true, reply, model: targetModel });
    } catch (err) {
        console.error('Gemini proxy error:', err);
        return res.status(500).json({ success: false, message: 'AI 代理服务发生错误: ' + err.message });
    }
});

// 4. POST /api/game/score (更新小游戏得分)
app.post('/api/game/score', async (req, res) => {
    try {
        const { userId, gameId, score } = req.body;
        if (supabase && userId && gameId) {
            await supabase.from('game_scores').insert([{ user_id: userId, game_id: gameId, score }]);
        }
        return res.json({ success: true, message: '成绩登记成功' });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}

module.exports = app;
