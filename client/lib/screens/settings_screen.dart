import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart';
import '../models/app_config.dart';
import 'memory_screen.dart';

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
  }

  @override
  void dispose() {
    _modelController.dispose();
    _voiceController.dispose();
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
          ElevatedButton(
            onPressed: _save,
            child: const Text('Save Configuration'),
          )
        ],
      ),
    );
  }
}
