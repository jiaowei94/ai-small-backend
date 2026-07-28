const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const app = express();

// 1. 强制跨域响应头中间件（优先处理预检请求，防止重定向阻断）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 如果是 OPTIONS 预检请求，直接成功响应 204，不进入后续路由，彻底防止跨域拦截
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// 初始化客户端
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);
const resend = new Resend(process.env.RESEND_API_KEY || '');

// 内存暂存验证码（生产环境建议使用 Redis 或 Supabase 数据库表保存）
const codeStore = new Map();

// 2. 基础健康检查接口
app.get('/', (req, res) => {
  res.status(200).send('AI-Small Backend Service is Running on Vercel!');
});

// 3. 发送邮件验证码接口 (/api/auth/send-code)
app.post('/api/auth/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  // 生成 6 位纯数字验证码
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  // 保存验证码及过期时间（5 分钟后过期）
  codeStore.set(email, { code, expires: Date.now() + 5 * 60 * 1000 });

  try {
    const data = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: email, // 注意：免费测试阶段，收件人必须是您注册 Resend 时的同一个邮箱
      subject: '您的验证码 - ai-small.xyz',
      html: `<p>您的注册验证码为：<strong>${code}</strong>，5分钟内有效。</p>`
    });

    if (data.error) {
      console.error('Resend API Error:', data.error);
      return res.status(400).json({ success: false, message: data.error.message || '邮件发送失败' });
    }

    res.json({ success: true, message: '验证码发送成功，请检查邮箱' });
  } catch (err) {
    console.error('Server Exception:', err);
    res.status(500).json({ success: false, message: err.message || '服务器内部异常' });
  }
});

// 4. 验证码校验及注册/登录接口 (/api/auth/verify-code)
app.post('/api/auth/verify-code', async (req, res) => {
  const { email, code, password } = req.body;
  if (!email || !code) {
    return res.status(400).json({ success: false, message: '请输入邮箱和验证码' });
  }

  const record = codeStore.get(email);
  if (!record) {
    return res.status(400).json({ success: false, message: '请先获取验证码' });
  }

  if (Date.now() > record.expires) {
    codeStore.delete(email);
    return res.status(400).json({ success: false, message: '验证码已过期，请重新获取' });
  }

  if (record.code !== code) {
    return res.status(400).json({ success: false, message: '验证码不正确' });
  }

  // 校验成功，清除验证码记录
  codeStore.delete(email);

  res.json({
    success: true,
    message: '验证成功',
    token: 'user_active_' + Date.now()
  });
});

module.exports = app;
