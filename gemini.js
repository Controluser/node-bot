import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import axios from "axios";
import puppeteer from "puppeteer";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

const execPromise = promisify(exec);
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const userStates = {};

// Create main output directory
const mainOutputDir = "output";
if (!fs.existsSync(mainOutputDir)) fs.mkdirSync(mainOutputDir);

// Logging utility
const getLogFile = (postDir) => path.join(postDir, "activity.log");

const log = {
  writeLog: (logFile, level, msg) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${level}] ${timestamp} - ${msg}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(logFile, logMessage);
  },
  info: (logFile, msg) => log.writeLog(logFile, "INFO", msg),
  error: (logFile, msg) => log.writeLog(logFile, "ERROR", msg),
  warn: (logFile, msg) => log.writeLog(logFile, "WARN", msg),
  success: (logFile, msg) => log.writeLog(logFile, "✅ SUCCESS", msg),
};

// Create log file for startup
const mainLog = path.join(mainOutputDir, "bot_startup.log");
log.success(mainLog, "Bot started");

function getFormattedTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}${minutes}`;
}

function createPostDirectory(index) {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const dateFolder = `${year}-${month}-${day}`;
  const datePath = path.join(mainOutputDir, dateFolder);

  if (!fs.existsSync(datePath)) fs.mkdirSync(datePath, { recursive: true });

  const time = getFormattedTime();
  const postFolderName = `post${String(index).padStart(2, "0")}_${time}`;
  const postDir = path.join(datePath, postFolderName);

  if (!fs.existsSync(postDir)) fs.mkdirSync(postDir, { recursive: true });
  return postDir;
}

// Show start menu on any message if user hasn't started
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  if (!userStates[chatId]) {
    log.info(mainLog, `New user ${chatId} detected`);
    userStates[chatId] = { step: "menu_selection" };

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "➕ Create New Post", callback_data: "create_new" },
            { text: "📚 View History", callback_data: "view_history" },
          ],
          [
            { text: "❓ Help", callback_data: "help_menu" },
            { text: "⚙️ Settings", callback_data: "settings_menu" },
          ],
        ],
      },
    };

    await bot.sendMessage(chatId, "👋 Welcome to Video Maker Bot!\n\nWhat would you like to do?", opts);
    log.success(mainLog, `Start menu sent to user ${chatId}`);
  }
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  log.info(mainLog, `User ${chatId} selected: ${data}`);

  // Main menu options
  if (data === "create_new") {
    userStates[chatId] = { step: "audio_selection" };
    log.info(mainLog, `User ${chatId} starting new post creation`);
    await bot.answerCallbackQuery(query.id, "📸 Creating new post");

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🎵 Audio I", callback_data: "audio_I" },
            { text: "🎶 Audio II", callback_data: "audio_II" },
          ],
          [{ text: "⬅️ Back", callback_data: "back_to_menu" }],
        ],
      },
    };
    await bot.editMessageText(
      "🎵 Select an audio track for your video:\n\n🎵 Audio I - Original\n🎶 Audio II - Alternative",
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: opts.reply_markup,
      }
    );
    return;
  }

  if (data === "view_history") {
    log.info(mainLog, `User ${chatId} viewing history`);
    await bot.answerCallbackQuery(query.id, "📚 Loading history");

    try {
      const dateFolders = fs
        .readdirSync(mainOutputDir)
        .filter((f) => fs.statSync(path.join(mainOutputDir, f)).isDirectory())
        .sort()
        .reverse();

      if (dateFolders.length === 0) {
        await bot.editMessageText("📚 No history found. Create a new post to get started!", {
          chat_id: chatId,
          message_id: query.message.message_id,
          reply_markup: {
            inline_keyboard: [[{ text: "⬅️ Back", callback_data: "back_to_menu" }]],
          },
        });
        return;
      }

      let historyText = "📚 **Your Recent Posts:**\n\n";
      let postCount = 0;

      for (const dateFolder of dateFolders) {
        const datePath = path.join(mainOutputDir, dateFolder);
        const postFolders = fs
          .readdirSync(datePath)
          .filter((f) => fs.statSync(path.join(datePath, f)).isDirectory())
          .sort()
          .reverse();

        if (postFolders.length > 0) {
          historyText += `📅 **${dateFolder}**\n`;
          for (const postFolder of postFolders.slice(0, 5)) {
            historyText += `  • ${postFolder}\n`;
            postCount++;
            if (postCount >= 10) break;
          }
        }
        if (postCount >= 10) break;
      }

      await bot.editMessageText(historyText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "⬅️ Back", callback_data: "back_to_menu" }]],
        },
      });
    } catch (error) {
      log.error(mainLog, `Error loading history for user ${chatId}: ${error.message}`);
      await bot.editMessageText("❌ Error loading history", {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "⬅️ Back", callback_data: "back_to_menu" }]],
        },
      });
    }
    return;
  }

  if (data === "help_menu") {
    log.info(mainLog, `User ${chatId} viewing help`);
    await bot.answerCallbackQuery(query.id, "❓ Help");
    const helpText = `📖 **How to use this bot:**

1️⃣ **Create New Post**
   • Select audio track
   • Send photo with caption

2️⃣ **Caption Format**
   Title : Your title
   Content : Your content
   Hashtags : #tag1 #tag2
   (Optional) Date : DD MMM YYYY

3️⃣ **Review & Generate**
   • Preview your post
   • Approve to generate video
   • Cancel to start over

Features:
✨ High-quality rendering
🎬 8-second videos
📚 View history`;

    await bot.editMessageText(helpText, {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: "back_to_menu" }]],
      },
    });
    return;
  }

  if (data === "settings_menu") {
    log.info(mainLog, `User ${chatId} viewing settings`);
    await bot.answerCallbackQuery(query.id, "⚙️ Settings");

    const settingsText = `⚙️ **Bot Settings**

🎬 Video Duration: 8 seconds
🎵 Audio Tracks: 2 available
📸 Image Quality: High (2560x2560)
🎥 Video Quality: 5000kbps

Coming Soon:
• Custom duration
• More audio tracks
• Quality presets`;

    await bot.editMessageText(settingsText, {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: {
        inline_keyboard: [[{ text: "⬅️ Back", callback_data: "back_to_menu" }]],
      },
    });
    return;
  }

  if (data === "back_to_menu") {
    log.info(mainLog, `User ${chatId} going back to main menu`);
    await bot.answerCallbackQuery(query.id, "📋 Back to menu");
    userStates[chatId] = { step: "menu_selection" };

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "➕ Create New Post", callback_data: "create_new" },
            { text: "📚 View History", callback_data: "view_history" },
          ],
          [
            { text: "❓ Help", callback_data: "help_menu" },
            { text: "⚙️ Settings", callback_data: "settings_menu" },
          ],
        ],
      },
    };
    await bot.editMessageText("👋 Welcome to Video Maker Bot!\n\nWhat would you like to do?", {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: opts.reply_markup,
    });
    return;
  }

  // Audio selection
  if (data === "audio_I" || data === "audio_II") {
    userStates[chatId] = { step: "waiting_photo", audio: data === "audio_I" ? "audioI.mp3" : "audioII.mp3" };
    log.success(mainLog, `Audio ${data} set for user ${chatId}`);
    await bot.answerCallbackQuery(query.id, `✅ Selected: ${data === "audio_I" ? "Audio I" : "Audio II"}`);

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🎵 Audio I", callback_data: "audio_I" },
            { text: "🎶 Audio II", callback_data: "audio_II" },
          ],
          [{ text: "⬅️ Back to Menu", callback_data: "back_to_menu" }],
        ],
      },
    };

    await bot.editMessageText(
      `✅ Audio selected: ${
        data === "audio_I" ? "🎵 Audio I" : "🎶 Audio II"
      }\n\n📝 Now send me a photo with a caption.\n\nCaption format:\nTitle : Your Title\nContent : Your Content\nHashtags : #hashtag1 #hashtag2\n(Optional) Date : DD MMM YYYY\n\n💡 Want to change audio? Select a different one above.`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: opts.reply_markup,
      }
    );
    return;
  }

  if (data === "confirm_generate") {
    if (!userStates[chatId] || !userStates[chatId].lastPost) {
      await bot.answerCallbackQuery(query.id, "❌ Error: Post data not found");
      return;
    }
    await bot.answerCallbackQuery(query.id, "🎬 Generating video...");
    await generateVideo(chatId, userStates[chatId].lastPost);
  }

  if (data === "cancel_post") {
    if (userStates[chatId] && userStates[chatId].lastPost) {
      const postDir = userStates[chatId].lastPost.postDir;
      const logFile = getLogFile(postDir);

      try {
        const previewPath = userStates[chatId].lastPost.previewPath;
        if (previewPath && fs.existsSync(previewPath)) {
          fs.unlinkSync(previewPath);
          log.success(logFile, `Preview image deleted: ${previewPath}`);
        }
      } catch (error) {
        log.error(logFile, `Error deleting preview: ${error.message}`);
      }
    }

    userStates[chatId] = { step: "menu_selection" };
    await bot.answerCallbackQuery(query.id, "❌ Post cancelled");
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "➕ Create New Post", callback_data: "create_new" },
            { text: "📚 View History", callback_data: "view_history" },
          ],
          [
            { text: "❓ Help", callback_data: "help_menu" },
            { text: "⚙️ Settings", callback_data: "settings_menu" },
          ],
        ],
      },
    };
    await bot.editMessageText("👋 Post cancelled. What would you like to do?", {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: opts.reply_markup,
    });
  }
});

async function launchBrowserWithRetry(logFile, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await puppeteer.launch({
        headless: "new",
        timeout: 60000,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
      });
    } catch (error) {
      log.warn(logFile, `Browser launch attempt ${i + 1} failed: ${error.message}`);
      if (i === maxRetries - 1) throw error;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function renderAndPreview(chatId, title, content, hashtags, date, imagePath, postDir) {
  const logFile = getLogFile(postDir);

  try {
    const statusMsg = await bot.sendMessage(chatId, "🎨 Rendering preview...");
    const statusMsgId = statusMsg.message_id;

    const updateStatus = async (text) => {
      log.info(logFile, `Updating status: ${text}`);
      await bot.editMessageText(text, { chat_id: chatId, message_id: statusMsgId });
    };

    const imgUrl = `http://localhost:8000/${path.relative(".", imagePath)}`;
    const htmlTemplate = fs.readFileSync("index.html", "utf8");

    const html = htmlTemplate
      .replace("{{image}}", imgUrl)
      .replace("{{title}}", title)
      .replace("{{content}}", content)
      .replace("{{hashtags}}", hashtags)
      .replace("{{date}}", date);

    fs.writeFileSync(path.join(postDir, "temp.html"), html);

    await updateStatus("🎨 Taking screenshot...");
    log.info(logFile, `Launching Puppeteer`);
    const browser = await launchBrowserWithRetry(logFile);
    const page = await browser.newPage();
    await page.setViewport({ width: 2560, height: 2560, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });
    await page.evaluateHandle("document.fonts.ready");
    const element = await page.$(".template");
    const previewPath = path.join(postDir, "preview.png");
    await element.screenshot({ path: previewPath, omitBackground: true });
    await browser.close();
    log.success(logFile, `Preview rendered: ${previewPath}`);

    await updateStatus("📸 Sending preview...");
    log.info(logFile, `Sending preview to user ${chatId}`);

    userStates[chatId].lastPost = {
      title,
      content,
      hashtags,
      date,
      audio: userStates[chatId].audio,
      imagePath,
      previewPath,
      postDir,
      htmlContent: html,
    };

    await bot.sendPhoto(chatId, previewPath, {
      caption: `✅ Preview of your post\n\n📌 Title: ${title}\n📝 Content: ${content.substring(
        0,
        50
      )}...\n🏷️ Hashtags: ${hashtags}`,
    });

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Generate Video", callback_data: "confirm_generate" },
            { text: "❌ Cancel & Restart", callback_data: "cancel_post" },
          ],
        ],
      },
    };

    await bot.sendMessage(chatId, "What would you like to do?", opts);
    log.success(logFile, `Preview sent to user ${chatId}`);
  } catch (error) {
    log.error(logFile, `Error rendering preview: ${error.message}`);
    await bot.sendMessage(chatId, "❌ Error rendering preview. Try again.");
  }
}

async function generateVideo(chatId, postData) {
  const { title, content, hashtags, date, audio, previewPath, postDir } = postData;
  const logFile = getLogFile(postDir);

  try {
    const statusMsg = await bot.sendMessage(chatId, "🎬 Creating video...");
    const statusMsgId = statusMsg.message_id;

    const updateStatus = async (text) => {
      log.info(logFile, `Updating status: ${text}`);
      await bot.editMessageText(text, { chat_id: chatId, message_id: statusMsgId });
    };

    const videoPath = path.join(postDir, "video.mp4");

    log.info(logFile, `Creating video with audio: ${audio}`);
    log.info(logFile, `Using rendered preview image: ${previewPath}`);

    if (!fs.existsSync(audio)) {
      throw new Error(`Audio file not found: ${audio}`);
    }

    if (!fs.existsSync(previewPath)) {
      throw new Error(`Preview image not found: ${previewPath}`);
    }

    const escapedImagePath = previewPath.replace(/\\/g, "/");
    const escapedAudioPath = audio.replace(/\\/g, "/");
    const escapedVideoPath = videoPath.replace(/\\/g, "/");

    const ffmpegCmd = `ffmpeg -loop 1 -i "${escapedImagePath}" -i "${escapedAudioPath}" -c:v libx264 -preset slow -crf 18 -b:v 5000k -c:a aac -b:a 320k -shortest -t 8 "${escapedVideoPath}" -y`;

    log.info(logFile, `Executing FFmpeg: ${ffmpegCmd}`);
    await execPromise(ffmpegCmd);
    log.success(logFile, `Video created: ${videoPath}`);

    await updateStatus("📤 Uploading video...");
    log.info(logFile, `Uploading video to user ${chatId}`);
    await bot.sendVideo(chatId, videoPath, {
      caption: `✅ Your video is ready!\n\n📌 Title: ${title}\n🏷️ Hashtags: ${hashtags}`,
    });
    log.success(logFile, `Video sent to user ${chatId}`);

    const metadataPath = path.join(postDir, "metadata.json");
    fs.writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          title,
          content,
          hashtags,
          date,
          audio,
          previewPath,
          videoPath,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
    log.success(logFile, `Metadata saved`);

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "➕ Create New Post", callback_data: "create_new" },
            { text: "📚 View History", callback_data: "view_history" },
          ],
          [{ text: "❓ Help", callback_data: "help_menu" }],
        ],
      },
    };

    await bot.sendMessage(chatId, "🎉 What's next?", opts);
    log.success(logFile, `Video generation complete`);
  } catch (error) {
    log.error(logFile, `Error generating video: ${error.message}`);
    log.error(logFile, `Stack trace: ${error.stack}`);
    await bot.sendMessage(chatId, "❌ Error creating video. Try again.");
  }
}

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;

  if (!userStates[chatId]) {
    userStates[chatId] = { step: "waiting_photo" };
  }

  const state = userStates[chatId].step;

  if (state !== "waiting_photo") {
    return;
  }

  log.info(mainLog, `User ${chatId} sent a photo`);

  if (!userStates[chatId].audio) {
    log.warn(mainLog, `User ${chatId} sent photo without selecting audio`);
    await bot.sendMessage(chatId, "⚠️ Please select an audio track first using /start");
    return;
  }

  try {
    const today = new Date();
    const dateFolders = fs
      .readdirSync(mainOutputDir)
      .filter((f) => {
        const fullPath = path.join(mainOutputDir, f);
        return fs.statSync(fullPath).isDirectory();
      })
      .sort()
      .reverse();

    let postIndex = 1;
    if (dateFolders.length > 0) {
      const latestDateFolder = dateFolders[0];
      const latestDatePath = path.join(mainOutputDir, latestDateFolder);
      const postFolders = fs
        .readdirSync(latestDatePath)
        .filter((f) => fs.statSync(path.join(latestDatePath, f)).isDirectory());
      postIndex = postFolders.length + 1;
    }

    const postDir = createPostDirectory(postIndex);
    const logFile = getLogFile(postDir);
    log.success(logFile, `Post directory created: ${postDir}`);

    const statusMsg = await bot.sendMessage(chatId, "⏳ Processing...");
    const statusMsgId = statusMsg.message_id;

    const updateStatus = async (text) => {
      log.info(logFile, `Updating status: ${text}`);
      await bot.editMessageText(text, { chat_id: chatId, message_id: statusMsgId });
    };

    if (!msg.caption) {
      log.warn(logFile, `User ${chatId} sent photo without caption`);
      await updateStatus("❌ Please send a caption with Title, Content, Hashtags.");
      return;
    }

    const caption = msg.caption;
    log.info(logFile, `Caption received: ${caption.substring(0, 50)}...`);

    const titleMatch = caption.match(/Title\s*:\s*([\s\S]*?)\nContent/i);
    const contentMatch = caption.match(/Content\s*:\s*([\s\S]*?)\nHashtags/i);
    const hashtagsMatch = caption.match(/Hashtags\s*:\s*([\s\S]*?)(\nDate|$)/i);
    const dateMatch = caption.match(/Date\s*:\s*([\s\S]*)/i);

    if (!titleMatch || !contentMatch || !hashtagsMatch) {
      log.warn(logFile, `Caption format incorrect`);
      await updateStatus(
        "❌ Caption format incorrect! Use:\n\nTitle : ...\nContent : ...\nHashtags : ...\n(Optional) Date : ..."
      );
      return;
    }

    const title = titleMatch[1].trim();
    const content = contentMatch[1].trim();
    const hashtags = hashtagsMatch[1].trim();
    log.success(logFile, `Caption parsed - Title: "${title}"`);

    const options = { day: "2-digit", month: "short", year: "numeric" };
    const date = dateMatch ? dateMatch[1].trim() : today.toLocaleDateString("en-GB", options).toUpperCase();

    const finalLogFile = getLogFile(postDir);
    log.info(finalLogFile, `Using post directory: ${postDir}`);

    await updateStatus("📥 Downloading image...");
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const file = await bot.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const ext = file.file_path.split(".").pop();
    const imagePath = path.join(postDir, `original_image.${ext}`);
    const response = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
    fs.writeFileSync(imagePath, response.data);
    log.success(finalLogFile, `Image downloaded: ${imagePath}`);

    await renderAndPreview(chatId, title, content, hashtags, date, imagePath, postDir);
  } catch (error) {
    log.error(mainLog, `Error processing photo: ${error.message}`);
    await bot.sendMessage(chatId, "❌ Error processing your request. Try again.");
  }
});
