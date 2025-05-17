# Telegram X (Twitter) Repost Bot

This bot fetches posts from specified X (formerly Twitter) profiles via Nitter RSS and posts them to your Telegram channel at 1-hour intervals.

## Features
- Fetches latest posts from X profiles using Nitter RSS
- Posts new content to a Telegram channel
- Runs on a schedule (every hour)

## Setup

1. **Clone the repository**
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Create a `.env` file:**
   Copy `.env.example` to `.env` and fill in your values.
4. **Run the bot:**
   ```bash
   node index.js
   ```

## Environment Variables
- `BOT_TOKEN`: Your Telegram bot token from BotFather
- `CHANNEL_ID`: Your channel username (e.g. `@yourchannel`) or channel ID
- `X_PROFILES`: Comma-separated X usernames (no @, e.g. `jack,elonmusk`)
- `NITTER_INSTANCE`: (Optional) Nitter instance URL (default: https://nitter.net)

## Deploying for Free
You can deploy this bot for free on platforms like Railway, Render, or Replit. See their docs for details.

## Notes
- Your bot must be an admin in the channel to post.
- Free hosting may sleep after inactivity.
- Nitter is a third-party service and may be rate-limited or unavailable at times. 