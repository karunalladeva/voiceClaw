/**
 * Channel Input Manager
 * 
 * Orchestrates bidirectional channel communication. When a channel receives
 * a message (text or audio), this manager routes it through the ReactAgent
 * and sends the agent's response back to the same channel via replyFn.
 * 
 * Lifecycle:
 *   1. startAll() — boot listeners for all enabled channels that support input
 *   2. handleMessage() — route incoming ChannelMessage to the agent
 *   3. stopAll() — teardown all active listeners
 */

import { ChannelMessage, loadChannels, getProvider, getInputCapableChannels } from './channels';
import { extractMediaAttachments } from '../utils/media-attachments';
import { STTModule } from '../stt/whisper';
import { ReactAgent } from '../agents/react-agent';
import { agentEvents } from '../admin/agent-events';
import { configManager } from '../config/index';

export interface PendingPairing {
  code: string;
  channelType: string;
  senderId: string;
  senderName: string;
  timestamp: number;
}

export interface ChannelListenerStatus {
  type: string;
  name: string;
  active: boolean;
  startedAt?: number;
  error?: string;
}

class ChannelInputManager {
  private activeListeners = new Map<string, { stop: () => void; startedAt: number }>();
  private agent: ReactAgent | null = null;
  private pendingPairings = new Map<string, PendingPairing>();

  /** Inject the shared ReactAgent instance from server startup */
  setAgent(agent: ReactAgent) {
    this.agent = agent;
  }

  /** Start listeners for ALL enabled channels that support input */
  async startAll(): Promise<void> {
    const channels = await loadChannels();
    const inputCapable = getInputCapableChannels();

    for (const ch of channels) {
      if (!ch.enabled) continue;
      if (!inputCapable.includes(ch.type)) continue;
      if (this.activeListeners.has(ch.type)) continue; // already running

      await this.startChannel(ch.type).catch(e => {
        const message = `[ChannelInput] Failed to start ${ch.type}: ${e.message}`;
        console.error(message);
        agentEvents.log('error', message, { channelType: ch.type });
      });
    }
  }

  /** Start listening on a specific channel (no-op if already active). */
  async startChannel(type: string): Promise<void> {
    if (this.activeListeners.has(type)) {
      return;
    }

    const provider = getProvider(type);
    if (!provider || !provider.startListening) {
      throw new Error(`Channel "${type}" does not support input listening.`);
    }

    const channels = await loadChannels();
    const config = channels.find(c => c.type === type);
    const settings = config?.settings || {};

    agentEvents.log('info', `[ChannelInput] Starting listener for: ${type}`, { channelType: type });
    console.log(`[ChannelInput] Starting listener for: ${type}`);
    const stop = await provider.startListening(settings, (msg) => this.handleMessage(msg));

    this.activeListeners.set(type, { stop, startedAt: Date.now() });
    agentEvents.log('info', `[ChannelInput] ${type} listener active`, { channelType: type });
    console.log(`[ChannelInput] ✅ ${type} listener active.`);
  }

  /** Stop listening on a specific channel */
  async stopChannel(type: string): Promise<void> {
    const listener = this.activeListeners.get(type);
    if (!listener) {
      console.log(`[ChannelInput] ${type} is not currently listening.`);
      return;
    }

    listener.stop();
    this.activeListeners.delete(type);
    agentEvents.log('info', `[ChannelInput] ${type} listener stopped`, { channelType: type });
    console.log(`[ChannelInput] 🛑 ${type} listener stopped.`);
  }

  /** Stop ALL active listeners */
  async stopAll(): Promise<void> {
    for (const [type, listener] of this.activeListeners) {
      console.log(`[ChannelInput] Stopping ${type}...`);
      listener.stop();
    }
    this.activeListeners.clear();
  }

  /** Restart a specific channel (stop then start) */
  async restartChannel(type: string): Promise<void> {
    await this.stopChannel(type);
    if (type === 'whatsapp') {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    await this.startChannel(type);
  }

  /** Start only when not already listening (safe for toggle/save). */
  async ensureChannelRunning(type: string): Promise<void> {
    if (this.activeListeners.has(type)) {
      return;
    }
    await this.startChannel(type);
  }

  /** Get the status of all channel listeners */
  getStatus(): ChannelListenerStatus[] {
    const inputCapable = getInputCapableChannels();
    return inputCapable.map(type => {
      const listener = this.activeListeners.get(type);
      const provider = getProvider(type);
      return {
        type,
        name: provider?.name || type,
        active: !!listener,
        startedAt: listener?.startedAt,
      };
    });
  }

  /** Check if a specific channel is actively listening */
  isListening(type: string): boolean {
    return this.activeListeners.has(type);
  }

  getPendingPairings(): PendingPairing[] {
    return Array.from(this.pendingPairings.values());
  }

  approvePairing(code: string): boolean {
    const pairing = this.pendingPairings.get(code);
    if (!pairing) return false;

    const config = configManager.getConfig();
    const approved = config.approved_senders || {};
    if (!approved[pairing.channelType]) approved[pairing.channelType] = [];
    if (!approved[pairing.channelType].includes(pairing.senderId)) {
      approved[pairing.channelType].push(pairing.senderId);
    }
    
    configManager.updateConfig({ approved_senders: approved }).catch(console.error);
    this.pendingPairings.delete(code);
    
    // Optionally notify the user. For true bidirectional, we need settings, which might not be available easily without replyFn.
    // For now, they will find out when they message again.
    console.log(`[ChannelInput] ✅ Approved pairing for ${pairing.senderName} (${pairing.channelType})`);
    agentEvents.log('info', `[ChannelInput] Approved pairing for ${pairing.senderName} on ${pairing.channelType}`, {
      channelType: pairing.channelType,
      senderId: pairing.senderId,
    });
    return true;
  }

  rejectPairing(code: string): boolean {
    return this.pendingPairings.delete(code);
  }

  private async runAgent(input: string, chatId: string): Promise<string> {
    if (!this.agent) {
      throw new Error('No agent available');
    }
    let response = '';
    for await (const event of this.agent.processStream(input, chatId)) {
      if (event.type === 'text_done' || event.type === 'error') {
        response = typeof event.data === 'string' ? event.data : String(event.data);
      }
    }
    return response || 'Sorry, I could not generate a response.';
  }

  /**
   * Core message handler — called when ANY channel receives an incoming message.
   * Routes to the ReactAgent, then sends response back via replyFn.
   */
  private async handleMessage(msg: ChannelMessage): Promise<void> {
    if (!this.agent) {
      const message = '[ChannelInput] No agent available — dropping message.';
      console.error(message);
      agentEvents.log('error', message, { channelType: msg.channelType });
      return;
    }

    const config = configManager.getConfig();
    const approved = config.approved_senders?.[msg.channelType] || [];
    
    // Pairing check
    if (!approved.includes(msg.senderId)) {
        // Generate a 6-character uppercase pairing code
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        // Remove existing pending pairings for this user
        for (const [existingCode, p] of this.pendingPairings.entries()) {
            if (p.channelType === msg.channelType && p.senderId === msg.senderId) {
                this.pendingPairings.delete(existingCode);
            }
        }
        
        this.pendingPairings.set(code, {
            code,
            channelType: msg.channelType,
            senderId: msg.senderId,
            senderName: msg.senderName,
            timestamp: Date.now()
        });
        
        console.log(`[ChannelInput] Unauthorized access from ${msg.senderName} (${msg.senderId}). Generated pairing code: ${code}`);
        agentEvents.log('warn', `[ChannelInput] Pairing required for ${msg.senderName} on ${msg.channelType} (code: ${code})`, {
          channelType: msg.channelType,
          senderId: msg.senderId,
          senderName: msg.senderName,
        });
        try {
            await msg.replyFn(`🔒 VoiceClaw Pairing Required.\n\nYour pairing code is: *${code}*\n\nPlease approve this code in your admin dashboard to start chatting.`);
        } catch (e) {
            console.error('[ChannelInput] Failed to send pairing code:', e);
        }
        return;
    }

    const chatId = `channel-${msg.channelType}-${msg.senderId}`;
    const preview = msg.text?.substring(0, 100) || '[audio]';
    console.log(`[ChannelInput] 📩 ${msg.channelType}/${msg.senderName}: ${preview}`);
    agentEvents.log('info', `[Channel:${msg.channelType}] Message from ${msg.senderName}: ${preview}`, {
      chatId,
      channelType: msg.channelType,
      senderId: msg.senderId,
      senderName: msg.senderName,
    });

    try {
      let input: string;

      if (msg.audioBuffer) {
        console.log(`[ChannelInput] Transcribing ${msg.audioMime || 'audio'} from ${msg.channelType}...`);
        agentEvents.log('info', `[Channel:${msg.channelType}] Transcribing voice message from ${msg.senderName}`, {
          chatId,
          channelType: msg.channelType,
        });
        const ext = this.mimeToExtension(msg.audioMime || 'audio/ogg');
        input = await this.transcribeAudio(msg.audioBuffer, ext);
        console.log(`[ChannelInput] Transcription: "${input.substring(0, 100)}"`);
        agentEvents.log('info', `[Channel:${msg.channelType}] Transcription: "${input.substring(0, 120)}"`, { chatId });
      } else if (msg.text) {
        input = msg.text;
      } else {
        console.warn('[ChannelInput] Message has no text or audio — ignoring.');
        agentEvents.log('warn', `[Channel:${msg.channelType}] Ignored empty message from ${msg.senderName}`, { chatId });
        return;
      }

      const response = await this.runAgent(input, chatId);
      const attachments = extractMediaAttachments(response);

      await msg.replyFn(response, attachments);
      console.log(`[ChannelInput] ✅ Replied on ${msg.channelType}: "${response.substring(0, 80)}..."${attachments.length ? ` (+${attachments.length} media)` : ''}`);
      agentEvents.log('info', `[Channel:${msg.channelType}] Replied to ${msg.senderName}: "${response.substring(0, 120)}"`, {
        chatId,
        channelType: msg.channelType,
      });
    } catch (err: any) {
      const errorMessage = `[ChannelInput] Error processing message from ${msg.channelType}: ${err.message}`;
      console.error(errorMessage);
      agentEvents.log('error', errorMessage, { chatId, channelType: msg.channelType });
      try {
        await msg.replyFn('Sorry, I encountered an error processing your message. Please try again.');
      } catch {}
    }
  }

  /** Transcribe audio buffer via STT module */
  private async transcribeAudio(buffer: Buffer, ext: string): Promise<string> {
    try {
      return await STTModule.transcribeBuffer(buffer, ext);
    } catch (e: any) {
      console.error('[ChannelInput] STT transcription failed:', e.message);
      return '[Audio message received but transcription failed]';
    }
  }

  /** Convert MIME type to file extension */
  private mimeToExtension(mime: string): string {
    const map: Record<string, string> = {
      'audio/ogg': '.ogg',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/webm': '.webm',
      'audio/mp4': '.m4a',
      'audio/x-wav': '.wav',
    };
    return map[mime] || '.ogg';
  }
}

export const channelInputManager = new ChannelInputManager();
