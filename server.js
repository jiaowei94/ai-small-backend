const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// 初始化云端服务客户端
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const resendKey = process.env.RESEND_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
}

let resend = null;
if (resendKey) {
    resend = new Resend(resendKey);
}

let genAI = null;
if (geminiKey) {
    genAI = new GoogleGenerativeAI(geminiKey);
}

// 内存验证码缓存
const verificationStore = new Map();

// 基础健康检查
app.get('/', (req, res) => {
    res.status(200).send('AI-Small Backend Service is Running on Vercel!');
});

// 1. POST /api/auth/send-code (发信接口)
app.post('/api/auth/send-code', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: '请提供有效的邮箱地址' });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        verificationStore.set(email.toLowerCase(), { code, expires: Date.now() + 5 * 60 * 1000 });

        if (resend) {
            await resend.emails.send({
                from: 'AI-Small <onboarding@resend.dev>',
                to: [email],
                subject: '【ai-small.xyz】您的登录验证码',
                html: `<p>您的验证码是：<strong>${code}</strong>，5分钟内有效。</p>`
            });
        }

        return res.status(200).json({ success: true, message: '验证码已发送' });
    } catch (err) {
        console.error('Send code error:', err);
        return res.status(500).json({ success: false, message: '服务端发信失败' });
    }
});

// 2. POST /api/auth/verify (校验接口)
app.post('/api/auth/verify', async (req, res) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ success: false, message: '邮箱和验证码不能为空' });
        }

        const record = verificationStore.get(email.toLowerCase());
        if (!record || record.code !== code || Date.now() > record.expires) {
            return res.status(400).json({ success: false, message: '验证码无效或已过期' });
        }

        verificationStore.delete(email.toLowerCase());

        let userId = null;
        if (supabase) {
            const { data: existingUser } = await supabase.from('users').select('id').eq('email', email).single();
            if (existingUser) {
                userId = existingUser.id;
            } else {
                const newId = crypto.randomUUID();
                const { data: insertedUser } = await supabase.from('users').insert([{ id: newId, email, nickname: email.split('@')[0] }]).select().single();
                if (insertedUser) userId = insertedUser.id;
            }
        }

        return res.status(200).json({
            success: true,
            token: `token_${Date.now()}`,
            user: { id: userId, email }
        });
    } catch (err) {
        console.error('Verify error:', err);
        return res.status(500).json({ success: false, message: '服务端校验异常' });
    }
});

// 3. 【新增接口】POST /api/ai/chat (Gemini 免登录 AI 对话)
app.post('/api/ai/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ success: false, message: '消息内容不能为空' });
        }

        if (!genAI) {
            return res.status(200).json({ success: true, reply: "【演示回复】服务器未配置 GEMINI_API_KEY 环境变量，已收到消息：" + message });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(message);
        const response = await result.response;
        const text = response.text();

        return res.status(200).json({ success: true, reply: text });
    } catch (err) {
        console.error('Gemini AI error:', err);
        return res.status(500).json({ success: false, message: 'AI 大模型响应失败' });
    }
});

// 4. 【新增接口】POST /api/game/score (记录小游戏得分)
app.post('/api/game/score', async (req, res) => {
    try {
        const { userId, gameId, score } = req.body;
        if (supabase && userId && gameId) {
            await supabase.from('game_scores').insert([{ user_id: userId, game_id: gameId, score: parseInt(score) }]);
        }
        return res.status(200).json({ success: true, message: '得分记录成功' });
    } catch (err) {
        return res.status(500).json({ success: false, message: '高分榜保存失败' });
    }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
}
