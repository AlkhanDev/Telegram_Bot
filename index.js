require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const Parser = require('rss-parser');
const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || 'https://telegram-bot-bsct.onrender.com';

// Initialize Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');

// Initialize Firebase with service account or credentials from environment variable
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

// Get a reference to the database service
const database = admin.database();
const linksRef = database.ref('links');

app.get('/', (req, res) => {
  res.send('Telegram Bot is running!');
});

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

const X_RSS_FEEDS = [
'https://rss.app/feeds/543apjQcHQ9UDRE0.xml',
'https://rss.app/feeds/n5fD8AZUsJLEHvK9.xml',
'https://rss.app/feeds/Pgxmwxt9glwCy1e4.xml',
'https://rss.app/feeds/gPNv3lqwT9l6s3w4.xml',
'https://rss.app/feeds/LZTMEI96puQSQAqr.xml',
'https://rss.app/feeds/NIhOtdtYXHFzxYsA.xml',


];

if (!BOT_TOKEN || !CHANNEL_ID || (X_RSS_FEEDS.length === 0)) {
  console.error('Required environment variables are missing');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// In-memory map to store posted links and their Firebase keys
let postedLinksMap = new Map();

// Helper function to convert URL to a valid Firebase key
function urlToFirebaseKey(url) {
  // Replace invalid characters with underscores
  return url.replace(/[.#$\/\[\]]/g, '_');
}

// Load posted links from Firebase
async function loadPostedLinks() {
  try {
    console.log('Loading posted links from Firebase...');
    const snapshot = await linksRef.once('value');
    const data = snapshot.val() || {};
    
    // Clear existing map
    postedLinksMap.clear();
    
    // Load data into map
    for (const [key, value] of Object.entries(data)) {
      if (value && value.url) {
        postedLinksMap.set(value.url, key);
      }
    }
    
    console.log(`Loaded ${postedLinksMap.size} posted links from Firebase`);
  } catch (err) {
    console.error('Error loading posted links from Firebase:', err.message);
    postedLinksMap.clear();
  }
}

// Add a single link to Firebase
async function addLinkToFirebase(url) {
  try {
    if (!postedLinksMap.has(url)) {
      // Create a Firebase-safe key from the URL
      const key = urlToFirebaseKey(url);
      
      // Save the link to Firebase with a timestamp
      await linksRef.child(key).set({
        url: url,
        timestamp: Date.now()
      });
      
      // Add to local map
      postedLinksMap.set(url, key);
      console.log(`Added link to Firebase: ${url}`);
    }
  } catch (err) {
    console.error(`Error adding link to Firebase: ${err.message}`);
  }
}

// Check if a link exists in our records
function linkExists(url) {
  return postedLinksMap.has(url);
}

// Keep-alive function
function setupKeepAlive() {
  setInterval(async () => {
    try {
      console.log('Sending keep-alive request...');
      const response = await axios.get(APP_URL);
      console.log(`Keep-alive request sent. Status: ${response.status}`);
    } catch (error) {
      console.error('Error sending keep-alive request:', error.message);
    }
  }, 12 * 60 * 1000); 
}

// Start the keep-alive mechanism
setupKeepAlive();

// Load posted links at startup
loadPostedLinks();

async function fetchRssPosts(feedUrl, isXFeed = false) {
  try {
    const feed = await parser.parseURL(feedUrl);
    if (feed.items && feed.items.length > 0) {
      let sourceName = feed.title || 'RSS Feed';
      
      if (isXFeed && feed.items[0] && feed.items[0].creator) {
        sourceName = feed.items[0].creator.replace('@', '');
      }
      
      return { 
        items: feed.items.slice(0, 4),
        title: sourceName
      };
    }
  } catch (err) {
    console.error(`Error fetching RSS from ${feedUrl}:`, err.message);
  }
  return { items: [], title: 'Unknown Feed' };
}

function formatPost(item, source, isXProfile = false) {
  let content = item.content ? item.content : item.contentSnippet || '';
  content = content.replace(/<[^>]*>/g, '');
  
  if (isXProfile) {
    return `📝 Müəllif @${source} X üzərindən:\n\n${content}\n\n${item.link}`;
  } else {
    return `📰 ${source}-dən yeni məqalə:\n\n**${item.title || ''}**\n\n${content.substring(0, 200)}${content.length > 200 ? '...' : ''}\n\n${item.link}`;
  }
}

async function checkNewPosts() {
  console.log('Checking for new posts...');
  
  // Ensure we have the latest data from Firebase
  await loadPostedLinks();
  
  for (const feedUrl of X_RSS_FEEDS) {
    const cleanFeedUrl = feedUrl.trim();
    console.log(`Checking X feed: ${cleanFeedUrl}`);
    
    const { items, title } = await fetchRssPosts(cleanFeedUrl, true);
    let reversedItems = items.reverse();
    
    if (items.length > 0) {
      for (const item of reversedItems) {
        // Check if we've already posted this link
        if (!linkExists(item.link)) {
          const message = formatPost(item, title, true);
          try {
            await bot.sendMessage(CHANNEL_ID, message, { disable_web_page_preview: false });
            
            // Add the link to Firebase
            await addLinkToFirebase(item.link);
            
            console.log(`Posted new X item from ${title}: ${item.link}`);
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

// Debug command to see current links in memory
bot.onText(/\/debug/, async (msg) => {
  const chatId = msg.chat.id;
  const links = Array.from(postedLinksMap.keys()).slice(0, 10); // Show only first 10 links
  
  let debugMessage = `Current links in memory (${postedLinksMap.size} total):\n\n`;
  links.forEach((link, index) => {
    debugMessage += `${index + 1}. ${link}\n`;
  });
  
  if (links.length < postedLinksMap.size) {
    debugMessage += `\n... and ${postedLinksMap.size - links.length} more`;
  }
  
  await bot.sendMessage(chatId, debugMessage);
});

// Check every 30 minutes
cron.schedule('*/30 * * * *', checkNewPosts);

bot.onText(/\/check/, checkNewPosts);

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const statusMessage = `Bot is active and monitoring:
- ${X_RSS_FEEDS.length} RSS feeds

Checking for new posts every 30 minutes.
Posted links in memory: ${postedLinksMap.size}.
Storage: Firebase Realtime Database
Use /check to manually check now.
Use /debug to see current links in memory.`;
  await bot.sendMessage(chatId, statusMessage);
});

// Reset command for administrators - use with caution
bot.onText(/\/cleardb/, async (msg) => {
  const chatId = msg.chat.id;
  if (msg.from.id.toString() === process.env.ADMIN_ID) {
    await linksRef.remove();
    postedLinksMap.clear();
    await bot.sendMessage(chatId, "Database has been cleared.");
  } else {
    await bot.sendMessage(chatId, "You are not authorized to use this command.");
  }
});

app.get('/status', (req, res) => {
  res.json({
    status: 'active',
    monitoring: {
      xFeeds: X_RSS_FEEDS.length,
      postedLinksCount: postedLinksMap.size
    },
    storage: 'Firebase Realtime Database',
    checkInterval: '30 minutes',
    keepAlive: 'Active (12-minute intervals)'
  });
});

// Check for new posts when the bot starts
checkNewPosts();