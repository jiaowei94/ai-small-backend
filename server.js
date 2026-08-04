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

// Supabase & Resend 初始化
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const resendKey = process.env.RESEND_API_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
}

let resend = null;
if (resendKey) {
    resend = new Resend(resendKey);
}

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
                from: 'AI-Small Team <onboarding@resend.dev>',
                to: email,
                subject: '【AI-Small】您的登录验证码',
                html: `<div style="font-family: sans-serif; padding: 20px;">
                    <h2>欢迎登录 AI-Small</h2>
                    <p>您的验证码为：<strong style="font-size: 24px; color: #0284c7;">${code}</strong></p>
                    <p>验证码有效期为 5 分钟，请勿泄露给他人。</p>
                </div>`
            });
        }

        return res.json({ success: true, message: '验证码已发送至您的邮箱' });
    } catch (err) {
        console.error('Send code error:', err);
        return res.status(500).json({ success: false, message: '发送验证码失败: ' + err.message });
    }
});

// 2. POST /api/auth/verify (验证码校验)
app.post('/api/auth/verify', async (req, res) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ success: false, message: '邮箱和验证码不能为空' });
        }

        const record = verificationStore.get(email);
        if (!record) {
            return res.status(400).json({ success: false, message: '验证码不存在或已失效，请重新获取' });
        }

        if (Date.now() > record.expires) {
            verificationStore.delete(email);
            return res.status(400).json({ success: false, message: '验证码已过期，请重新获取' });
        }

        if (record.code !== code) {
            return res.status(400).json({ success: false, message: '验证码错误' });
        }

        verificationStore.delete(email);

        let userRecord = null;
        if (supabase) {
            const { data } = await supabase
                .from('users')
                .select('*')
                .eq('email', email)
                .single();

            if (!data) {
                const { data: newUser } = await supabase
                    .from('users')
                    .insert([{ email, created_at: new Date().toISOString() }])
                    .select()
                    .single();
                userRecord = newUser;
            } else {
                userRecord = data;
            }
        }

        return res.json({
            success: true,
            message: '验证成功！',
            token: 'token_' + Date.now(),
            user: userRecord || { email }
        });
    } catch (err) {
        console.error('Verify error:', err);
        return res.status(500).json({ success: false, message: '服务器验证异常: ' + err.message });
    }
});

// 3. POST /api/chat (Gemini AI 对话接口 - 含智能故障降级与格式清洗)
app.post('/api/chat', async (req, res) => {
    try {
        const { message, history, apiKey: clientApiKey, model: requestedModel } = req.body;

        if (!message) {
            return res.status(400).json({ success: false, message: '消息内容不能为空' });
        }

        const apiKey = clientApiKey || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(400).json({
                success: false,
                message: '未提供 Gemini API Key！请在前端侧边栏填入 Key，或在 Vercel 中设置 GEMINI_API_KEY 环境变量。'
            });
        }

        // 清洗模型名称（去除多余的 models/ 前缀与空格）
        let rawModel = requestedModel || 'gemini-1.5-flash';
        let cleanModel = rawModel.replace(/^models\//, '').trim();

        const genAI = new GoogleGenerativeAI(apiKey);

        const tryGenerate = async (targetModel) => {
            const modelInstance = genAI.getGenerativeModel({ model: targetModel });
            let prompt = message;
            if (history && Array.isArray(history) && history.length > 0) {
                const historyContext = history.map(h => `${h.role === 'user' ? 'User' : 'AI'}: ${h.content}`).join('\n');
                prompt = `${historyContext}\nUser: ${message}\nAI:`;
            }
            const result = await modelInstance.generateContent(prompt);
            return result.response.text();
        };

        try {
            // 优先尝试调用指定模型
            const replyText = await tryGenerate(cleanModel);
            return res.json({ success: true, reply: replyText, usedModel: cleanModel });
        } catch (firstErr) {
            console.warn(`模型 [${cleanModel}] 请求异常 (${firstErr.message})，正在尝试备用模型 gemini-1.5-flash...`);
            
            // 若用户选的模型受限(429/404)，自动尝试全免费、最稳定的 gemini-1.5-flash
            if (cleanModel !== 'gemini-1.5-flash') {
                try {
                    const fallbackReply = await tryGenerate('gemini-1.5-flash');
                    return res.json({
                        success: true,
                        reply: fallbackReply,
                        usedModel: 'gemini-1.5-flash (降级备用)',
                        notice: `提示：原模型 [${cleanModel}] 受限 (429/404)，已自动为您切换至免费稳定的 gemini-1.5-flash 予以回复。`
                    });
                } catch (fallbackErr) {
                    throw firstErr; // 若连降级都失败，抛出最初报错
                }
            } else {
                throw firstErr;
            }
        }
    } catch (err) {
        console.error('Chat API Error:', err);
        let errorMsg = err.message || 'Google API 请求失败';
        
        if (errorMsg.includes('429') || errorMsg.includes('Quota exceeded')) {
            errorMsg = `API 额度受限 (429): 该 Key 在地区或账户配置上对所选模型额度为 0。建议：在左侧切换模型为 [gemini-1.5-flash] 重新发送。`;
        } else if (errorMsg.includes('404')) {
            errorMsg = `模型未找到 (404): 当前使用的模型名称不存在或不支持。建议切换为 [gemini-1.5-flash] 或 [gemini-2.0-flash]。`;
        }

        return res.status(500).json({
            success: false,
            message: errorMsg
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
