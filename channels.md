# 📡 Bidirectional Channels Guide

VoiceClaw supports bidirectional communication through multiple external platforms. You can send text or audio (voice) messages from these channels to the assistant, and it will reply back in the same conversation.

## 🛠️ Global Configuration

All channels are configured via **`workspace/channels.json`**. If the file doesn't exist, it will be created on first run.

```json
[
  {
    "type": "discord",
    "name": "Discord Bot",
    "enabled": true,
    "settings": {
      "bot_token": "YOUR_DISCORD_TOKEN",
      "webhook_url": "YOUR_DISCORD_WEBHOOK"
    }
  },
  {
    "type": "telegram",
    "name": "Telegram Bot",
    "enabled": true,
    "settings": {
      "bot_token": "YOUR_TELEGRAM_TOKEN"
    }
  }
]
```

---

## 🔵 Discord Connection

1.  **Create a Bot**: Go to the [Discord Developer Portal](https://discord.com/developers/applications), create an application, and add a Bot.
2.  **Enable Intents**: Under the **Bot** tab, enable **Message Content Intent**.
3.  **Permissions**: Invite the bot to your server with `Send Messages` and `Read Message History` permissions.
4.  **Configure**: Add your `bot_token` to `channels.json` or `DISCORD_BOT_TOKEN` in `.env`.
5.  **Use**: Send a direct message to the bot or mention it in a server. Send a voice message to have it transcribed and processed!

---

## 🟠 Telegram Connection

1.  **Create a Bot**: Message [@BotFather](https://t.me/botfather) on Telegram and use `/newbot` to get a token.
2.  **Configure**: Add your `bot_token` to `channels.json` or `TELEGRAM_BOT_TOKEN` in `.env`.
3.  **Use**: Send a message to your bot. It supports text and voice notes (automatically transcribed).

---

## 🟢 WhatsApp (via Twilio)

1.  **Twilio Sandbox**: Set up a Twilio WhatsApp Sandbox or Production number.
2.  **Webhook URL**: Set your Twilio "A message comes in" webhook to:
    `http://<your-server-ip>:3000/channels/whatsapp/webhook`
3.  **Configure**: Add `twilio_sid` and `twilio_token` to your `channels.json` settings.
4.  **Use**: Send a WhatsApp message to your Twilio number.

---

## ⚪ Slack Connection

1.  **Create App**: Create a Slack App in your [Slack API dashboard](https://api.slack.com/apps).
2.  **Event Subscriptions**: Enable Events and set the **Request URL** to:
    `http://<your-server-ip>:3000/channels/slack/webhook`
3.  **Subscribe**: Subscribe to `message.channels` and `message.im` events.
4.  **Install**: Install the app to your workspace and add it to a channel.

---

## 📡 Management API

You can control your channel listeners programmatically via these endpoints:

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/channels/status` | `GET` | Get status of all active listeners |
| `/channels/:type/start` | `POST` | Manually start a specific channel listener |
| `/channels/:type/stop` | `POST` | Manually stop a specific channel listener |

---

## 🎙️ Voice & Audio Support

-   **Incoming**: When you send a voice message (Discord/Telegram/WhatsApp), VoiceClaw downloads the audio, transcribes it using your configured **STT Module**, and then processes the text.
-   **Outgoing**: Responses sent back to the channel are currently **text-only**. High-quality audio responses are primarily handled via the [client application](file:///c:/Users/Deva/Documents/Deva/Chennel/voice-to-voice/client) speakers.
