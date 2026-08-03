const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');

const app = express();

// 跨域与 JSON 解析中间件
app.use(cors());
app.use(express.json());

// 初始化 Supabase 客户端 (使用最高权限 service_role 写入 users 表)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 初始化 Resend 邮件服务客户端
const resend = new Resend(process.env.RESEND_API_KEY);

// 内存暂存验证码 (存储格式: Map<email, { code, expiresAt }>)
const codeStore = new Map();

// 服务健康检查根接口
app.get('/', (req, res) => {
  res.send('AI-Small Backend Service is Running on Vercel!');
});

/**
 * API 1: 发送邮箱验证码 (/api/auth/send-code)
 */
app.post('/api/auth/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: '请输入有效的邮箱地址' });
    }

    // 生成 6 位随机数字验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 分钟有效

    // 存入内存
    codeStore.set(email.toLowerCase(), { code, expiresAt });

    // 调用 Resend API 发送邮件
    const sendResult = await resend.emails.send({
      from: 'ai-small <onboarding@resend.dev>',
      to: [email],
      subject: '【ai-small.xyz】您的登录验证码',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2>欢迎使用 ai-small.xyz</h2>
          <p>您的登录验证码为：</p>
          <div style="font-size: 32px; font-weight: bold; color: #4F46E5; letter-spacing: 4px; margin: 20px 0;">
            ${code}
          </div>
          <p>验证码有效期为 5 分钟，请勿泄露给其他人。</p>
        </div>
      `
    });

    if (sendResult.error) {
      console.error('Resend 发送错误:', sendResult.error);
      return res.status(500).json({ success: false, error: '邮件发送失败，请稍后重试' });
    }

    return res.json({ success: true, message: '验证码已成功发送至您的邮箱' });
  } catch (err) {
    console.error('发送验证码异常:', err);
    return res.status(500).json({ success: false, error: err.message || '服务器内部错误' });
  }
});

/**
 * API 2: 校验验证码并完成注册/登录 (/api/auth/verify)
 */
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ success: false, error: '邮箱和验证码不能为空' });
    }

    const normalizedEmail = email.toLowerCase();
    const record = codeStore.get(normalizedEmail);

    if (!record) {
      return res.status(400).json({ success: false, error: '未找到验证码记录或验证码已失效' });
    }

    if (Date.now() > record.expiresAt) {
      codeStore.delete(normalizedEmail);
      return res.status(400).json({ success: false, error: '验证码已过期，请重新获取' });
    }

    if (record.code !== code.toString().trim()) {
      return res.status(400).json({ success: false, error: '验证码输入错误' });
    }

    // 验证成功，清除内存记录
    codeStore.delete(normalizedEmail);

    // 查询 Supabase users 表是否存在该用户
    let { data: existingUser, error: queryError } = await supabase
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (queryError) {
      console.error('查询 Supabase 失败:', queryError);
    }

    let user = existingUser;

    // 若用户不存在则新建落盘
    if (!user) {
      const newUserId = crypto.randomUUID();
      const nickname = normalizedEmail.split('@')[0];
      const avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${nickname}`;

      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{
          id: newUserId,
          email: normalizedEmail,
          nickname: nickname,
          avatar_url: avatarUrl
        }])
        .select()
        .single();

      if (insertError) {
        console.error('创建用户落盘失败:', insertError);
        return res.status(500).json({ success: false, error: '数据库写入失败: ' + insertError.message });
      }

      user = newUser;
    }

    // 生成前端持久化 Token
    const authToken = `token_${user.id}_${Date.now()}`;

    return res.json({
      success: true,
      message: '登录成功',
      token: authToken,
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        avatar_url: user.avatar_url
      }
    });

  } catch (err) {
    console.error('校验登录异常:', err);
    return res.status(500).json({ success: false, error: err.message || '服务器内部错误' });
  }
});

// 本地开发监听与 Vercel Serverless 导出兼容
const PORT = process.env.PORT || 10000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = app;
