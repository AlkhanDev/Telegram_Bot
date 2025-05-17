require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const axios = require('axios');
const Parser = require('rss-parser');

const parser = new Parser({
  requestOptions: {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Feedly/1.0; +http://www.feedly.com/fetcher.html)'
    }
  }
});

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID; // e.g. @yourchannel or channel ID
const RSS_FEEDS = process.env.RSS_FEEDS ? process.env.RSS_FEEDS.split(',') : []; // Regular RSS feeds

// X/Twitter RSS feeds (direct URLs)
const X_RSS_FEEDS = process.env.X_RSS_FEEDS ? process.env.X_RSS_FEEDS.split(',') : [
  'https://rss.app/feeds/a56VIN1jgXksykeU.xml',  // AnfieldEdition feed
  'https://rss.app/feeds/Cbr3s4Zpw573QLAz.xml'   // İkinci feed
];

console.log('Bot configuration:', { 
  CHANNEL_ID, 
  X_RSS_FEEDS: X_RSS_FEEDS.length + ' X feeds configured',
  RSS_FEEDS: RSS_FEEDS.length + ' standard feeds configured'
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

  // Then check regular RSS feeds
  for (const feedUrl of RSS_FEEDS) {
    const cleanFeedUrl = feedUrl.trim();
    console.log(`Checking RSS feed: ${cleanFeedUrl}`);
    
    const { items, title } = await fetchRssPosts(cleanFeedUrl);
    
    if (items.length > 0) {
      // Process the latest 5 posts
      for (const item of items) {
        if (!postedLinks.has(item.link)) {
          const message = formatPost(item, title);
          try {
            await bot.sendMessage(CHANNEL_ID, message, { disable_web_page_preview: false });
            postedLinks.add(item.link);
            console.log(`Posted new RSS item from ${title}: ${item.link}`);
            
            // Add a small delay between messages to avoid hitting rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (err) {
            console.error('Error posting to Telegram:', err.message);
          }
        } else {
          console.log(`Already posted this RSS link from ${title}: ${item.link}`);
        }
      }
    } else {
      console.log(`No new RSS posts found for ${cleanFeedUrl}`);
    }
  }
}

// Main scheduled job: every 10 minutes instead of every hour
cron.schedule('*/5 * * * *', checkNewPosts);

// Add command handlers
bot.onText(/\/check/, checkNewPosts);

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const statusMessage = `Bot is active and monitoring:\n- ${X_RSS_FEEDS.length} X feeds\n- ${RSS_FEEDS.length} RSS feeds\n\nChecking for new posts every 10 minutes. Use /check to manually check now.`;
  await bot.sendMessage(chatId, statusMessage);
});

// Initial run on startup
checkNewPosts();

// Placeholder for main logic
console.log('Bot started. Use /check to manually check for new posts.');