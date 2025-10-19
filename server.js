import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import 'dotenv/config';
import mongoose from 'mongoose';
import TelegramBot from 'node-telegram-bot-api';
import { Parser } from 'json2csv';

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const ADMIN_ID = process.env.ADMIN_ID || '';
const ADMIN_PASS = process.env.ADMIN_PASS || 'adminpass';

// ---- Telegram bot (polling) ----
const bot = TELEGRAM_TOKEN ? new TelegramBot(TELEGRAM_TOKEN, { polling: true }) : null;
if (!bot) {
  console.warn('Telegram token not provided. Bot disabled.');
}

// ---- MongoDB ----
const MONGO_URI = process.env.MONGO_URI || '';
if (MONGO_URI) {
  mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => console.error('❌ MongoDB error', err));
} else {
  console.warn('MONGO_URI not provided - using in-memory fallback (not persistent).');
}

// ---- Schemas/Models ----
const userSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  user: String,
  balance: { type: Number, default: 0 },
  referredBy: String,
  createdAt: { type: Date, default: Date.now }
});
const taskSchema = new mongoose.Schema({
  id: Number,
  title: String,
  reward: Number,
  link: String
});
const withdrawSchema = new mongoose.Schema({
  id: Number,
  userId: Number,
  user: String,
  amount: Number,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);
const Withdraw = mongoose.models.Withdraw || mongoose.model('Withdraw', withdrawSchema);

// ---- Initialize demo tasks if empty ----
async function ensureTasks() {
  try {
    const count = await Task.countDocuments();
    if (count === 0) {
      await Task.create([
        { id: 1, title: 'Visit our Blogger site', reward: 10, link: 'https://yourblog.blogspot.com' },
        { id: 2, title: 'Join Telegram Channel', reward: 15, link: 'https://t.me/yourchannel' },
        { id: 3, title: 'Watch Ad', reward: 5, link: '#' }
      ]);
      console.log('✅ Demo tasks created');
    }
  } catch (err) {
    console.warn('Task init skipped (DB not available yet).');
  }
}
ensureTasks();

// ---- Helper: send admin alert ----
async function sendAdminAlert(text) {
  try {
    if (bot && ADMIN_ID) {
      await bot.sendMessage(ADMIN_ID, text);
    }
  } catch (err) {
    console.error('Failed to send admin alert:', err);
  }
}

// ---- Telegram commands ----
if (bot) {
  bot.onText(/\/start(?:\s(.*))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name || String(chatId);
    const refId = match && match[1] ? match[1] : null;

    let user = await User.findOne({ id: chatId });
    if (!user) {
      user = await User.create({ id: chatId, user: username, balance: 0, referredBy: refId || null });
      await sendAdminAlert(`নতুন ইউজার যোগ হয়েছে: @${username} (${chatId})`);
      // give referral bonus
      if (refId) {
        const refUser = await User.findOne({ id: Number(refId) });
        if (refUser) {
          refUser.balance += 5;
          await refUser.save();
          if (bot) await bot.sendMessage(refUser.id, `🎁 You got 5 coins from @${username}'s referral!`);
        }
      }
    }
    bot.sendMessage(chatId, `👋 Hi ${username}! Use /menu to see options.`);
  });

  bot.onText(/\/menu/, async (msg) => {
    const chatId = msg.chat.id;
    const text = `🏠 Main Menu:\n/tasks - Available tasks\n/wallet - Check wallet\n/refer - Invite & earn\n/withdraw <amount> - Request withdraw`;
    bot.sendMessage(chatId, text);
  });

  bot.onText(/\/tasks/, async (msg) => {
    const tasks = await Task.find();
    let message = '🎯 Available Tasks:\n\n';
    tasks.forEach(t => {
      message += `🧩 ${t.id}. ${t.title} — Reward: ${t.reward} coins\n`;
    });
    message += '\nAfter completing, send /done <task_id>';
    bot.sendMessage(msg.chat.id, message);
  });

  bot.onText(/\/done (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const taskId = Number(match[1]);
    const task = await Task.findOne({ id: taskId });
    const user = await User.findOne({ id: chatId });
    if (!task) return bot.sendMessage(chatId, '❌ Invalid task ID');
    if (!user) return bot.sendMessage(chatId, '❌ User not found');
    user.balance = (user.balance || 0) + (task.reward || 0);
    await user.save();
    bot.sendMessage(chatId, `✅ You earned ${task.reward} coins!`);
  });

  bot.onText(/\/wallet/, async (msg) => {
    const user = await User.findOne({ id: msg.chat.id });
    if (!user) return bot.sendMessage(msg.chat.id, '❌ User not found');
    bot.sendMessage(msg.chat.id, `💼 Your Balance: ${user.balance} coins`);
  });

  bot.onText(/\/withdraw (\d+(?:\.\d+)?)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const amount = Number(match[1]);
    const user = await User.findOne({ id: chatId });
    if (!user) return bot.sendMessage(chatId, '❌ User not found');
    if ((user.balance || 0) < amount) return bot.sendMessage(chatId, '⚠️ Not enough balance!');
    // create withdraw request
    const w = await Withdraw.create({ id: Date.now(), userId: chatId, user: user.user, amount, status: 'pending' });
    await sendAdminAlert(`💸 Withdraw request: @${user.user} → ${amount} coins (id: ${w.id})`);
    bot.sendMessage(chatId, '✅ Withdraw request sent!');
  });

  bot.onText(/\/refer/, async (msg) => {
    const chatId = msg.chat.id;
    const referLink = `https://t.me/${bot.options.username || 'YOUR_BOT_USERNAME'}?start=${chatId}`;
    bot.sendMessage(chatId, `👥 Invite & Earn! Share this link:\n${referLink}`);
  });

  // basic admin command
  bot.onText(/\/stats/, async (msg) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const userCount = await User.countDocuments();
    const withdrawCount = await Withdraw.countDocuments();
    bot.sendMessage(msg.chat.id, `📊 Users: ${userCount}\nWithdraws: ${withdrawCount}`);
  });
}

// ---- Web Routes ----
app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/public/index.html');
});

app.get('/admin', async (req, res) => {
  if (req.query.key === ADMIN_PASS) {
    res.sendFile(process.cwd() + '/public/admin.html');
  } else {
    res.send(`
      <form method="GET" action="/admin" style="font-family:Arial;padding:30px;">
        <h2>🔐 Admin Login</h2>
        <input name="key" placeholder="Enter password" />
        <button type="submit">Login</button>
      </form>
    `);
  }
});

// API: get data (protected by admin key)
app.get('/api/data', async (req, res) => {
  if (req.query.key !== ADMIN_PASS) return res.status(403).json({ error: 'forbidden' });
  const users = await User.find().lean();
  const tasks = await Task.find().lean();
  const withdraws = await Withdraw.find().lean();
  res.json({ users, tasks, withdraws });
});

// API: approve withdraw
app.post('/api/approve', async (req, res) => {
  const { id, key } = req.body;
  if (key !== ADMIN_PASS) return res.status(403).json({ error: 'forbidden' });
  const w = await Withdraw.findOne({ id });
  if (!w) return res.status(404).json({ error: 'not found' });
  if (w.status === 'approved') return res.json({ success: true, message: 'already approved' });
  w.status = 'approved';
  await w.save();
  // deduct user's balance
  const u = await User.findOne({ id: w.userId });
  if (u) {
    u.balance = (u.balance || 0) - (w.amount || 0);
    if (u.balance < 0) u.balance = 0;
    await u.save();
    if (bot) await bot.sendMessage(u.id, `✅ Your withdraw of ${w.amount} coins has been approved!`);
  }
  res.json({ success: true });
});

// API: add task
app.post('/api/add-task', async (req, res) => {
  const { title, reward, link, key } = req.body;
  if (key !== ADMIN_PASS) return res.status(403).json({ error: 'forbidden' });
  const last = await Task.findOne().sort({ id: -1 }).lean();
  const nid = last ? (last.id + 1) : 1;
  const task = await Task.create({ id: nid, title, reward: Number(reward), link });
  res.json({ success: true, task });
});

// Stats API for chart
app.get('/api/stats', async (req, res) => {
  if (req.query.key !== ADMIN_PASS) return res.status(403).json({ error: 'forbidden' });
  const users = await User.find().lean();
  const withdraws = await Withdraw.find().lean();
  const totalBalance = users.reduce((acc, u) => acc + (u.balance || 0), 0);
  const labels = ['Jan','Feb','Mar','Apr','May','Jun'];
  const userGrowth = [5,12,25,40,62, users.length];
  res.json({
    userCount: users.length,
    withdrawCount: withdraws.length,
    balanceTotal: totalBalance.toFixed(2),
    labels, userGrowth
  });
});

// CSV export
app.get('/api/export/:type', async (req, res) => {
  if (req.query.key !== ADMIN_PASS) return res.status(403).json({ error: 'forbidden' });
  const type = req.params.type;
  let data = [];
  if (type === 'users') data = await User.find().lean();
  else if (type === 'withdraws') data = await Withdraw.find().lean();
  else return res.status(400).json({ error: 'invalid type' });
  const parser = new Parser();
  const csv = parser.parse(data);
  res.header('Content-Type', 'text/csv');
  res.attachment(`${type}.csv`);
  res.send(csv);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
