# Telegram MiniApp Pro (deploy-ready)

## What's included
- Express server (server.js)
- Telegram bot handlers (node-telegram-bot-api)
- MongoDB integration (mongoose)
- Admin web dashboard with Chart.js
- Admin password protection
- CSV export (json2csv)
- Monetag placeholder integration (public/index.html)

## Quick start (local)
1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start server:
   ```bash
   npm start
   ```
4. Open:
   - Main miniapp: http://localhost:3000/
   - Admin (login): http://localhost:3000/admin
   Use `?key=YOUR_ADMIN_PASS` to access the dashboard.

## Deploy
- Push this repo to GitHub and deploy to Railway/Heroku.
- Add environment variables on the hosting platform.

## Notes
- This project uses placeholder Monetag script. Replace with your Monetag snippet.
- For production, secure your admin path (TLS, IP allowlist, etc.)
