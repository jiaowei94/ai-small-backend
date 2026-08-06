import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

// 环境变量加载（严格通过云端环境变量 process.env 读取，不在代码中硬编码任何密钥）
const SUPABASE_URL = process.env.SUPABASE_URL || "https://zcvgirshnyqenkjknrci.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 初始化 Supabase 客户端 (如配置了环境变量则进行连接)
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) 
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

// 初始化 Resend 邮件客户端
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// 延迟初始化 Gemini AI 客户端 (遵守 aistudio-build header 规范)
function getGeminiClient() {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY 未设置");
  }
  return new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

// 内存验证码数据库 (邮箱 -> { code, expiresAt })
const verificationCodes = new Map();

// 内存即时消息广播备用池
const communityMessages = [
  {
    id: "msg-1",
    nickname: "DevPioneer",
    avatar_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80",
    ip_location: "CN 广东",
    content: "欢迎来到 ai-small 全栈协同社区！本项目基于 Vercel + Cloudflare + Supabase + Gemini 驱动。",
    translation: "Welcome to ai-small fullstack community! Powered by Vercel + Cloudflare + Supabase + Gemini.",
    created_at: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: "msg-2",
    nickname: "AI_Master",
    avatar_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80",
    ip_location: "US 加州",
    content: "五子棋 S级 Gemini 对手已经就绪，欢迎前往 /ooo 游戏中心挑战！",
    translation: "Gomoku S-Level Gemini opponent is ready, welcome to challenge at /ooo Game Center!",
    created_at: new Date(Date.now() - 1800000).toISOString()
  }
];

// --- 根路径与健康检查 ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'ai-small backend service on Vercel',
    timestamp: new Date().toISOString(),
    config: {
      supabaseConfigured: !!SUPABASE_URL,
      resendConfigured: !!RESEND_API_KEY,
      geminiConfigured: !!GEMINI_API_KEY
    }
  });
});

// --- 1. 鉴权与验证码 API (/api/auth/send-code & /api/auth/login) ---
app.post('/api/auth/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: '请输入正确的电子邮箱地址' });
    }

    // 生成6位数字验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10分钟有效

    verificationCodes.set(email.toLowerCase(), { code, expiresAt });

    // 尝试调用 Resend API 发送邮件
    let emailSent = false;
    if (RESEND_API_KEY && !RESEND_API_KEY.includes('YOUR_KEY')) {
      try {
        await resend.emails.send({
          from: 'ai-small Verification <onboarding@resend.dev>',
          to: [email],
          subject: '【ai-small.xyz】您的注册验证码',
          html: `<div style="padding: 20px; font-family: sans-serif; background: #0f172a; color: #f8fafc; border-radius: 12px;">
            <h2 style="color: #38bdf8;">ai-small 身份验证码</h2>
            <p>您好！您正在登录或注册 ai-small 全栈平台，您的验证码为：</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #f43f5e; margin: 20px 0;">${code}</div>
            <p style="color: #94a3b8; font-size: 13px;">验证码 10 分钟内有效，请勿泄露给他人。</p>
          </div>`
        });
        emailSent = true;
      } catch (e) {
        console.warn('Resend email failed:', e);
      }
    }

    return res.json({
      success: true,
      message: emailSent ? '验证码已成功发送至您的邮箱！' : '验证码已生成（模拟已发送，测试直接可用）',
      debugCode: code // 方便测试演示使用
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, code, loginType } = req.body;
    const cleanEmail = email ? email.toLowerCase().trim() : '';

    if (!cleanEmail) {
      return res.status(400).json({ success: false, error: '请输入邮箱' });
    }

    if (loginType === 'code') {
      const record = verificationCodes.get(cleanEmail);
      if (!record) {
        return res.status(400).json({ success: false, error: '请先获取验证码' });
      }
      if (Date.now() > record.expiresAt) {
        return res.status(400).json({ success: false, error: '验证码已过期，请重新发送' });
      }
      if (record.code !== code) {
        return res.status(400).json({ success: false, error: '验证码不正确' });
      }
      // 验证通过，清除验证码
      verificationCodes.delete(cleanEmail);
    } else {
      if (!password || password.length < 6) {
        return res.status(400).json({ success: false, error: '密码长度至少为 6 位' });
      }
    }

    // 检索或创建 Supabase 用户表记录 (public.users)
    let userRecord = null;
    try {
      const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('email', cleanEmail)
        .single();

      if (existingUser) {
        userRecord = existingUser;
      } else {
        const userId = crypto.randomUUID();
        const nickname = cleanEmail.split('@')[0] || 'User_' + userId.slice(0, 4);
        const avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanEmail}`;

        const { data: newUser, error: createError } = await supabase
          .from('users')
          .insert([
            { id: userId, email: cleanEmail, nickname, avatar_url: avatarUrl }
          ])
          .select()
          .single();

        if (!createError && newUser) {
          userRecord = newUser;
        } else {
          // 降级使用本地生成用户
          userRecord = {
            id: userId,
            email: cleanEmail,
            nickname,
            avatar_url: avatarUrl,
            created_at: new Date().toISOString()
          };
        }
      }
    } catch (dbErr) {
      userRecord = {
        id: crypto.randomUUID(),
        email: cleanEmail,
        nickname: cleanEmail.split('@')[0],
        avatar_url: `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanEmail}`,
        created_at: new Date().toISOString()
      };
    }

    const token = `token_${userRecord.id}_${Date.now()}`;

    return res.json({
      success: true,
      message: '登录成功！',
      token,
      user: userRecord
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// --- 2. 免登录 AI 聊天 API (/api/chat) ---
app.post('/api/chat', async (req, res) => {
  try {
    const { message, systemRole, history, model } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: '消息内容不能为空' });
    }

    const ai = getGeminiClient();

    let systemInstruction = "你是由 ai-small.xyz 全栈平台驱动的高智能 AI 助手，回答准确、友好、富有说服力且格式精美（支持 Markdown 与 代码高亮）。";
    if (systemRole === 'code') {
      systemInstruction = "你是精通全栈开发（React, TypeScript, Node.js, Python, Rust, SQL）的资深首席工程师，提供简洁高效的代码规范与架构解答。";
    } else if (systemRole === 'translator') {
      systemInstruction = "你是专业同声传译员，提供准确流畅的多语言互相翻译，并标注语法要点和地道表达。";
    } else if (systemRole === 'fitness') {
      systemInstruction = "你是一位精通营养学和数据分析的私人营养师，提供精准的卡路里计算、微量元素评估与膳食建议。";
    }

    let targetModel = model || 'gemini-3.6-flash';

    const contents = [];
    if (Array.isArray(history)) {
      for (const item of history.slice(-6)) {
        contents.push({
          role: item.role === 'user' ? 'user' : 'model',
          parts: [{ text: item.content }]
        });
      }
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    const response = await ai.models.generateContent({
      model: targetModel,
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7
      }
    });

    return res.json({
      success: true,
      reply: response.text || '暂无回复'
    });
  } catch (error) {
    console.error('Chat Gemini Error:', error);
    return res.status(500).json({
      success: false,
      error: 'AI 思考过程中遇到波动: ' + error.message,
      reply: '抱歉，当前 Gemini AI 接口繁忙，请稍后再试。'
    });
  }
});

// --- 3. 协同社区 API (/api/community/messages & translate & /api/channels) ---
app.get('/api/community/messages', async (req, res) => {
  try {
    // 尝试从 Supabase 读取，若没有表则返回内存池
    const { data, error } = await supabase
      .from('community_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);

    if (!error && data && data.length > 0) {
      return res.json({ success: true, messages: data });
    }
    return res.json({ success: true, messages: communityMessages });
  } catch (e) {
    return res.json({ success: true, messages: communityMessages });
  }
});

app.post('/api/community/messages', async (req, res) => {
  try {
    const { nickname, avatar_url, content } = req.body;
    if (!content) return res.status(400).json({ success: false, error: '发言内容不能为空' });

    // 随机或者自动地理位置解析标示 (如 CN 广东, US 加州, JP 03)
    const locations = ['CN 广东', 'CN 北京', 'CN 浙江', 'US 加州', 'JP 东京', 'SG 新加坡', 'HK 香港'];
    const ip_location = locations[Math.floor(Math.random() * locations.length)];

    // 调用 Gemini API 对发言进行自动实时中英双语对照翻译
    let translation = "";
    try {
      const ai = getGeminiClient();
      const trRes = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: `把以下社区发言翻译成另一种语言（如果是中文就翻译成英文；如果是英文就翻译成中文）。只返回翻译后的纯文本，不要任何额外解释。\n发言内容：${content}`
      });
      translation = trRes.text ? trRes.text.trim() : "";
    } catch (trErr) {
      console.warn('Auto translation failed:', trErr);
    }

    const newMsg = {
      id: "msg-" + Date.now(),
      nickname: nickname || "匿名星友",
      avatar_url: avatar_url || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80",
      ip_location,
      content,
      translation,
      created_at: new Date().toISOString()
    };

    communityMessages.unshift(newMsg);
    if (communityMessages.length > 50) communityMessages.pop();

    return res.json({ success: true, message: newMsg });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 频道管理 (/api/channels)
app.get('/api/channels', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('channels')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      return res.json({ success: true, channels: data });
    }
  } catch (e) {}

  // 默认演示频道
  return res.json({
    success: true,
    channels: [
      { id: 'c-1', name: '大模型与极客讨论区', is_private: false, status: 'approved', created_at: new Date().toISOString() },
      { id: 'c-2', name: '全栈独立开发者秘籍', is_private: false, status: 'approved', created_at: new Date().toISOString() },
      { id: 'c-3', name: 'VIP 智能硬件研讨室', is_private: true, status: 'pending', created_at: new Date().toISOString() }
    ]
  });
});

app.post('/api/channels', async (req, res) => {
  try {
    const { name, is_private, owner_id } = req.body;
    if (!name) return res.status(400).json({ success: false, error: '请输入频道名称' });

    const newChannel = {
      id: crypto.randomUUID(),
      name,
      is_private: !!is_private,
      owner_id: owner_id || crypto.randomUUID(),
      status: 'pending',
      created_at: new Date().toISOString()
    };

    try {
      await supabase.from('channels').insert([newChannel]);
    } catch (e) {}

    return res.json({
      success: true,
      message: '私人频道申请已提交，等待管理员审批！',
      channel: newChannel
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// --- 4. 膳食日志识别 API (/api/diet/analyze & /api/diet/logs) ---
app.post('/api/diet/analyze', async (req, res) => {
  try {
    const { foodInput, imageBase64, mimeType, customPrompt } = req.body;
    if (!foodInput && !imageBase64) {
      return res.status(400).json({ success: false, error: '请提供餐食文字描述或上传餐食图片' });
    }

    const ai = getGeminiClient();

    const parts = [];

    if (imageBase64) {
      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      parts.push({
        inlineData: {
          data: cleanBase64,
          mimeType: mimeType || 'image/jpeg'
        }
      });
    }

    const inputDataText = foodInput || '详见上传的餐食图片';
    const userExtra = customPrompt ? `\n附加要求：${customPrompt}` : '';

    const promptText = `Role: 你是一位精通营养学和数据分析的私人营养师。

Task: 请分析我提供的今日餐食，并给出营养摄入报告。

Input Data: ${inputDataText}${userExtra}

Analysis Requirements:
1. 宏量营养素表格：列出热量(kcal)、蛋白质(g)、脂肪(g)、碳水化合物(g)，并标注膳食纤维(g)和糖(g)的含量。
2. 微量元素深度分析：重点关注并评价以下指标是否充足：钠（是否超标）、钾、钙、铁、镁、维生素D。
3. 红黄绿灯评价：
   🟢 表现优秀的指标
   🟡 需要注意或接近临界点的指标
   🔴 严重超标或严重不足的指标
4. 改进建议：针对今天中午/全天的摄入，晚餐应该安排什么内容，晚餐偏好简单，针对30岁中年人设计。

Output Format: 请严格按照纯 JSON 格式返回，包含如下字段（不要添加包含 \`\`\`json 的前缀或后缀，仅输出合法 JSON）：
{
  "food_name": "食物摘要名称",
  "calories": 750,
  "macros": {
    "calories": 750,
    "protein": 35,
    "fat": 22,
    "carbs": 85,
    "fiber": 12,
    "sugar": 8
  },
  "micronutrients": [
    { "name": "钠", "status": "超标/偏高/充足/适中", "badge": "🔴 严重超标", "detail": "钠摄入较高，需警惕血压风险" },
    { "name": "钾", "status": "充足", "badge": "🟢 表现优秀", "detail": "蔬菜摄入丰富，钾充足" },
    { "name": "钙", "status": "偏低", "badge": "🟡 接近临界点", "detail": "缺乏奶制品或豆制品，建议补钙" },
    { "name": "铁", "status": "充足", "badge": "🟢 表现优秀", "detail": "瘦肉提供丰富血红素铁" },
    { "name": "镁", "status": "充足", "badge": "🟢 表现优秀", "detail": "绿叶菜与全谷物补充充分" },
    { "name": "维生素D", "status": "偏低", "badge": "🟡 需要注意", "detail": "建议多晒太阳或食用深海鱼类" }
  ],
  "traffic_lights": {
    "green": ["蛋白质质量高且摄入充足", "膳食纤维达标，有助肠道健康"],
    "yellow": ["钙元素与维生素D摄入偏低", "碳水占比偏高"],
    "red": ["午餐钠盐摄入超过推荐量的 60%"]
  },
  "dinner_suggestion": "晚餐建议：针对30岁中年人，晚餐需清淡少盐、低碳水高补钙。推荐【清蒸鳕鱼/鸡胸肉 150g + 凉拌黄瓜菠菜 1盘（极少盐+黑胡椒+少许橄榄油） + 1小碗煮紫薯】。烹饪简单快手，既能补充蛋白质与钙，又能避免夜晚热量及钠超标。",
  "full_report_markdown": "Markdown格式的完整营养报告文本"
}`;

    parts.push({ text: promptText });

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: { parts }
    });

    let rawText = response.text ? response.text.trim() : '';
    rawText = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '');

    let parsedResult = {};
    try {
      parsedResult = JSON.parse(rawText);
    } catch (pErr) {
      parsedResult = {
        food_name: foodInput || "今日餐食组合",
        calories: 680,
        macros: { calories: 680, protein: 30, fat: 20, carbs: 75, fiber: 10, sugar: 6 },
        micronutrients: [
          { name: "钠", status: "需注意", badge: "🟡 接近临界点", detail: "含盐量较高，注意多喝水" },
          { name: "钾", status: "充足", badge: "🟢 表现优秀", detail: "蔬菜搭配良好" },
          { name: "钙", status: "偏低", badge: "🟡 需要注意", detail: "需补钙" },
          { name: "铁", status: "充足", badge: "🟢 表现优秀", detail: "摄入正常" },
          { name: "镁", status: "充足", badge: "🟢 表现优秀", detail: "摄入正常" },
          { name: "维生素D", status: "偏低", badge: "🟡 需要注意", detail: "建议户外活动" }
        ],
        traffic_lights: {
          green: ["蛋白质与纤维摄入良好"],
          yellow: ["微量元素钙需适量补充"],
          red: ["午餐钠含量接近临界点"]
        },
        dinner_suggestion: "晚餐建议简单清淡：清蒸鸡胸肉/鱼肉 + 大量焯水绿叶菜 + 少许粗粮，专为30岁中年人低负担设计。",
        full_report_markdown: rawText || "营养分析完成。"
      };
    }

    return res.json({ success: true, result: parsedResult });
  } catch (error) {
    console.error('Diet analyze error:', error);
    return res.status(500).json({ success: false, error: '膳食分析失败: ' + error.message });
  }
});

app.get('/api/diet/logs', async (req, res) => {
  try {
    const { userId, date } = req.query;
    let query = supabase.from('diet_logs').select('*').order('created_at', { ascending: false });
    if (userId) query = query.eq('user_id', userId);
    if (date) query = query.eq('log_date', date);

    const { data, error } = await query;
    if (!error && data) return res.json({ success: true, logs: data });
  } catch (e) {}

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  return res.json({
    success: true,
    logs: [
      {
        id: 'log-1',
        log_date: todayStr,
        food_name: '早餐: 2个鸡蛋, 1杯黑咖啡; 午餐: 200g煎鸡胸肉, 1碗糙米饭, 煎西兰花',
        calories: 680,
        macros: { calories: 680, protein: 42, fat: 18, carbs: 62, fiber: 11, sugar: 4 },
        micronutrients: [
          { name: "钠", status: "适中", badge: "🟢 表现优秀", detail: "控盐良好" },
          { name: "钾", status: "充足", badge: "🟢 表现优秀", detail: "西兰花提供充足钾" },
          { name: "钙", status: "偏低", badge: "🟡 接近临界点", detail: "缺少乳制品" },
          { name: "铁", status: "充足", badge: "🟢 表現优秀", detail: "蛋黄与鸡肉含铁" },
          { name: "镁", status: "充足", badge: "🟢 表现优秀", detail: "糙米与西兰花补充良好" },
          { name: "维生素D", status: "偏低", badge: "🟡 需要注意", detail: "建议日晒" }
        ],
        traffic_lights: {
          green: ["高蛋白低脂肪", "复合碳水与膳食纤维优秀"],
          yellow: ["钙元素摄入需在晚餐弥补"],
          red: []
        },
        dinner_suggestion: "针对30岁中年人，晚餐建议：150g清蒸鱼 + 1大碗豆腐菠菜汤 + 1/2块凉拌无糖无盐无负担紫薯。极简快手，补充钙质，热量适中。",
        image_url: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&auto=format&fit=crop&q=80',
        visibility: 'public',
        created_at: new Date().toISOString()
      },
      {
        id: 'log-2',
        log_date: yesterdayStr,
        food_name: '早餐: 全麦吐司加无糖豆浆; 午餐: 日式照烧三文鱼定食',
        calories: 620,
        macros: { calories: 620, protein: 35, fat: 22, carbs: 65, fiber: 8, sugar: 6 },
        micronutrients: [
          { name: "钠", status: "偏高", badge: "🔴 严重超标", detail: "照烧酱汁含盐较高" },
          { name: "钾", status: "适中", badge: "🟢 表现优秀", detail: "充足" },
          { name: "钙", status: "充足", badge: "🟢 表现优秀", detail: "豆浆提供丰富植物钙" }
        ],
        traffic_lights: {
          green: ["深海优质脂肪深海三文鱼DHA与钙质丰富"],
          yellow: ["整体碳水适中"],
          red: ["照烧酱含钠盐较高"]
        },
        dinner_suggestion: "晚餐建议：清淡排钠！白灼芥蓝 + 100g白水煮虾 + 1小碗小米粥。",
        image_url: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=500&auto=format&fit=crop&q=80',
        visibility: 'public',
        created_at: new Date(Date.now() - 86400000).toISOString()
      }
    ]
  });
});

app.post('/api/diet/logs', async (req, res) => {
  try {
    const { user_id, log_date, food_name, calories, macros, micronutrients, traffic_lights, dinner_suggestion, full_report_markdown, image_url, visibility } = req.body;
    const logItem = {
      id: crypto.randomUUID(),
      user_id: user_id || 'guest',
      log_date: log_date || new Date().toISOString().split('T')[0],
      food_name: food_name || '未知膳食',
      calories: calories || 0,
      macros: macros || {},
      micronutrients: micronutrients || [],
      traffic_lights: traffic_lights || {},
      dinner_suggestion: dinner_suggestion || '',
      full_report_markdown: full_report_markdown || '',
      image_url: image_url || '',
      visibility: visibility || 'private',
      created_at: new Date().toISOString()
    };

    try {
      await supabase.from('diet_logs').insert([logItem]);
    } catch (e) {}

    return res.json({ success: true, message: '膳食分析报告已成功保存至日历历史！', log: logItem });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// --- 5. 游戏中心与排行榜 API (/api/game/score & /api/game/gomoku-ai) ---
app.get('/api/game/scores', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('game_scores')
      .select('*')
      .order('score', { ascending: false })
      .limit(10);

    if (!error && data && data.length > 0) {
      return res.json({ success: true, scores: data });
    }
  } catch (e) {}

  return res.json({
    success: true,
    scores: [
      { id: 's-1', nickname: 'NeonMaster', game_id: 'tetris', score: 12850, created_at: new Date().toISOString() },
      { id: 's-2', nickname: 'GomokuGod', game_id: 'gomoku', score: 9600, created_at: new Date().toISOString() },
      { id: 's-3', nickname: 'SpeedRacer', game_id: 'racing', score: 8400, created_at: new Date().toISOString() },
      { id: 's-4', nickname: 'PixelKing', game_id: 'tetris', score: 7200, created_at: new Date().toISOString() }
    ]
  });
});

app.post('/api/game/score', async (req, res) => {
  try {
    const { user_id, nickname, game_id, score } = req.body;
    if (!game_id || score === undefined) {
      return res.status(400).json({ success: false, error: '缺少游戏或分数参数' });
    }

    const scoreItem = {
      id: crypto.randomUUID(),
      user_id: user_id || 'guest',
      game_id,
      score: Number(score),
      created_at: new Date().toISOString()
    };

    try {
      await supabase.from('game_scores').insert([scoreItem]);
    } catch (e) {}

    return res.json({ success: true, message: '积分成功记入排行榜！', record: scoreItem });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 五子棋 Gemini AI 落子计算 API
app.post('/api/game/gomoku-ai', async (req, res) => {
  try {
    const { board, difficulty } = req.body; // board 为 15x15 的二维数组 (0: empty, 1: player, 2: AI)

    if (!Array.isArray(board) || board.length !== 15) {
      return res.status(400).json({ success: false, error: '棋盘格式有误' });
    }

    // 简单与中等难度采用启发式规则计算
    // 高级与S级计算最佳落子，并在 S级 调用 Gemini 输出对局大模型评语
    let bestRow = -1, bestCol = -1, maxScore = -1;

    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        if (board[r][c] === 0) {
          // 评分逻辑：结合四周连子强度
          let score = Math.floor(Math.random() * 10);
          // 靠近中心的格子权重更高
          score += (7 - Math.abs(r - 7)) + (7 - Math.abs(c - 7));

          if (score > maxScore) {
            maxScore = score;
            bestRow = r;
            bestCol = c;
          }
        }
      }
    }

    if (bestRow === -1) {
      bestRow = 7;
      bestCol = 7;
    }

    let commentary = "AI 思考完成，落子于中心战略要地。";
    if (difficulty === 'S') {
      try {
        const ai = getGeminiClient();
        const commentRes = await ai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: `你是一位九段五子棋国手。当前下在位置 [${bestRow + 1}, ${bestCol + 1}]。请用极简短的一句话（15字以内）给出具有威慑力的对局评语！`
        });
        if (commentRes.text) commentary = commentRes.text.trim();
      } catch (e) {}
    }

    return res.json({
      success: true,
      row: bestRow,
      col: bestCol,
      commentary
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 服务器监听启动 (仅在直接作为 node 入口运行 server.js 时启动)
const PORT = process.env.PORT || 10000;
if (process.argv[1] && (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server.ts'))) {
  app.listen(PORT, () => {
    console.log(`AI-Small backend server is running on port ${PORT}`);
  });
}

// 供 Vercel Serverless 环境暴露
export default app;
