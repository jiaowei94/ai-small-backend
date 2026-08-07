import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

// 健康检查
app.get('/api/health', (req, res) => {
  return res.json({
    status: 'ok',
    service: 'ai-small-backend',
    timestamp: new Date().toISOString(),
  });
});

// Gemini AI 对话网关
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt, messages, model } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    let userPrompt = prompt;
    if (!userPrompt && Array.isArray(messages) && messages.length > 0) {
      const lastUser = [...messages].reverse().find((m: any) => m.role === 'user');
      userPrompt = lastUser ? lastUser.content : messages[messages.length - 1].content;
    }

    if (!userPrompt) userPrompt = '你好！';

    if (!apiKey) {
      return res.status(200).json({
        reply: `🤖 [系统提示] Vercel 后端已连通！但未检测到 GEMINI_API_KEY。\n\n请在 Vercel 后端项目的 Settings -> Environment Variables 中配置 GEMINI_API_KEY 环境变量即可。`,
        text: `🤖 [系统提示] Vercel 后端未检测到 GEMINI_API_KEY。`
      });
    }

    let targetModel = 'gemini-2.5-flash';
    if (model && model.includes('2.0')) targetModel = 'gemini-2.0-flash';

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: targetModel,
      contents: userPrompt,
    });

    const replyText = response.text || '无有效回复。';
    return res.json({ reply: replyText, text: replyText });
  } catch (error: any) {
    return res.status(200).json({
      reply: `⚠️ AI 服务提示: ${error.message || '节点响应超时，请稍后重试'}`,
      text: `⚠️ AI 服务提示: ${error.message || '节点响应超时'}`
    });
  }
});

// 验证码发送网关
app.post('/api/auth/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: '请输入正确邮箱' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const resendApiKey = process.env.RESEND_API_KEY;

    if (resendApiKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'ai-small <onboarding@resend.dev>',
            to: [email],
            subject: '【ai-small】您的验证码',
            html: `<p>您的验证码是：<strong style="font-size:20px;color:#0284c7;">${code}</strong></p>`,
          }),
        });
      } catch (err) {
        console.warn('Resend 邮件发送异步告警:', err);
      }
    }

    return res.json({
      success: true,
      message: resendApiKey ? `验证码已发送至 ${email}` : `验证码已发送至 ${email} (测试仿真码: ${code})`,
      code,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || '发送失败' });
  }
});

app.post('/api/send-code', (req, res) => app._router.handle(req, res, () => {}));

export default app;
