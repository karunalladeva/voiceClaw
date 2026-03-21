import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart';

class MemoryScreen extends StatefulWidget {
  const MemoryScreen({Key? key}) : super(key: key);

  @override
  State<MemoryScreen> createState() => _MemoryScreenState();
}

class _MemoryScreenState extends State<MemoryScreen> {
  List<dynamic> _memories = [];
  bool _loading = true;
  bool _memoryAvailable = false;
  bool _memoryEnabled = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = Provider.of<AppState>(context, listen: false).apiService;
      final status = await api.getMemoryStatus();
      final memories = await api.listMemories();
      setState(() {
        _memoryAvailable = status['available'] == true;
        _memoryEnabled = status['enabled'] == true;
        _memories = memories;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _addMemory() async {
    final contentCtrl = TextEditingController();
    final tagsCtrl = TextEditingController();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add Memory'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: contentCtrl,
              decoration: const InputDecoration(labelText: 'Content'),
              maxLines: 3,
              autofocus: true,
            ),
            const SizedBox(height: 8),
            TextField(
              controller: tagsCtrl,
              decoration: const InputDecoration(
                labelText: 'Tags (comma-separated)',
                hintText: 'user_name, preference, fact',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    final content = contentCtrl.text.trim();
    if (content.isEmpty) return;

    final tags = tagsCtrl.text
        .split(',')
        .map((t) => t.trim())
        .where((t) => t.isNotEmpty)
        .toList();

    try {
      final api = Provider.of<AppState>(context, listen: false).apiService;
      await api.addMemory(content, tags);
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
      }
    }
  }

  Future<void> _deleteMemory(String id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Memory'),
        content: const Text('Remove this memory permanently?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      final api = Provider.of<AppState>(context, listen: false).apiService;
      await api.deleteMemory(id);
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Long-Term Memory'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load, tooltip: 'Refresh'),
        ],
      ),
      floatingActionButton: (_memoryAvailable && _memoryEnabled)
          ? FloatingActionButton(
              onPressed: _addMemory,
              tooltip: 'Add Memory',
              child: const Icon(Icons.add),
            )
          : null,
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 48, color: Colors.red),
            const SizedBox(height: 12),
            Text(_error!, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }

    return Column(
      children: [
        _StatusBanner(available: _memoryAvailable, enabled: _memoryEnabled),
        if (!_memoryAvailable || !_memoryEnabled)
          const Expanded(
            child: Center(
              child: Text(
                'Memory is unavailable or disabled.\nEnable it in Settings.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey),
              ),
            ),
          )
        else if (_memories.isEmpty)
          const Expanded(
            child: Center(
              child: Text(
                'No memories stored yet.\nTap + to add one.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey),
              ),
            ),
          )
        else
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: _memories.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final m = _memories[index];
                final tags = (m['tags'] as List?)?.cast<String>() ?? [];
                final ts = m['timestamp'] as String? ?? '';
                final date = ts.isNotEmpty
                    ? DateTime.tryParse(ts)?.toLocal().toString().substring(0, 16) ?? ts
                    : '';

                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                m['content'] ?? '',
                                style: const TextStyle(fontSize: 14),
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.delete_outline, color: Colors.red),
                              onPressed: () => _deleteMemory(m['id'].toString()),
                              tooltip: 'Delete',
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(),
                            ),
                          ],
                        ),
                        if (tags.isNotEmpty) ...[
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 6,
                            children: tags.map((t) => Chip(
                              label: Text(t, style: const TextStyle(fontSize: 11)),
                              padding: EdgeInsets.zero,
                              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            )).toList(),
                          ),
                        ],
                        if (date.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(date, style: TextStyle(fontSize: 11, color: Colors.grey[500])),
                        ],
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
      ],
    );
  }
}

class _StatusBanner extends StatelessWidget {
  final bool available;
  final bool enabled;

  const _StatusBanner({required this.available, required this.enabled});

  @override
  Widget build(BuildContext context) {
    final Color color;
    final String label;
    final IconData icon;

    if (!available) {
      color = Colors.red.shade50;
      icon = Icons.cloud_off;
      label = 'Memory MCP server unreachable';
    } else if (!enabled) {
      color = Colors.orange.shade50;
      icon = Icons.toggle_off_outlined;
      label = 'Memory disabled — enable in Settings';
    } else {
      color = Colors.green.shade50;
      icon = Icons.check_circle_outline;
      label = 'Memory connected and active';
    }

    return Container(
      color: color,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: [
          Icon(icon, size: 18, color: Colors.grey[700]),
          const SizedBox(width: 8),
          Text(label, style: TextStyle(fontSize: 13, color: Colors.grey[700])),
        ],
      ),
    );
  }
}
