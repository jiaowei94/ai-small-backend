const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// 基础中间件配置
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 初始化云服务客户端（从环境变量读取安全密钥）
const supabase = createClient(
  process.env.SUPABASE_URL || '', 
  process.env.SUPABASE_KEY || ''
);
const resend = new Resend(process.env.RESEND_API_KEY || '');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// 1. 基础健康检查接口
app.get('/', (req, res) => {
  res.status(200).send('AI-Small Backend Service is Running on Vercel!');
});

// 2. 发送邮件验证码接口 (/api/auth/send-code)
app.post('/api/auth/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  try {
    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: email,
      subject: '您的验证码 - ai-small.xyz',
      html: `<p>您的注册验证码为：<strong>${code}</strong>，5分钟内有效。</p>`
    });
    res.json({ success: true, message: 'Code sent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. 智能膳食识别接口 (/api/diet/analyze)
app.post('/api/diet/analyze', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Image data required' });

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = '请分析这张图片中的食物，返回 JSON 格式，包含：food_name (菜名), calories (估算卡路里数), protein (蛋白质克数), fat (脂肪克数), carbs (碳水化合物克数)。请仅返回标准 JSON，不要带有 Markdown 格式化包裹。';
    
    const imageParts = [
      {
        inlineData: {
          data: imageBase64.replace(/^data:image\/\w+;base64,/, ''),
          mimeType: 'image/jpeg'
        }
      }
    ];

    const result = await model.generateContent([prompt, ...imageParts]);
    const responseText = result.response.text();
    res.json({ result: responseText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 关键修正：导出 app 对象以完美适配 Vercel 的云函数环境
module.exports = app;
