import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart';
import '../models/app_config.dart';
import 'memory_screen.dart';
import 'models_screen.dart';
import 'skills_screen.dart';

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
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Settings saved')));
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16.0),
        children: [
          const Text('LLM Configuration', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          TextField(
            controller: _modelController,
            decoration: const InputDecoration(labelText: 'Model Name (e.g., llama3.1)'),
          ),
          const SizedBox(height: 16),
          Text('Temperature: ${_temperature.toStringAsFixed(2)}'),
          Slider(
            value: _temperature,
            min: 0.0,
            max: 1.0,
            onChanged: (val) => setState(() => _temperature = val),
          ),
          const Divider(height: 48),
          const Text('Agent Configuration', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          SwitchListTile(
            title: const Text('Enable Internet Search Tool'),
            subtitle: const Text('Allows the LLM to search the web if it does not know the answer.'),
            value: _enableInternet,
            onChanged: (val) => setState(() => _enableInternet = val),
          ),
          const Divider(height: 48),
          const Text('STT Configuration', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          DropdownButtonFormField<String>(
            value: _sttMode,
            decoration: const InputDecoration(labelText: 'STT Mode'),
            items: const [
              DropdownMenuItem(value: 'transcribe', child: Text('Local Transcribe (Whisper)')),
              DropdownMenuItem(value: 'direct', child: Text('Direct to LLM (Audio)')),
            ],
            onChanged: (val) {
              if (val != null) setState(() => _sttMode = val);
            },
          ),
          const Divider(height: 48),
          const Text('TTS Configuration', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          DropdownButtonFormField<String>(
            value: _engine,
            decoration: const InputDecoration(labelText: 'TTS Engine'),
            items: const [
              DropdownMenuItem(value: 'kokoro', child: Text('Kokoro-JS (Local)')),
              DropdownMenuItem(value: 'qwen', child: Text('Qwen-TTS (Python API)')),
            ],
            onChanged: (val) {
              if (val != null) setState(() => _engine = val);
            },
          ),
          TextField(
            controller: _voiceController,
            decoration: const InputDecoration(labelText: 'Default Voice'),
          ),
          const Divider(height: 48),
          const Text('Model Configuration', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          ListTile(
            leading: const Icon(Icons.smart_toy_outlined),
            title: const Text('Manage AI Models'),
            subtitle: const Text('Add, configure, and switch between providers'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ModelsScreen()),
            ),
          ),
          const Divider(height: 48),
          const Text('Memory Configuration', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          SwitchListTile(
            title: const Text('Enable Long-Term Memory'),
            subtitle: const Text('Agent searches past memories and stores new facts automatically.'),
            value: _enableMemory,
            onChanged: (val) => setState(() => _enableMemory = val),
          ),
          ListTile(
            leading: const Icon(Icons.memory_outlined),
            title: const Text('Manage Memories'),
            subtitle: const Text('View, add, or delete stored memories'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const MemoryScreen()),
            ),
          ),
          const SizedBox(height: 32),
          const Divider(height: 48),
          const Text('Self-Learning', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          SwitchListTile(
            title: const Text('Auto Memory Store'),
            subtitle: const Text('Automatically saves important facts from every conversation.'),
            value: _autoMemoryStore,
            onChanged: (val) => setState(() => _autoMemoryStore = val),
          ),
          SwitchListTile(
            title: const Text('Auto Skill Creation'),
            subtitle: const Text('Creates SKILL.md files when the agent encounters tasks it cannot do.'),
            value: _autoSkillCreate,
            onChanged: (val) => setState(() => _autoSkillCreate = val),
          ),
          SwitchListTile(
            title: const Text('Retry Until Done'),
            subtitle: const Text('Agent retries failed tasks and learns from each attempt.'),
            value: _retryOnFail,
            onChanged: (val) => setState(() => _retryOnFail = val),
          ),
          if (_retryOnFail) ...[
            Text('Max Retries: ${_maxRetries.round()}'),
            Slider(
              value: _maxRetries,
              min: 1,
              max: 5,
              divisions: 4,
              onChanged: (val) => setState(() => _maxRetries = val),
            ),
          ],
          ListTile(
            leading: const Icon(Icons.auto_stories_outlined),
            title: const Text('View Learned Skills'),
            subtitle: const Text('Browse and delete skills the agent has taught itself.'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SkillsScreen()),
            ),
          ),
          const Divider(height: 48),
          const Text('Caching Configuration', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('Speeds up responses by storing search results and past memories in a fast cache.', style: TextStyle(color: Colors.grey, fontSize: 13)),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            value: _cacheMode,
            decoration: const InputDecoration(labelText: 'Cache Mode', border: OutlineInputBorder()),
            items: const [
              DropdownMenuItem(value: 'memory', child: Text('In-Memory (Default, Simple)')),
              DropdownMenuItem(value: 'redis', child: Text('Redis (Advanced, Persistent)')),
            ],
            onChanged: (val) {
              if (val != null) setState(() => _cacheMode = val);
            },
          ),
          if (_cacheMode == 'redis') ...[
            const SizedBox(height: 16),
            TextField(
              controller: _redisUrlController,
              decoration: const InputDecoration(
                labelText: 'Redis URL',
                hintText: 'redis://localhost:6379',
                border: OutlineInputBorder(),
              ),
            ),
          ],
          const SizedBox(height: 32),

          const Divider(height: 48),
          const Text('Voice & Personality', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('Configure how the assistant listens and its identity.', style: TextStyle(color: Colors.grey, fontSize: 13)),
          const SizedBox(height: 16),
          TextField(
            controller: _nameController,
            decoration: const InputDecoration(
              labelText: 'Assistant Name',
              hintText: 'e.g., Claw or Buddy',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          SwitchListTile(
            title: const Text('Wake-Word Detection'),
            subtitle: const Text('Starts listening when you say the assistant\'s name.'),
            value: _wakeWordEnabled,
            onChanged: (val) => setState(() => _wakeWordEnabled = val),
          ),
          SwitchListTile(
            title: const Text('Voice Activity Detection (VAD)'),
            subtitle: const Text('Automatically sends your message when you stop talking.'),
            value: _vadEnabled,
            onChanged: (val) => setState(() => _vadEnabled = val),
          ),
          SwitchListTile(
            title: const Text('Auto-Listen after Response'),
            subtitle: const Text('Automatically starts the mic after the assistant finishes speaking (Hands-Free).'),
            value: _autoListen,
            onChanged: (val) => setState(() => _autoListen = val),
          ),
          const SizedBox(height: 32),
          ElevatedButton(
            onPressed: _save,
            child: const Text('Save Configuration'),
          ),
        ],
      ),
    );
  }
}
