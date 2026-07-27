const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 初始化云服务客户端
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 基础健康检查接口
app.get('/', (req, res) => {
  res.send('AI-Small Backend Service is Running!');
});

// 1. 发送邮件验证码接口 (/api/auth/send-code)
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

// 2. 智能膳食识别接口 (/api/diet/analyze)
app.post('/api/diet/analyze', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Image data required' });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
          }
        },
        '请分析这张图片中的食物，返回 JSON 格式，包含：food_name (菜名), calories (估算卡路里数), protein (蛋白质克数), fat (脂肪克数), carbs (碳水化合物克数)。请仅返回标准 JSON，不要带有 Markdown 格式化包裹。'
      ]
    });
    res.json({ result: response.text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. WebSocket 实时社区长连接 (/ddd)
wss.on('connection', (ws) => {
  console.log('New client connected');

  ws.on('message', async (data) => {
    try {
      const parsed = JSON.parse(data);
      // 广播给所有在线连接的用户
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(parsed));
        }
      });
    } catch (e) {
      console.error('WS Error:', e);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
