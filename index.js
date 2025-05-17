require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const Parser = require('rss-parser');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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

const X_RSS_FEEDS =  [
  'https://rss.app/feeds/a56VIN1jgXksykeU.xml',
  'https://rss.app/feeds/Cbr3s4Zpw573QLAz.xml',
  'https://rss.app/feeds/RKijWOOGlKwuUddl.xml' 
];

if (!BOT_TOKEN || !CHANNEL_ID || (X_RSS_FEEDS.length === 0)) {
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Dosya sistemi tabanlı kalıcı depolama için yapılandırma
const DATA_DIR = process.env.DATA_DIR || './data';
const POSTED_LINKS_FILE = path.join(DATA_DIR, 'postedLinks.json');

// Veri klasörünü oluştur (eğer yoksa)
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Gönderilen linkleri yükle
let postedLinks = new Set();

function loadPostedLinks() {
  try {
    if (fs.existsSync(POSTED_LINKS_FILE)) {
      const data = fs.readFileSync(POSTED_LINKS_FILE, 'utf8');
      const links = JSON.parse(data);
      postedLinks = new Set(links);
      console.log(`Loaded ${postedLinks.size} posted links from storage`);
    } else {
      console.log('No saved posted links found, starting with empty set');
      postedLinks = new Set();
    }
  } catch (err) {
    console.error('Error loading posted links:', err.message);
    postedLinks = new Set();
  }
}

// Gönderilen linkleri kaydet
function savePostedLinks() {
  try {
    const links = Array.from(postedLinks);
    
    // Maksimum 500 link sakla (limiti değiştirebilirsiniz)
    const limitedLinks = links.slice(Math.max(0, links.length - 500));
    
    fs.writeFileSync(POSTED_LINKS_FILE, JSON.stringify(limitedLinks), 'utf8');
    console.log(`Saved ${limitedLinks.length} posted links to storage`);
  } catch (err) {
    console.error('Error saving posted links:', err.message);
  }
}

// İlk başlangıçta kayıtlı linkleri yükle
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
        items: feed.items.slice(0, 5),
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
    return `📝 Post from @${source} on X:\n\n${content}\n\n${item.link}`;
  } else {
    return `📰 New article from ${source}:\n\n**${item.title || ''}**\n\n${content.substring(0, 200)}${content.length > 200 ? '...' : ''}\n\n${item.link}`;
  }
}

async function checkNewPosts() {
  console.log('Checking for new posts...');
  let newPostsFound = false;
  
  for (const feedUrl of X_RSS_FEEDS) {
    const cleanFeedUrl = feedUrl.trim();
    console.log(`Checking X feed: ${cleanFeedUrl}`);
    
    const { items, title } = await fetchRssPosts(cleanFeedUrl, true)
    let reversedItems = items.reverse()
    if (items.length > 0) {
      
      for (const item of reversedItems) {
        if (!postedLinks.has(item.link)) {
          const message = formatPost(item, title, true);
          try {
            await bot.sendMessage(CHANNEL_ID, message, { disable_web_page_preview: false });
            postedLinks.add(item.link);
            newPostsFound = true;
            console.log(`Posted new X item from ${title}: ${item.link}`);
            
            // Her gönderi sonrası linkleri kaydet
            savePostedLinks();
            
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

  // Yeni post yoksa da periyodik olarak kaydet
  if (!newPostsFound) {
    savePostedLinks();
  }
}

// 30 dakikada bir kontrol et
cron.schedule('*/30 * * * *', checkNewPosts);

bot.onText(/\/check/, checkNewPosts);

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const statusMessage = `Bot is active and monitoring:\n- ${X_RSS_FEEDS.length} RSS feeds\n\nChecking for new posts every 30 minutes. Posted links in memory: ${postedLinks.size}. Use /check to manually check now.`;
  await bot.sendMessage(chatId, statusMessage);
});

app.get('/status', (req, res) => {
  res.json({
    status: 'active',
    monitoring: {
      xFeeds: X_RSS_FEEDS.length,
      postedLinksCount: postedLinks.size
    },
    checkInterval: '30 minutes'
  });
});

// Bot başladığında hemen kontrol et
checkNewPosts();