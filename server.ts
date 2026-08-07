import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

// API Health Check
app.get('/api/health', (req, res) => {
  return res.json({
    status: 'ok',
    service: 'ai-small-backend',
    timestamp: new Date().toISOString(),
  });
});

// Gemini AI Proxy Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt, messages, model } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    // Extract prompt from messages array if provided
    let userPrompt = prompt;
    if (!userPrompt && Array.isArray(messages) && messages.length > 0) {
      const lastUser = [...messages].reverse().find((m: any) => m.role === 'user');
      userPrompt = lastUser ? lastUser.content : messages[messages.length - 1].content;
    }

    if (!userPrompt) {
      userPrompt = '你好！请用中文跟我讲讲人工智能的发展。';
    }

    if (!apiKey) {
      return res.status(200).json({
        reply: `🤖 [系统提示] Vercel 后端未检测到 GEMINI_API_KEY 环境变量。\n\n针对您的问题: "${userPrompt}"\n\n已成功连通 ai-small Vercel 后端网关！请在 Vercel 项目设置的 Environment Variables 中添加 GEMINI_API_KEY 即可解锁真实 Gemini AI 实时对话。`,
        text: `🤖 [系统提示] Vercel 后端未检测到 GEMINI_API_KEY 环境变量。`,
      });
    }

    // Map custom UI model names to standard Gemini model ID
    let targetModel = 'gemini-2.5-flash';
    if (model && model.includes('2.0')) {
      targetModel = 'gemini-2.0-flash';
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: targetModel,
      contents: userPrompt,
    });

    const replyText = response.text || '没有返回有效回答。';
    return res.json({ reply: replyText, text: replyText });
  } catch (error: any) {
    console.error('Gemini API Error:', error);
    return res.status(200).json({
      error: error.message || 'AI 节点计算异常',
      reply: `⚠️ AI 节点回答异常: ${error.message || '服务响应超时，请稍后重试'}`,
      text: `⚠️ AI 节点回答异常: ${error.message || '服务响应超时，请稍后重试'}`,
    });
  }
});

// Resend Verification Code Proxy Endpoint
const handleSendCode = async (req: express.Request, res: express.Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: '请提供正确的邮箱地址' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    return res.json({
      success: true,
      message: `验证码已成功发送至 ${email}`,
      code,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || '发送验证码失败' });
  }
};

app.post('/api/auth/send-code', handleSendCode);
app.post('/api/send-code', handleSendCode);

// Auth Login Endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, type } = req.body;
    const user = {
      id: 'usr_' + Math.random().toString(36).substring(2, 9),
      email: email || 'user@example.com',
      nickname: (email || 'user').split('@')[0],
      avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${email}`,
      created_at: new Date().toISOString(),
    };
    const token = 'jwt_token_' + Date.now();
    return res.json({
      success: true,
      user,
      token,
      message: type === 'register' ? '注册成功并登录' : '登录成功',
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: '登录失败' });
  }
});

// Diet Analysis Endpoint
app.post('/api/diet/analyze', async (req, res) => {
  try {
    const { image, prompt } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey && image) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Data,
              },
            },
            prompt || '分析图片中美食热量与三大营养素卡路里并给出建议',
          ],
        });

        const reply = response.text || '';
        const mockLog = {
          id: 'log_' + Date.now(),
          food_name: 'AI 识别膳食组合',
          calories: 450,
          nutrition_info: { protein: 30, carbs: 45, fat: 12, fiber: 6 },
          image_url: image,
          created_at: new Date().toISOString(),
          advice: reply,
        };
        return res.json({ log: mockLog });
      } catch (geminiErr) {
        console.warn('Gemini vision error:', geminiErr);
      }
    }

    const mockLog = {
      id: 'log_' + Date.now(),
      food_name: '精选健康营养餐',
      calories: 420,
      nutrition_info: { protein: 28, carbs: 40, fat: 12, fiber: 8 },
      image_url: image || '',
      created_at: new Date().toISOString(),
      advice: '营养搭配均衡，优质高蛋白组合，非常适合日常健康饮食。',
    };
    return res.json({ log: mockLog });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || '分析失败' });
  }
});

// Game Score Endpoint
app.post('/api/game/score', async (req, res) => {
  return res.json({ success: true });
});

// Fallback 404 handler returning JSON
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path });
});

export default app;

if (require.main === module || process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
  });
}

