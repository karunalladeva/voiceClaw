import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

export interface AppConfig {
  llm: {
    model: string;
    temperature: number;
  };
  stt: {
    mode: 'transcribe' | 'direct';
  };
  tts: {
    engine: 'kokoro' | 'qwen';
    defaultVoice: string;
  };
  agent: {
    enableInternet: boolean;
  };
  memory: {
    enabled: boolean;
  };
}

const DEFAULT_CONFIG: AppConfig = {
  llm: {
    model: 'qwen3.5:9b',
    temperature: 0.2,
  },
  stt: {
    mode: 'transcribe',
  },
  tts: {
    engine: 'kokoro',
    defaultVoice: 'af_heart',
  },
  agent: {
    enableInternet: true,
  },
  memory: {
    enabled: true,
  },
};

class ConfigManager extends EventEmitter {
  private configPath: string;
  private currentConfig: AppConfig;
  private watcher: fsSync.FSWatcher | null = null;

  constructor() {
    super();
    this.configPath = path.join(process.cwd(), 'workspace', 'config.json');
    this.currentConfig = { ...DEFAULT_CONFIG };
  }

  async initialize() {
    try {
      // Ensure workspace exists
      await fs.mkdir(path.dirname(this.configPath), { recursive: true });
      
      try {
        const fileContent = await fs.readFile(this.configPath, 'utf-8');
        this.currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(fileContent) };
        console.log('[Config] Loaded existing configuration.');
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          console.log('[Config] No config file found. Creating default config.');
          await this.saveConfig(this.currentConfig);
        } else {
          console.error('[Config] Error reading config file:', err);
        }
      }

      this.setupWatcher();
    } catch (error) {
      console.error('[Config] Failed to initialize config manager:', error);
    }
  }

  private setupWatcher() {
    if (this.watcher) {
      this.watcher.close();
    }

    try {
      this.watcher = fsSync.watch(this.configPath, async (eventType) => {
        if (eventType === 'change') {
          console.log('[Config] Configuration file changed on disk. Reloading...');
          try {
            const fileContent = await fs.readFile(this.configPath, 'utf-8');
            const newConfig = JSON.parse(fileContent);
            this.currentConfig = { ...this.currentConfig, ...newConfig };
            this.emit('configChanged', this.currentConfig);
            console.log('[Config] Hot-reloaded configuration successfully.');
          } catch (err) {
            console.error('[Config] Failed to hot-reload configuration:', err);
          }
        }
      });
    } catch (err) {
      console.error('[Config] Could not setup file watcher:', err);
    }
  }

  getConfig(): AppConfig {
    return { ...this.currentConfig };
  }

  async updateConfig(newSettings: Partial<AppConfig>) {
    this.currentConfig = {
      ...this.currentConfig,
      ...newSettings,
      llm: { ...this.currentConfig.llm, ...(newSettings.llm || {}) },
      stt: { ...this.currentConfig.stt, ...(newSettings.stt || {}) },
      tts: { ...this.currentConfig.tts, ...(newSettings.tts || {}) },
      agent: { ...this.currentConfig.agent, ...(newSettings.agent || {}) },
      memory: { ...this.currentConfig.memory, ...(newSettings.memory || {}) },
    };
    
    await this.saveConfig(this.currentConfig);
    this.emit('configChanged', this.currentConfig);
  }

  private async saveConfig(config: AppConfig) {
    try {
      // Temporarily remove watcher to avoid triggering our own change event
      if (this.watcher) this.watcher.close();
      
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
      
      // Re-attach watcher
      this.setupWatcher();
    } catch (err) {
      console.error('[Config] Failed to save configuration:', err);
    }
  }
}

export const configManager = new ConfigManager();