const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();

// 1. 中间件配置
app.use(cors());
app.use(express.json());

// 2. 从环境变量安全读取凭证（安全防范：绝不硬编码敏感 Key）
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // service_role 密钥
const resendApiKey = process.env.RESEND_API_KEY;

if (!supabaseUrl || !supabaseKey || !resendApiKey) {
  console.warn("⚠️ 警告: 存在未配置的环境变量，请检查 Vercel 后台 Environment Variables 设置！");
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '');
const resend = new Resend(resendApiKey || '');

// 内存保存验证码临时状态 (内存存取适配 Serverless 节点)
const otpStore = new Map();

// 健康检查路由
app.get('/', (req, res) => {
  res.send('AI-Small Backend Service is Running on Vercel!');
});

/**
 * API: 发送验证码
 * 适用场景：新用户注册、找回密码
 */
app.post('/api/auth/send-code', async (req, res) => {
  try {
    const { email, type } = req.body; // type: 'register' | 'reset_password'
    if (!email) {
      return res.status(400).json({ success: false, message: '请提供有效的邮箱地址' });
    }

    // 校验该邮箱是否已注册
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (type === 'register' && existingUser) {
      return res.status(400).json({ success: false, message: '该邮箱已被注册，请直接登录' });
    }

    if (type === 'reset_password' && !existingUser) {
      return res.status(400).json({ success: false, message: '该邮箱尚未注册，请先注册账号' });
    }

    // 生成 6 位随机验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 保存至内存中，有效期 5 分钟
    otpStore.set(email, {
      code,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    // 调用 Resend API 发送邮件（兼容 QQ 邮箱等国内服务商）
    const subjectTitle = type === 'register' ? '注册验证码' : '重置密码验证码';
    await resend.emails.send({
      from: 'AI-Small Team <no-reply@ai-small.xyz>',
      to: [email],
      subject: `【AI-Small】您的${subjectTitle}`,
      html: `
        <div style="padding: 20px; font-family: sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #2563eb;">AI-Small 验证服务</h2>
          <p>您好！您正在进行 <strong>${subjectTitle}</strong> 操作。</p>
          <p>您的动态验证码为：</p>
          <div style="background: #f3f4f6; padding: 12px 24px; font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #2563eb; display: inline-block; border-radius: 6px; margin: 10px 0;">
            ${code}
          </div>
          <p>验证码有效期为 5 分钟。如非本人操作，请忽略此邮件。</p>
        </div>
      `
    });

    return res.json({ success: true, message: '验证码已发送，请检查您的邮箱（包含垃圾邮件箱）' });
  } catch (error) {
    console.error('Send Code Error:', error);
    return res.status(500).json({ success: false, message: '验证码发送失败: ' + error.message });
  }
});

/**
 * API: 注册账号 (需输入密码 + 验证码)
 */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, code, nickname } = req.body;

    if (!email || !password || !code) {
      return res.status(400).json({ success: false, message: '请完整填写邮箱、密码与验证码' });
    }

    // 校验验证码
    const record = otpStore.get(email);
    if (!record || record.code !== code || Date.now() > record.expiresAt) {
      return res.status(400).json({ success: false, message: '验证码无效或已过期' });
    }

    // 在 Supabase 创建 Auth 用户
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) {
      return res.status(400).json({ success: false, message: authError.message });
    }

    const userId = authData.user.id;

    // 写入 public.users 业务扩展信息表
    const { error: dbError } = await supabase
      .from('users')
      .insert([
        {
          id: userId,
          email,
          nickname: nickname || email.split('@')[0],
          avatar_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=' + userId
        }
      ]);

    if (dbError) {
      return res.status(500).json({ success: false, message: '用户初始化失败: ' + dbError.message });
    }

    // 验证成功后删除验证码记录
    otpStore.delete(email);

    return res.json({
      success: true,
      message: '注册成功！请登录',
      user: { id: userId, email, nickname }
    });
  } catch (error) {
    console.error('Register Error:', error);
    return res.status(500).json({ success: false, message: '注册失败: ' + error.message });
  }
});

/**
 * API: 密码登录 (日常登录，无需验证码)
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: '请输入邮箱与密码' });
    }

    // 校验账号密码
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(401).json({ success: false, message: '账号或密码错误' });
    }

    // 查询扩展个人信息
    const { data: userInfo } = await supabase
      .from('users')
      .select('id, email, nickname, avatar_url')
      .eq('id', data.user.id)
      .single();

    return res.json({
      success: true,
      message: '登录成功',
      token: data.session.access_token,
      user: userInfo || { id: data.user.id, email: data.user.email }
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ success: false, message: '登录失败: ' + error.message });
  }
});

/**
 * API: 重置/找回密码 (需验证码)
 */
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ success: false, message: '请完整填写参数' });
    }

    // 校验验证码
    const record = otpStore.get(email);
    if (!record || record.code !== code || Date.now() > record.expiresAt) {
      return res.status(400).json({ success: false, message: '验证码错误或已过期' });
    }

    // 根据邮箱获取用户 ID
    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (!userData) {
      return res.status(404).json({ success: false, message: '未找到该用户' });
    }

    // 更新用户密码
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      userData.id,
      { password: newPassword }
    );

    if (updateError) {
      return res.status(500).json({ success: false, message: updateError.message });
    }

    otpStore.delete(email);

    return res.json({ success: true, message: '密码重置成功，请使用新密码登录！' });
  } catch (error) {
    console.error('Reset Password Error:', error);
    return res.status(500).json({ success: false, message: '重置密码失败: ' + error.message });
  }
});

// Vercel Serverless 入口暴露
module.exports = app;

// 本地开发启动服务
if (require.main === module) {
  const PORT = process.env.PORT || 10000;
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}
