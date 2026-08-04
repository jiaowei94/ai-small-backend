const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

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

// 1. POST /api/auth/send-code
app.post('/api/auth/send-code', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: '请提供有效的邮箱地址' });
        }

        const cleanEmail = email.toLowerCase().trim();
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 5 * 60 * 1000;

        verificationStore.set(cleanEmail, { code, expiresAt });

        if (resend) {
            await resend.emails.send({
                from: 'NEXUS Security <onboarding@resend.dev>',
                to: [cleanEmail],
                subject: '【NEXUS AI】您的注册登录验证码',
                html: `
                    <div style="padding: 24px; font-family: sans-serif; background: #f8fafc; border-radius: 16px;">
                        <h2 style="color: #0284c7; margin-bottom: 8px;">NEXUS AI 协同平台</h2>
                        <p style="color: #334155;">您好！您本次操作的验证码为：</p>
                        <div style="background: #ffffff; padding: 16px; border-radius: 8px; display: inline-block; border: 1px solid #e2e8f0; margin: 12px 0;">
                            <span style="color: #06b6d4; font-size: 32px; font-weight: bold; letter-spacing: 6px;">${code}</span>
                        </div>
                        <p style="color: #64748b; font-size: 12px; margin-top: 12px;">验证码有效期为 5 分钟，如非本人操作请忽略此邮件。</p>
                    </div>
                `
            });
        } else {
            console.log(`[DEV MODE] Verification Code for ${cleanEmail}: ${code}`);
        }

        return res.status(200).json({
            success: true,
            message: '验证码发送成功！'
        });
    } catch (error) {
        console.error('Send Code Error:', error);
        return res.status(500).json({
            success: false,
            message: '验证码发送失败: ' + (error.message || '系统繁忙')
        });
    }
});

// 2. POST /api/auth/verify
app.post('/api/auth/verify', async (req, res) => {
    try {
        const { email, password, code, mode } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: '缺少邮箱信息' });
        }

        const cleanEmail = email.toLowerCase().trim();

        if (mode === 'code') {
            if (!code) {
                return res.status(400).json({ success: false, message: '请输入验证码' });
            }

            const record = verificationStore.get(cleanEmail);
            if (!record) {
                return res.status(400).json({ success: false, message: '验证码不存在或已过期，请重新获取' });
            }

            if (Date.now() > record.expiresAt) {
                verificationStore.delete(cleanEmail);
                return res.status(400).json({ success: false, message: '验证码已过期，请重新发送' });
            }

            if (record.code !== code.trim()) {
                return res.status(400).json({ success: false, message: '验证码错误' });
            }

            verificationStore.delete(cleanEmail);
        } else if (mode === 'password') {
            if (!password) {
                return res.status(400).json({ success: false, message: '请输入密码' });
            }
        }

        let userId = 'user_' + Date.now();
        let userNickname = cleanEmail.split('@')[0];

        if (supabase) {
            try {
                const { data: existingUser } = await supabase
                    .from('users')
                    .select('*')
                    .eq('email', cleanEmail)
                    .single();

                if (existingUser) {
                    userId = existingUser.id;
                    userNickname = existingUser.nickname || userNickname;
                } else {
                    const crypto = require('crypto');
                    const newUuid = crypto.randomUUID();
                    const { data: newUser, error: createError } = await supabase
                        .from('users')
                        .insert([
                            { id: newUuid, email: cleanEmail, nickname: userNickname }
                        ])
                        .select()
                        .single();

                    if (!createError && newUser) {
                        userId = newUser.id;
                    } else {
                        userId = newUuid;
                    }
                }
            } catch (dbErr) {
                console.warn('Supabase DB Access Warning:', dbErr.message);
            }
        }

        const token = 'nexus_token_' + Buffer.from(cleanEmail + ':' + Date.now()).toString('base64');

        return res.status(200).json({
            success: true,
            message: '认证成功',
            token,
            user: {
                id: userId,
                email: cleanEmail,
                nickname: userNickname
            }
        });

    } catch (error) {
        console.error('Auth Verify Error:', error);
        return res.status(500).json({
            success: false,
            message: '系统验证过程异常: ' + error.message
        });
    }
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running locally on http://localhost:${PORT}`);
    });
}
