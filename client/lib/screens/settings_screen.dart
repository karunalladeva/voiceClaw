import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart';
import '../models/app_config.dart';
import 'memory_screen.dart';
import 'models_screen.dart';
import 'skills_screen.dart';
import 'workspace_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({Key? key}) : super(key: key);

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late TextEditingController _modelController;
  late TextEditingController _voiceController;
  late String _sttMode;
  late String _engine;
  late double _temperature;
  late bool _enableInternet;
  late bool _enableMemory;
  late bool _autoMemoryStore;
  late bool _autoSkillCreate;
  late bool _retryOnFail;
  late double _maxRetries;
  late String _cacheMode;
  late TextEditingController _redisUrlController;
  late TextEditingController _nameController;
  late bool _vadEnabled;
  late bool _wakeWordEnabled;
  late bool _autoListen;

  @override
  void initState() {
    super.initState();
    final config = Provider.of<AppState>(context, listen: false).config;
    _modelController = TextEditingController(text: config?.llm.model ?? 'llama3.1');
    _voiceController = TextEditingController(text: config?.tts.defaultVoice ?? 'af_heart');
    _sttMode = config?.stt.mode ?? 'transcribe';
    _engine = config?.tts.engine ?? 'kokoro';
    _temperature = config?.llm.temperature ?? 0.2;
    _enableInternet = config?.agent.enableInternet ?? true;
    _enableMemory = config?.memory.enabled ?? true;
    _autoMemoryStore = config?.learning.autoMemoryStore ?? true;
    _autoSkillCreate = config?.learning.autoSkillCreate ?? true;
    _retryOnFail = config?.learning.retryOnFail ?? true;
    _maxRetries = (config?.learning.maxRetries ?? 3).toDouble();
    _cacheMode = config?.cache.mode ?? 'memory';
    _redisUrlController = TextEditingController(text: config?.cache.redisUrl ?? 'redis://localhost:6379');
    _nameController = TextEditingController(text: config?.assistantName ?? 'Claw');
    _vadEnabled = config?.voiceHandling.vadEnabled ?? true;
    _wakeWordEnabled = config?.voiceHandling.wakeWordEnabled ?? false;
    _autoListen = config?.voiceHandling.autoListen ?? false;
  }

  @override
  void dispose() {
    _modelController.dispose();
    _voiceController.dispose();
    _redisUrlController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final appState = Provider.of<AppState>(context, listen: false);
    final newConfig = AppConfig(
      llm: LlmConfig(model: _modelController.text, temperature: _temperature),
      stt: SttConfig(mode: _sttMode),
      tts: TtsConfig(engine: _engine, defaultVoice: _voiceController.text),
      agent: AgentConfig(enableInternet: _enableInternet),
      memory: MemoryConfig(enabled: _enableMemory),
      learning: LearningConfig(
        autoMemoryStore: _autoMemoryStore,
        autoSkillCreate: _autoSkillCreate,
        retryOnFail: _retryOnFail,
        maxRetries: _maxRetries.round(),
      ),
      cache: CacheConfig(
        mode: _cacheMode,
        redisUrl: _redisUrlController.text,
      ),
      voiceHandling: VoiceHandlingConfig(
        vadEnabled: _vadEnabled,
        wakeWordEnabled: _wakeWordEnabled,
        autoListen: _autoListen,
      ),
      assistantName: _nameController.text,
    );

    await appState.updateConfig(newConfig);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Preferences updated successfully'),
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          backgroundColor: Colors.black87,
        )
      );
      Navigator.pop(context);
    }
  }

  // ── UI Helpers ──

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(left: 12.0, bottom: 8.0, top: 24.0),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.bold,
          color: Colors.grey.shade600,
          letterSpacing: 0.8,
        ),
      ),
    );
  }

  Widget _buildCardGroup(List<Widget> children) {
    List<Widget> segmentedChildren = [];
    for (int i = 0; i < children.length; i++) {
      segmentedChildren.add(children[i]);
      if (i < children.length - 1) {
        segmentedChildren.add(Divider(height: 1, thickness: 1, color: Colors.grey.shade200));
      }
    }

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.shade200),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.015),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: segmentedChildren,
      ),
    );
  }

  Widget _buildTextFieldBlock(String label, String hint, TextEditingController controller) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
          const SizedBox(width: 16),
          Expanded(
            child: TextField(
              controller: controller,
              textAlign: TextAlign.end,
              style: TextStyle(fontSize: 15, color: Colors.grey.shade800),
              decoration: InputDecoration(
                hintText: hint,
                border: InputBorder.none,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 8),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDropdownBlock(String label, String value, List<DropdownMenuItem<String>> items, Function(String?) onChanged) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
          const SizedBox(width: 16),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: value,
                isExpanded: true,
                alignment: Alignment.centerRight,
                icon: const Icon(Icons.arrow_drop_down, color: Colors.grey),
                style: TextStyle(fontSize: 15, color: Colors.grey.shade800),
                items: items,
                onChanged: onChanged,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSwitchBlock(String title, String? subtitle, bool value, Function(bool) onChanged) {
    return SwitchListTile(
      title: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
      subtitle: subtitle != null ? Text(subtitle, style: TextStyle(fontSize: 13, color: Colors.grey.shade600)) : null,
      value: value,
      activeColor: Colors.blueAccent,
      inactiveTrackColor: Colors.grey.shade200,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 4.0),
      onChanged: onChanged,
    );
  }

  Widget _buildSliderBlock(String label, double value, double min, double max, int? divisions, Function(double) onChanged) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
              Text(value.toStringAsFixed(divisions == null ? 2 : 0), style: TextStyle(fontSize: 15, color: Colors.blue.shade700, fontWeight: FontWeight.w600)),
            ],
          ),
          Slider(
            value: value,
            min: min,
            max: max,
            divisions: divisions,
            activeColor: Colors.blueAccent,
            inactiveColor: Colors.blueAccent.withOpacity(0.2),
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }

  Widget _buildNavigationTile(String title, String subtitle, IconData icon, VoidCallback onTap) {
    return ListTile(
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: Colors.blue.shade50,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, color: Colors.blue.shade600, size: 20),
      ),
      title: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
      subtitle: Text(subtitle, style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
      trailing: const Icon(Icons.chevron_right, color: Colors.grey),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 4.0),
      onTap: onTap,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F8),
      appBar: AppBar(
        title: const Text('Settings', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 18)),
        centerTitle: true,
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1.0),
          child: Container(color: Colors.grey.shade200, height: 1.0),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
          children: [
            _buildSectionHeader('AI Models & Hardware'),
            _buildCardGroup([
              _buildTextFieldBlock('Model Name', 'llama3.1', _modelController),
              _buildSliderBlock('Temperature', _temperature, 0.0, 1.0, null, (v) => setState(() => _temperature = v)),
              _buildNavigationTile('Manage AI Models', 'Add, configure, and switch local/remote providers.', Icons.smart_toy_outlined, () {
                Navigator.push(context, MaterialPageRoute(builder: (_) => const ModelsScreen()));
              }),
            ]),

            _buildSectionHeader('Assistant Capabilities'),
            _buildCardGroup([
              _buildTextFieldBlock('Identity Name', 'e.g. Claw', _nameController),
              _buildSwitchBlock(
                'Internet Search Access', 
                'Allows the LLM to autonomously retrieve live web data.',
                _enableInternet, 
                (v) => setState(() => _enableInternet = v)
              ),
            ]),

            _buildSectionHeader('Speech & Audio Engine'),
            _buildCardGroup([
              _buildDropdownBlock(
                'Input Mode', 
                _sttMode, 
                const [
                  DropdownMenuItem(value: 'transcribe', child: Text('Local Transcribe (Whisper)')),
                  DropdownMenuItem(value: 'direct', child: Text('Direct Audio Socket')),
                ], 
                (v) { if (v != null) setState(() => _sttMode = v); }
              ),
              _buildDropdownBlock(
                'TTS Engine', 
                _engine, 
                const [
                  DropdownMenuItem(value: 'kokoro', child: Text('Kokoro-JS (Local Edge)')),
                  DropdownMenuItem(value: 'qwen', child: Text('Qwen-TTS (Python)')),
                ], 
                (v) { if (v != null) setState(() => _engine = v); }
              ),
              _buildTextFieldBlock('Default Voice Pattern', 'af_heart', _voiceController),
            ]),

            _buildSectionHeader('Voice Conversational Fluidity'),
            _buildCardGroup([
              _buildSwitchBlock(
                'Wake-Word Detection', 
                'Passively listens locally for the Assistant Name.',
                _wakeWordEnabled, 
                (v) => setState(() => _wakeWordEnabled = v)
              ),
              _buildSwitchBlock(
                'Voice Activity Detection', 
                'Automatically transmits audio prompts when you stop speaking.',
                _vadEnabled, 
                (v) => setState(() => _vadEnabled = v)
              ),
              _buildSwitchBlock(
                'Continuous Conversation', 
                'Restarts the microphone seamlessly after the Agent replies.',
                _autoListen, 
                (v) => setState(() => _autoListen = v)
              ),
            ]),

            _buildSectionHeader('Machine Memory & Learning'),
            _buildCardGroup([
              _buildSwitchBlock(
                'Infinite Long-Term Memory', 
                'Agent stores contextual data over distinct sessions.',
                _enableMemory, 
                (v) => setState(() => _enableMemory = v)
              ),
              _buildSwitchBlock(
                'Auto-Extract Experiences', 
                'Silently commits facts and personal data during chats.',
                _autoMemoryStore, 
                (v) => setState(() => _autoMemoryStore = v)
              ),
              _buildNavigationTile('View Raw Memories', 'Inspect graph database entries.', Icons.memory_outlined, () {
                Navigator.push(context, MaterialPageRoute(builder: (_) => const MemoryScreen()));
              }),
            ]),

            _buildSectionHeader('Self-Improving Graph Engine'),
            _buildCardGroup([
              _buildSwitchBlock(
                'Autonomous Skill Creation', 
                'The agent writes tools for itself to solve unknown challenges.',
                _autoSkillCreate, 
                (v) => setState(() => _autoSkillCreate = v)
              ),
              _buildSwitchBlock(
                'Iterative Task Retries', 
                'Agent observes tool trace failures and patches its execution logic.',
                _retryOnFail, 
                (v) => setState(() => _retryOnFail = v)
              ),
              if (_retryOnFail)
                _buildSliderBlock('Max Remediation Attempts', _maxRetries, 1, 5, 4, (v) => setState(() => _maxRetries = v)),
              _buildNavigationTile('Browse Source Repositories', 'View injected deterministic macro pipelines.', Icons.auto_stories_outlined, () {
                Navigator.push(context, MaterialPageRoute(builder: (_) => const SkillsScreen()));
              }),
            ]),

            _buildSectionHeader('Workspace & Storage'),
            _buildCardGroup([
              _buildNavigationTile(
                'Browse Workspace Files',
                'View and manage data, media, and skill files.',
                Icons.folder_open_rounded,
                () => Navigator.push(context, MaterialPageRoute(builder: (_) => const WorkspaceScreen())),
              ),
            ]),

            _buildSectionHeader('System Architecture'),
            _buildCardGroup([
              _buildDropdownBlock(
                'Graph State Cache', 
                _cacheMode, 
                const [
                  DropdownMenuItem(value: 'memory', child: Text('Node.js V8 In-Memory (Fastest)')),
                  DropdownMenuItem(value: 'redis', child: Text('Redis (Distributed IPC)')),
                ], 
                (v) { if (v != null) setState(() => _cacheMode = v); }
              ),
              if (_cacheMode == 'redis')
                _buildTextFieldBlock('Redis Host URL', 'redis://localhost:6379', _redisUrlController),
            ]),

            const SizedBox(height: 32),
            ElevatedButton(
              onPressed: _save,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.black87,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                elevation: 0,
              ),
              child: const Text('Save Configuration', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, letterSpacing: 0.5)),
            ),
            const SizedBox(height: 48),
          ],
        ),
      ),
    );
  }
}
