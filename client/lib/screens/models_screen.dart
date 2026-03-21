import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart';
import '../models/model_config.dart';

// ── Main screen ───────────────────────────────────────────────────────────────

class ModelsScreen extends StatefulWidget {
  const ModelsScreen({Key? key}) : super(key: key);

  @override
  State<ModelsScreen> createState() => _ModelsScreenState();
}

class _ModelsScreenState extends State<ModelsScreen> {
  List<ModelConfig> _models = [];
  bool _loading = true;
  bool _detecting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final api = Provider.of<AppState>(context, listen: false).apiService;
      final models = await api.listModels();
      if (mounted) setState(() { _models = models; _loading = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _detectAll() async {
    setState(() => _detecting = true);
    try {
      final api = Provider.of<AppState>(context, listen: false).apiService;
      final models = await api.detectAllCapabilities();
      if (mounted) setState(() { _models = models; _detecting = false; });
      _snack('Capabilities refreshed for all models');
    } catch (e) {
      if (mounted) setState(() => _detecting = false);
      _snack('Error: $e', error: true);
    }
  }

  Future<void> _delete(ModelConfig m) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Delete Model'),
        content: Text('Remove "${m.name}" from the registry?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await Provider.of<AppState>(context, listen: false).apiService.deleteModel(m.id);
      await _load();
    } catch (e) {
      _snack('Error: $e', error: true);
    }
  }

  Future<void> _setMaster(ModelConfig m) async {
    try {
      await Provider.of<AppState>(context, listen: false).apiService.setMasterModel(m.id);
      await _load();
      _snack('${m.name} set as master model');
    } catch (e) {
      _snack('Error: $e', error: true);
    }
  }

  Future<void> _detectCapabilities(ModelConfig m) async {
    _snack('Detecting capabilities for ${m.name}…');
    try {
      final api = Provider.of<AppState>(context, listen: false).apiService;
      await api.detectModelCapabilities(m.id);
      await _load();
      _snack('Capabilities updated for ${m.name}');
    } catch (e) {
      _snack('Error: $e', error: true);
    }
  }

  Future<void> _openEditor({ModelConfig? model}) async {
    final result = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => _ModelEditorScreen(existing: model)),
    );
    if (result == true) await _load();
  }

  void _snack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? Colors.red : null,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Models'),
        actions: [
          if (_detecting)
            const Padding(
              padding: EdgeInsets.all(14),
              child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
            )
          else
            IconButton(
              icon: const Icon(Icons.radar),
              tooltip: 'Detect all capabilities',
              onPressed: _detectAll,
            ),
          IconButton(icon: const Icon(Icons.refresh), tooltip: 'Refresh', onPressed: _load),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openEditor(),
        icon: const Icon(Icons.add),
        label: const Text('Add Model'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _ErrorView(message: _error!, onRetry: _load)
              : _models.isEmpty
                  ? const _EmptyView()
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(12, 12, 12, 88),
                      itemCount: _models.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (_, i) => _ModelCard(
                        model: _models[i],
                        onEdit: () => _openEditor(model: _models[i]),
                        onDelete: () => _delete(_models[i]),
                        onSetMaster: () => _setMaster(_models[i]),
                        onDetect: () => _detectCapabilities(_models[i]),
                      ),
                    ),
    );
  }
}

// ── Model card ────────────────────────────────────────────────────────────────

class _ModelCard extends StatelessWidget {
  final ModelConfig model;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onSetMaster;
  final VoidCallback onDetect;

  const _ModelCard({
    required this.model,
    required this.onEdit,
    required this.onDelete,
    required this.onSetMaster,
    required this.onDetect,
  });

  @override
  Widget build(BuildContext context) {
    final caps = model.capabilities;
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Card(
      elevation: model.isMaster ? 3 : 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: model.isMaster
            ? BorderSide(color: colorScheme.primary, width: 2)
            : BorderSide.none,
      ),
      child: InkWell(
        onTap: onEdit,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── Header row ──
              Row(
                children: [
                  if (model.isMaster)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: Icon(Icons.star_rounded, color: colorScheme.primary, size: 18),
                    ),
                  Expanded(
                    child: Text(
                      model.name,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: model.enabled ? null : Colors.grey,
                      ),
                    ),
                  ),
                  if (!model.enabled)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade200,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text('Disabled',
                          style: TextStyle(fontSize: 11, color: Colors.grey)),
                    ),
                ],
              ),
              const SizedBox(height: 4),

              // ── Provider / model name ──
              Row(
                children: [
                  _ProviderChip(provider: model.provider),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      model.model,
                      style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),

              // ── Role chips ──
              const SizedBox(height: 8),
              Wrap(
                spacing: 4,
                runSpacing: 4,
                children: [
                  ...model.role.map((r) => _RoleChip(role: r)),
                  // Capability badges from detection
                  if (caps != null)
                    ...caps.badges.map((b) => _CapBadge(label: b)),
                ],
              ),

              // ── Context window ──
              if (caps != null && caps.contextWindow > 0) ...[
                const SizedBox(height: 6),
                Text(
                  'Context: ${_fmtCtx(caps.contextWindow)} tokens',
                  style: TextStyle(fontSize: 11, color: Colors.grey[500]),
                ),
              ],

              // ── Action row ──
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  if (!model.isMaster)
                    _ActionBtn(
                      icon: Icons.star_border,
                      label: 'Set master',
                      onPressed: onSetMaster,
                    ),
                  _ActionBtn(
                    icon: Icons.radar,
                    label: 'Detect',
                    onPressed: onDetect,
                  ),
                  _ActionBtn(
                    icon: Icons.edit_outlined,
                    label: 'Edit',
                    onPressed: onEdit,
                  ),
                  _ActionBtn(
                    icon: Icons.delete_outline,
                    label: 'Delete',
                    onPressed: onDelete,
                    color: Colors.red,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _fmtCtx(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).round()}k';
    return '$n';
  }
}

// ── Add / Edit screen ─────────────────────────────────────────────────────────

class _ModelEditorScreen extends StatefulWidget {
  final ModelConfig? existing;
  const _ModelEditorScreen({this.existing});

  @override
  State<_ModelEditorScreen> createState() => _ModelEditorScreenState();
}

class _ModelEditorScreenState extends State<_ModelEditorScreen> {
  final _formKey = GlobalKey<FormState>();

  late TextEditingController _idCtrl;
  late TextEditingController _nameCtrl;
  late TextEditingController _modelCtrl;
  late TextEditingController _baseUrlCtrl;
  late TextEditingController _apiKeyCtrl;
  late TextEditingController _bearerCtrl;
  late TextEditingController _tagsCtrl;
  late TextEditingController _descCtrl;

  late String _provider;
  late String _role;
  late bool _enabled;
  late bool _isMaster;
  bool _saving = false;
  bool _showAuth = false;

  bool get _isEditing => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final m = widget.existing;
    _provider = m?.provider ?? 'ollama';
    _role = m?.primaryRole ?? 'general';
    _enabled = m?.enabled ?? true;
    _isMaster = m?.isMaster ?? false;
    _showAuth = m?.auth != null && !m!.auth!.isEmpty;

    _idCtrl = TextEditingController(text: m?.id ?? '');
    _nameCtrl = TextEditingController(text: m?.name ?? '');
    _modelCtrl = TextEditingController(text: m?.model ?? '');
    _baseUrlCtrl = TextEditingController(text: m?.baseUrl ?? '');
    _apiKeyCtrl = TextEditingController(text: m?.auth?.apiKey ?? '');
    _bearerCtrl = TextEditingController(text: m?.auth?.bearer ?? '');
    _tagsCtrl = TextEditingController(text: m?.tags.join(', ') ?? '');
    _descCtrl = TextEditingController(text: m?.description ?? '');
  }

  @override
  void dispose() {
    for (final c in [_idCtrl, _nameCtrl, _modelCtrl, _baseUrlCtrl, _apiKeyCtrl, _bearerCtrl, _tagsCtrl, _descCtrl]) {
      c.dispose();
    }
    super.dispose();
  }

  String _autoId() {
    final p = _provider.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');
    final m = _modelCtrl.text.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '-');
    return '$p-$m'.replaceAll(RegExp(r'-+'), '-').substring(0, (p.length + 1 + m.length).clamp(0, 32));
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);

    final id = _idCtrl.text.trim().isEmpty ? _autoId() : _idCtrl.text.trim();
    final name = _nameCtrl.text.trim().isEmpty
        ? '${providerInfo(_provider).label} / ${_modelCtrl.text.trim()}'
        : _nameCtrl.text.trim();

    final tags = _tagsCtrl.text
        .split(',')
        .map((t) => t.trim())
        .where((t) => t.isNotEmpty)
        .toList();

    ModelAuth? auth;
    if (_apiKeyCtrl.text.trim().isNotEmpty || _bearerCtrl.text.trim().isNotEmpty) {
      auth = ModelAuth(
        apiKey: _apiKeyCtrl.text.trim().isEmpty ? null : _apiKeyCtrl.text.trim(),
        bearer: _bearerCtrl.text.trim().isEmpty ? null : _bearerCtrl.text.trim(),
      );
    }

    final info = providerInfo(_provider);
    String? baseUrl = _baseUrlCtrl.text.trim();
    if (baseUrl.isEmpty) baseUrl = info.defaultBaseUrl;

    final config = ModelConfig(
      id: id,
      name: name,
      role: [_role],
      provider: _provider,
      model: _modelCtrl.text.trim(),
      baseUrl: baseUrl,
      auth: auth,
      enabled: _enabled,
      isMaster: _isMaster,
      tags: tags,
      description: _descCtrl.text.trim().isEmpty ? null : _descCtrl.text.trim(),
    );

    try {
      await Provider.of<AppState>(context, listen: false).apiService.saveModel(config);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final info = providerInfo(_provider);

    return Scaffold(
      appBar: AppBar(title: Text(_isEditing ? 'Edit Model' : 'Add Model')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // ── Provider ──
            _SectionHeader('Provider'),
            DropdownButtonFormField<String>(
              value: _provider,
              decoration: const InputDecoration(labelText: 'Provider', border: OutlineInputBorder()),
              items: kProviders.map((p) => DropdownMenuItem(
                value: p.id,
                child: Text(p.label),
              )).toList(),
              onChanged: (v) {
                if (v == null) return;
                setState(() {
                  _provider = v;
                  _baseUrlCtrl.text = providerInfo(v).defaultBaseUrl ?? '';
                });
              },
            ),
            const SizedBox(height: 12),

            // ── Model ID ──
            TextFormField(
              controller: _modelCtrl,
              decoration: InputDecoration(
                labelText: 'Model Name / ID *',
                helperText: info.hint,
                border: const OutlineInputBorder(),
              ),
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: 12),

            // ── Display name ──
            TextFormField(
              controller: _nameCtrl,
              decoration: const InputDecoration(
                labelText: 'Display Name',
                helperText: 'Auto-generated if left blank',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),

            // ── Base URL ──
            TextFormField(
              controller: _baseUrlCtrl,
              decoration: InputDecoration(
                labelText: 'Base URL',
                helperText: info.defaultBaseUrl != null
                    ? 'Default: ${info.defaultBaseUrl}'
                    : 'Leave blank for default',
                border: const OutlineInputBorder(),
              ),
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 16),

            // ── Role ──
            _SectionHeader('Role'),
            DropdownButtonFormField<String>(
              value: _role,
              decoration: const InputDecoration(labelText: 'Primary Role', border: OutlineInputBorder()),
              items: kRoles.map((r) => DropdownMenuItem(
                value: r,
                child: Text(_roleLabel(r)),
              )).toList(),
              onChanged: (v) { if (v != null) setState(() => _role = v); },
            ),
            const SizedBox(height: 12),

            // ── Flags ──
            SwitchListTile(
              title: const Text('Enabled'),
              subtitle: const Text('Include this model in routing'),
              value: _enabled,
              onChanged: (v) => setState(() => _enabled = v),
              contentPadding: EdgeInsets.zero,
            ),
            SwitchListTile(
              title: const Text('Set as Master'),
              subtitle: const Text('Use as the primary conversation model'),
              value: _isMaster,
              onChanged: (v) => setState(() => _isMaster = v),
              contentPadding: EdgeInsets.zero,
            ),
            const SizedBox(height: 16),

            // ── Auth ──
            _SectionHeader('Authentication'),
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Add API credentials'),
              trailing: Icon(_showAuth ? Icons.expand_less : Icons.expand_more),
              onTap: () => setState(() => _showAuth = !_showAuth),
            ),
            if (_showAuth) ...[
              TextFormField(
                controller: _apiKeyCtrl,
                decoration: const InputDecoration(
                  labelText: 'API Key',
                  border: OutlineInputBorder(),
                ),
                obscureText: true,
              ),
              const SizedBox(height: 8),
              TextFormField(
                controller: _bearerCtrl,
                decoration: const InputDecoration(
                  labelText: 'Bearer Token (alternative)',
                  border: OutlineInputBorder(),
                ),
                obscureText: true,
              ),
            ],
            const SizedBox(height: 16),

            // ── Optional metadata ──
            _SectionHeader('Optional'),
            TextFormField(
              controller: _idCtrl,
              decoration: const InputDecoration(
                labelText: 'Custom ID',
                helperText: 'Auto-generated from provider + model if blank',
                border: OutlineInputBorder(),
              ),
              enabled: !_isEditing,
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: _tagsCtrl,
              decoration: const InputDecoration(
                labelText: 'Tags (comma-separated)',
                hintText: 'local, fast, vision',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: _descCtrl,
              decoration: const InputDecoration(
                labelText: 'Description',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
            ),
            const SizedBox(height: 32),

            ElevatedButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.save_outlined),
              label: Text(_isEditing ? 'Update Model' : 'Add Model'),
              style: ElevatedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _roleLabel(String r) {
    const labels = {
      'master': 'Master (primary orchestration)',
      'general': 'General purpose',
      'vision': 'Vision (image / video)',
      'audio': 'Audio specialist',
      'code': 'Code generation',
      'reasoning': 'Deep reasoning',
      'fast': 'Fast (short tasks, summaries)',
      'embedding': 'Embeddings',
    };
    return labels[r] ?? r;
  }
}

// ── Small reusable widgets ────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(title,
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(fontWeight: FontWeight.bold, color: Colors.grey[700])),
      );
}

class _ProviderChip extends StatelessWidget {
  final String provider;
  const _ProviderChip({required this.provider});

  static const _colors = {
    'ollama':    Color(0xFF4CAF50),
    'lmstudio':  Color(0xFF9C27B0),
    'openai':    Color(0xFF10A37F),
    'anthropic': Color(0xFFD97706),
    'google':    Color(0xFF4285F4),
    'mistral':   Color(0xFFEF4444),
    'deepseek':  Color(0xFF0EA5E9),
    'custom':    Color(0xFF6B7280),
  };

  @override
  Widget build(BuildContext context) {
    final color = _colors[provider] ?? const Color(0xFF6B7280);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(color: color.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
      child: Text(provider, style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w600)),
    );
  }
}

class _RoleChip extends StatelessWidget {
  final String role;
  const _RoleChip({required this.role});

  @override
  Widget build(BuildContext context) {
    final isMaster = role == 'master';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: isMaster
            ? Theme.of(context).colorScheme.primary.withOpacity(0.12)
            : Colors.grey.shade100,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: isMaster ? Theme.of(context).colorScheme.primary.withOpacity(0.4) : Colors.grey.shade300,
        ),
      ),
      child: Text(
        role,
        style: TextStyle(
          fontSize: 11,
          color: isMaster ? Theme.of(context).colorScheme.primary : Colors.grey[700],
          fontWeight: isMaster ? FontWeight.bold : FontWeight.normal,
        ),
      ),
    );
  }
}

class _CapBadge extends StatelessWidget {
  final String label;
  const _CapBadge({required this.label});

  static const _icons = {
    'Vision': Icons.visibility_outlined,
    'Audio': Icons.mic_none,
    'Video': Icons.videocam_outlined,
    'Tools': Icons.build_outlined,
    'Reasoning': Icons.psychology_outlined,
    'Code': Icons.code,
    'Embed': Icons.hub_outlined,
    'Long ctx': Icons.article_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final icon = _icons[label];
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.teal.withOpacity(0.1),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: Colors.teal.withOpacity(0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 10, color: Colors.teal[700]),
            const SizedBox(width: 3),
          ],
          Text(label, style: TextStyle(fontSize: 10, color: Colors.teal[700])),
        ],
      ),
    );
  }
}

class _ActionBtn extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onPressed;
  final Color? color;

  const _ActionBtn({required this.icon, required this.label, required this.onPressed, this.color});

  @override
  Widget build(BuildContext context) => TextButton.icon(
        onPressed: onPressed,
        icon: Icon(icon, size: 16, color: color),
        label: Text(label, style: TextStyle(fontSize: 12, color: color)),
        style: TextButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          minimumSize: Size.zero,
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
      );
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 48, color: Colors.red),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      );
}

class _EmptyView extends StatelessWidget {
  const _EmptyView();

  @override
  Widget build(BuildContext context) => const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.smart_toy_outlined, size: 64, color: Colors.grey),
            SizedBox(height: 16),
            Text('No models configured yet.',
                style: TextStyle(color: Colors.grey, fontSize: 16)),
            SizedBox(height: 8),
            Text('Tap + to add your first model.',
                style: TextStyle(color: Colors.grey)),
          ],
        ),
      );
}
