class LlmConfig {
  String model;
  double temperature;

  LlmConfig({required this.model, required this.temperature});

  factory LlmConfig.fromJson(Map<String, dynamic> json) {
    return LlmConfig(
      model: json['model'] ?? 'llama3.1',
      temperature: (json['temperature'] ?? 0.2).toDouble(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'model': model,
      'temperature': temperature,
    };
  }
}

class SttConfig {
  String mode;

  SttConfig({required this.mode});

  factory SttConfig.fromJson(Map<String, dynamic> json) {
    return SttConfig(
      mode: json['mode'] ?? 'transcribe',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'mode': mode,
    };
  }
}

class TtsConfig {
  String engine;
  String defaultVoice;

  TtsConfig({required this.engine, required this.defaultVoice});

  factory TtsConfig.fromJson(Map<String, dynamic> json) {
    return TtsConfig(
      engine: json['engine'] ?? 'kokoro',
      defaultVoice: json['defaultVoice'] ?? 'af_heart',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'engine': engine,
      'defaultVoice': defaultVoice,
    };
  }
}

class AgentConfig {
  bool enableInternet;

  AgentConfig({required this.enableInternet});

  factory AgentConfig.fromJson(Map<String, dynamic> json) {
    return AgentConfig(
      enableInternet: json['enableInternet'] ?? true,
    );
  }

  Map<String, dynamic> toJson() => {'enableInternet': enableInternet};
}

class MemoryConfig {
  bool enabled;

  MemoryConfig({required this.enabled});

  factory MemoryConfig.fromJson(Map<String, dynamic> json) {
    return MemoryConfig(enabled: json['enabled'] ?? true);
  }

  Map<String, dynamic> toJson() => {'enabled': enabled};
}

class LearningConfig {
  bool autoMemoryStore;
  bool autoSkillCreate;
  bool retryOnFail;
  int maxRetries;

  LearningConfig({
    required this.autoMemoryStore,
    required this.autoSkillCreate,
    required this.retryOnFail,
    required this.maxRetries,
  });

  factory LearningConfig.fromJson(Map<String, dynamic> json) => LearningConfig(
        autoMemoryStore: json['autoMemoryStore'] ?? true,
        autoSkillCreate: json['autoSkillCreate'] ?? true,
        retryOnFail: json['retryOnFail'] ?? true,
        maxRetries: (json['maxRetries'] as num?)?.toInt() ?? 3,
      );

  Map<String, dynamic> toJson() => {
        'autoMemoryStore': autoMemoryStore,
        'autoSkillCreate': autoSkillCreate,
        'retryOnFail': retryOnFail,
        'maxRetries': maxRetries,
      };
}

class CacheConfig {
  String mode;
  String? redisUrl;

  CacheConfig({required this.mode, this.redisUrl});

  factory CacheConfig.fromJson(Map<String, dynamic> json) {
    return CacheConfig(
      mode: json['mode'] ?? 'memory',
      redisUrl: json['redisUrl'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'mode': mode,
      'redisUrl': redisUrl,
    };
  }
}

class VoiceHandlingConfig {
  bool vadEnabled;
  bool wakeWordEnabled;
  bool autoListen;

  VoiceHandlingConfig({
    required this.vadEnabled,
    required this.wakeWordEnabled,
    required this.autoListen,
  });

  factory VoiceHandlingConfig.fromJson(Map<String, dynamic> json) {
    return VoiceHandlingConfig(
      vadEnabled: json['vadEnabled'] ?? true,
      wakeWordEnabled: json['wakeWordEnabled'] ?? false,
      autoListen: json['autoListen'] ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'vadEnabled': vadEnabled,
      'wakeWordEnabled': wakeWordEnabled,
      'autoListen': autoListen,
    };
  }
}

class AppConfig {
  LlmConfig llm;
  SttConfig stt;
  TtsConfig tts;
  AgentConfig agent;
  MemoryConfig memory;
  LearningConfig learning;
  CacheConfig cache;
  VoiceHandlingConfig voiceHandling;
  String assistantName;

  AppConfig({
    required this.llm,
    required this.stt,
    required this.tts,
    required this.agent,
    required this.memory,
    required this.learning,
    required this.cache,
    required this.voiceHandling,
    required this.assistantName,
  });

  factory AppConfig.fromJson(Map<String, dynamic> json) {
    return AppConfig(
      llm: LlmConfig.fromJson(json['llm'] ?? {}),
      stt: SttConfig.fromJson(json['stt'] ?? {}),
      tts: TtsConfig.fromJson(json['tts'] ?? {}),
      agent: AgentConfig.fromJson(json['agent'] ?? {}),
      memory: MemoryConfig.fromJson(json['memory'] ?? {}),
      learning: LearningConfig.fromJson(json['learning'] ?? {}),
      cache: CacheConfig.fromJson(json['cache'] ?? {}),
      voiceHandling: VoiceHandlingConfig.fromJson(json['voiceHandling'] ?? {}),
      assistantName: json['assistantName'] ?? 'Claw',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'llm': llm.toJson(),
      'stt': stt.toJson(),
      'tts': tts.toJson(),
      'agent': agent.toJson(),
      'memory': memory.toJson(),
      'learning': learning.toJson(),
      'cache': cache.toJson(),
      'voiceHandling': voiceHandling.toJson(),
      'assistantName': assistantName,
    };
  }
}