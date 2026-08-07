import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// API Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-small-backend',
    timestamp: new Date().toISOString(),
  });
});

// Gemini AI Proxy Endpoint (keeps GEMINI_API_KEY safely on server)
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt, model = 'gemini-2.5-flash' } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY 未在 Vercel 环境变量中配置' });
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    return res.json({ text: response.text });
  } catch (error: any) {
    console.error('Gemini API Error:', error);
    return res.status(500).json({ error: error.message || 'AI 生成失败' });
  }
});

// Resend Verification Code Proxy Endpoint
app.post('/api/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    const resendKey = process.env.RESEND_API_KEY;

    if (!resendKey) {
      return res.status(500).json({ error: 'RESEND_API_KEY 未在 Vercel 环境变量中配置' });
    }

    // Generate 6 digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Mock send response (or integration with Resend API)
    return res.json({
      success: true,
      message: `验证码已发送至 ${email}`,
      code, // In production, send via Resend email
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || '发送验证码失败' });
  }
});

export default app;

if (require.main === module || process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
  });
}
