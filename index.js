require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios');
const Parser = require('rss-parser');
const express = require('express');

// Create Express app and listen on port
const app = express();
const PORT = process.env.PORT || 3000;

// Add a health check endpoint
app.get('/', (req, res) => {
  res.send('Telegram Bot is running!');
});

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

const parser = new Parser({
  requestOptions: {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Feedly/1.0; +http://www.feedly.com/fetcher.html)'
    }
  }
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID; 

// X/Twitter RSS feeds (direct URLs)
const X_RSS_FEEDS =  [
  'https://rss.app/feeds/a56VIN1jgXksykeU.xml',  // AnfieldEdition feed
  'https://rss.app/feeds/Cbr3s4Zpw573QLAz.xml',
  'https://rss.app/feeds/RKijWOOGlKwuUddl.xml' 
];

console.log('Bot configuration:', { 
  CHANNEL_ID, 
  X_RSS_FEEDS: X_RSS_FEEDS.length + ' X feeds configured',
 
});

if (!BOT_TOKEN || !CHANNEL_ID || (X_RSS_FEEDS.length === 0 && RSS_FEEDS.length === 0)) {
  console.error('Please set BOT_TOKEN, CHANNEL_ID, and either X_RSS_FEEDS or RSS_FEEDS in your .env file.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Store posted links to avoid duplicates (in-memory)
const postedLinks = new Set();

// Helper: Fetch posts from any RSS feed URL
async function fetchRssPosts(feedUrl, isXFeed = false) {
  try {
    console.log(`Trying to fetch RSS from: ${feedUrl}`);
    
    const feed = await parser.parseURL(feedUrl);
    if (feed.items && feed.items.length > 0) {
      console.log(`Successfully fetched posts from ${feedUrl}`);
      
      // Determine source name - try to extract from feed title or URL
      let sourceName = feed.title || 'RSS Feed';
      
      // For X feeds, try to extract username from content if possible
      if (isXFeed && feed.items[0] && feed.items[0].creator) {
        sourceName = feed.items[0].creator.replace('@', '');
      }
      
      // Return the last 5 posts
      return { 
        items: feed.items.slice(0, 5),
        title: sourceName
      };
    }
  } catch (err) {
    console.error(`Error fetching RSS from ${feedUrl}:`, err.message);
  }
  return { items: [], title: 'Unknown Feed' };
}

// Helper: Format post for Telegram
function formatPost(item, source, isXProfile = false) {
  // Extract text content and clean it up
  let content = item.content ? item.content : item.contentSnippet || '';
  
  // Remove HTML tags if present
  content = content.replace(/<[^>]*>/g, '');
  
  // Create message with different format based on source type
  if (isXProfile) {
    return `📝 Post from @${source} on X:\n\n${content}\n\n${item.link}`;
  } else {
    return `📰 New article from ${source}:\n\n**${item.title || ''}**\n\n${content.substring(0, 200)}${content.length > 200 ? '...' : ''}\n\n${item.link}`;
  }
}

// Check for new posts function (reused by scheduled job and initial run)
async function checkNewPosts() {
  console.log('Checking for new posts...');
  
  // First check X feeds directly using their URLs
  for (const feedUrl of X_RSS_FEEDS) {
    const cleanFeedUrl = feedUrl.trim();
    console.log(`Checking X feed: ${cleanFeedUrl}`);
    
    const { items, title } = await fetchRssPosts(cleanFeedUrl, true)
    let reversedItems = items.reverse()
    if (items.length > 0) {
      // Process the latest 5 posts
      for (const item of reversedItems) {
        if (!postedLinks.has(item.link)) {
          const message = formatPost(item, title, true);
          try {
          
            await bot.sendMessage(CHANNEL_ID, message, { disable_web_page_preview: false });
            postedLinks.add(item.link);
            console.log(`Posted new X item from ${title}: ${item.link}`);
            
            // Add a small delay between messages to avoid hitting rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (err) {
            console.error('Error posting to Telegram:', err.message);
          }
        } else {
          console.log(`Already posted this X link from ${title}: ${item.link}`);
        }
      }
    } else {
      console.log(`No new X posts found for ${cleanFeedUrl}`);
    }
  }

  
}

// Main scheduled job: check every 5 minutes
cron.schedule('*/30 * * * *', checkNewPosts);

// Add command handlers
bot.onText(/\/check/, checkNewPosts);

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const statusMessage = `Bot is active and monitoring:\n- ${X_RSS_FEEDS.length} X feeds\n- ${RSS_FEEDS.length} RSS feeds\n\nChecking for new posts every 5 minutes. Use /check to manually check now.`;
  await bot.sendMessage(chatId, statusMessage);
});

// Add status endpoint to check bot status via web
app.get('/status', (req, res) => {
  res.json({
    status: 'active',
    monitoring: {
      xFeeds: X_RSS_FEEDS.length,
    },
    checkInterval: '30 minutes'
  });
});

// Initial run on startup
checkNewPosts();