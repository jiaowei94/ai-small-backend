const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '10mb' }));

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);
const resend = new Resend(process.env.RESEND_API_KEY || '');

const codeStore = new Map();

app.get('/', (req, res) => {
  res.status(200).send('AI-Small Backend Service is Running on Vercel!');
});

// 1. 发送验证码
app.post('/api/auth/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  codeStore.set(email, { code, expires: Date.now() + 5 * 60 * 1000 });

  try {
    const data = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: email,
      subject: '您的验证码 - ai-small.xyz',
      html: `<p>您的注册验证码为：<strong>${code}</strong>，5分钟内有效。</p>`
    });

    if (data.error) {
      return res.status(400).json({ success: false, message: data.error.message });
    }
    res.json({ success: true, message: '验证码发送成功，请检查邮箱' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. 验证码注册/登录 & 写入 Supabase users 表
app.post('/api/auth/verify-code', async (req, res) => {
  const { email, code, password } = req.body;
  if (!email || !code) return res.status(400).json({ success: false, message: '请输入邮箱和验证码' });

  const record = codeStore.get(email);
  if (!record) return res.status(400).json({ success: false, message: '请先获取验证码' });
  if (Date.now() > record.expires) {
    codeStore.delete(email);
    return res.status(400).json({ success: false, message: '验证码已过期' });
  }
  if (record.code !== code) {
    return res.status(400).json({ success: false, message: '验证码不正确' });
  }

  codeStore.delete(email);

  try {
    // 检查用户是否已存在
    const { data: existingUser } = await supabase.from('users').select('*').eq('email', email).single();

    let userId = existingUser?.id;

    if (!existingUser) {
      // 若用户不存在，自动创建新用户记录写入 Supabase users 表
      userId = crypto.randomUUID();
      const { error: insertErr } = await supabase.from('users').insert([
        {
          id: userId,
          email: email,
          nickname: email.split('@')[0],
          created_at: new Date().toISOString()
        }
      ]);
      if (insertErr) console.error('Supabase Insert Error:', insertErr);
    }

    res.json({
      success: true,
      message: '验证成功',
      token: 'user_active_' + userId,
      user: { id: userId, email: email }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = app;
