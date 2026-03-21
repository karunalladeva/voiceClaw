class ModelCapabilities {
  final bool text;
  final bool vision;
  final bool audio;
  final bool video;
  final bool functionCalling;
  final bool code;
  final bool reasoning;
  final bool embedding;
  final bool longContext;
  final int contextWindow;
  final int maxOutputTokens;

  const ModelCapabilities({
    this.text = true,
    this.vision = false,
    this.audio = false,
    this.video = false,
    this.functionCalling = false,
    this.code = true,
    this.reasoning = false,
    this.embedding = false,
    this.longContext = false,
    this.contextWindow = 4096,
    this.maxOutputTokens = 2048,
  });

  factory ModelCapabilities.fromJson(Map<String, dynamic> j) => ModelCapabilities(
        text: j['text'] == true,
        vision: j['vision'] == true,
        audio: j['audio'] == true,
        video: j['video'] == true,
        functionCalling: j['functionCalling'] == true,
        code: j['code'] == true,
        reasoning: j['reasoning'] == true,
        embedding: j['embedding'] == true,
        longContext: j['longContext'] == true,
        contextWindow: (j['contextWindow'] as num?)?.toInt() ?? 4096,
        maxOutputTokens: (j['maxOutputTokens'] as num?)?.toInt() ?? 2048,
      );

  Map<String, dynamic> toJson() => {
        'text': text,
        'vision': vision,
        'audio': audio,
        'video': video,
        'functionCalling': functionCalling,
        'code': code,
        'reasoning': reasoning,
        'embedding': embedding,
        'longContext': longContext,
        'contextWindow': contextWindow,
        'maxOutputTokens': maxOutputTokens,
      };

  /// Capability badges to show in the UI (only enabled ones).
  List<String> get badges {
    final result = <String>[];
    if (vision) result.add('Vision');
    if (audio) result.add('Audio');
    if (video) result.add('Video');
    if (functionCalling) result.add('Tools');
    if (reasoning) result.add('Reasoning');
    if (code) result.add('Code');
    if (embedding) result.add('Embed');
    if (longContext) result.add('Long ctx');
    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

class ModelAuth {
  final String? apiKey;
  final String? bearer;
  final Map<String, String>? customHeaders;

  const ModelAuth({this.apiKey, this.bearer, this.customHeaders});

  factory ModelAuth.fromJson(Map<String, dynamic> j) => ModelAuth(
        apiKey: j['apiKey'] as String?,
        bearer: j['bearer'] as String?,
        customHeaders: j['customHeaders'] != null
            ? Map<String, String>.from(j['customHeaders'] as Map)
            : null,
      );

  Map<String, dynamic> toJson() => {
        if (apiKey != null) 'apiKey': apiKey,
        if (bearer != null) 'bearer': bearer,
        if (customHeaders != null) 'customHeaders': customHeaders,
      };

  bool get isEmpty => (apiKey?.isEmpty ?? true) && (bearer?.isEmpty ?? true);
}

// ─────────────────────────────────────────────────────────────────────────────

class ModelConfig {
  final String id;
  final String name;
  final List<String> role;
  final String provider;
  final String model;
  final String? baseUrl;
  final ModelAuth? auth;
  final bool enabled;
  final bool isMaster;
  final ModelCapabilities? capabilities;
  final String? capabilitiesDetectedAt;
  final List<String> tags;
  final String? description;

  const ModelConfig({
    required this.id,
    required this.name,
    required this.role,
    required this.provider,
    required this.model,
    this.baseUrl,
    this.auth,
    this.enabled = true,
    this.isMaster = false,
    this.capabilities,
    this.capabilitiesDetectedAt,
    this.tags = const [],
    this.description,
  });

  factory ModelConfig.fromJson(Map<String, dynamic> j) {
    // role can be a string or a list
    final rawRole = j['role'];
    final List<String> roles = rawRole is List
        ? rawRole.map((e) => e.toString()).toList()
        : [rawRole?.toString() ?? 'general'];

    return ModelConfig(
      id: j['id'] as String,
      name: j['name'] as String? ?? j['id'] as String,
      role: roles,
      provider: j['provider'] as String,
      model: j['model'] as String,
      baseUrl: j['baseUrl'] as String?,
      auth: j['auth'] != null ? ModelAuth.fromJson(j['auth'] as Map<String, dynamic>) : null,
      enabled: j['enabled'] != false,
      isMaster: j['isMaster'] == true,
      capabilities: j['capabilities'] != null
          ? ModelCapabilities.fromJson(j['capabilities'] as Map<String, dynamic>)
          : null,
      capabilitiesDetectedAt: j['capabilitiesDetectedAt'] as String?,
      tags: (j['tags'] as List?)?.map((e) => e.toString()).toList() ?? [],
      description: j['description'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'role': role.length == 1 ? role.first : role,
        'provider': provider,
        'model': model,
        if (baseUrl != null && baseUrl!.isNotEmpty) 'baseUrl': baseUrl,
        if (auth != null && !auth!.isEmpty) 'auth': auth!.toJson(),
        'enabled': enabled,
        'isMaster': isMaster,
        if (tags.isNotEmpty) 'tags': tags,
        if (description != null) 'description': description,
      };

  ModelConfig copyWith({
    String? id,
    String? name,
    List<String>? role,
    String? provider,
    String? model,
    String? baseUrl,
    ModelAuth? auth,
    bool? enabled,
    bool? isMaster,
    ModelCapabilities? capabilities,
    String? capabilitiesDetectedAt,
    List<String>? tags,
    String? description,
  }) =>
      ModelConfig(
        id: id ?? this.id,
        name: name ?? this.name,
        role: role ?? this.role,
        provider: provider ?? this.provider,
        model: model ?? this.model,
        baseUrl: baseUrl ?? this.baseUrl,
        auth: auth ?? this.auth,
        enabled: enabled ?? this.enabled,
        isMaster: isMaster ?? this.isMaster,
        capabilities: capabilities ?? this.capabilities,
        capabilitiesDetectedAt: capabilitiesDetectedAt ?? this.capabilitiesDetectedAt,
        tags: tags ?? this.tags,
        description: description ?? this.description,
      );

  String get primaryRole => role.isNotEmpty ? role.first : 'general';
}

// ── Provider metadata for the UI dropdowns ────────────────────────────────────

class ProviderInfo {
  final String id;
  final String label;
  final String? defaultBaseUrl;
  final bool needsApiKey;
  final String hint;

  const ProviderInfo({
    required this.id,
    required this.label,
    this.defaultBaseUrl,
    this.needsApiKey = false,
    this.hint = '',
  });
}

const kProviders = [
  ProviderInfo(id: 'ollama',    label: 'Ollama (Local)',         defaultBaseUrl: 'http://localhost:11434',  needsApiKey: false, hint: 'e.g. llama3.1, qwen3.5:9b'),
  ProviderInfo(id: 'lmstudio',  label: 'LM Studio (Local)',      defaultBaseUrl: 'http://localhost:1234/v1',needsApiKey: false, hint: 'e.g. meta-llama-3.1-8b-instruct'),
  ProviderInfo(id: 'openai',    label: 'OpenAI',                 needsApiKey: true,  hint: 'e.g. gpt-4o, gpt-4o-mini, o3-mini'),
  ProviderInfo(id: 'anthropic', label: 'Anthropic (Claude)',     needsApiKey: true,  hint: 'e.g. claude-3-5-sonnet-20241022'),
  ProviderInfo(id: 'google',    label: 'Google (Gemini)',        needsApiKey: true,  hint: 'e.g. gemini-2.0-flash, gemini-1.5-pro'),
  ProviderInfo(id: 'mistral',   label: 'Mistral AI',            needsApiKey: true,  hint: 'e.g. mistral-large-latest, pixtral-12b'),
  ProviderInfo(id: 'deepseek',  label: 'DeepSeek',              needsApiKey: true,  hint: 'e.g. deepseek-chat, deepseek-r1'),
  ProviderInfo(id: 'custom',    label: 'Custom (OpenAI-compat)', needsApiKey: false, hint: 'Any model ID your endpoint exposes'),
];

const kRoles = [
  'master', 'general', 'vision', 'audio', 'code', 'reasoning', 'fast', 'embedding',
];

ProviderInfo providerInfo(String id) =>
    kProviders.firstWhere((p) => p.id == id, orElse: () => kProviders.last);
