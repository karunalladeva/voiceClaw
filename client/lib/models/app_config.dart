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

  Map<String, dynamic> toJson() {
    return {
      'enableInternet': enableInternet,
    };
  }
}

class AppConfig {
  LlmConfig llm;
  SttConfig stt;
  TtsConfig tts;
  AgentConfig agent;

  AppConfig({required this.llm, required this.stt, required this.tts, required this.agent});

  factory AppConfig.fromJson(Map<String, dynamic> json) {
    return AppConfig(
      llm: LlmConfig.fromJson(json['llm'] ?? {}),
      stt: SttConfig.fromJson(json['stt'] ?? {}),
      tts: TtsConfig.fromJson(json['tts'] ?? {}),
      agent: AgentConfig.fromJson(json['agent'] ?? {}),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'llm': llm.toJson(),
      'stt': stt.toJson(),
      'tts': tts.toJson(),
      'agent': agent.toJson(),
    };
  }
}