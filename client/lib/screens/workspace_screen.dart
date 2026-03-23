import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;
import '../providers/app_state.dart';

class WorkspaceScreen extends StatefulWidget {
  const WorkspaceScreen({Key? key}) : super(key: key);
  @override
  State<WorkspaceScreen> createState() => _WorkspaceScreenState();
}

class _WorkspaceScreenState extends State<WorkspaceScreen> {
  bool _loading = true;
  Map<String, List<dynamic>> _categories = {};
  String? _error;

  static const _categoryConfig = {
    'data':   {'label': 'Data Files',      'icon': Icons.storage_rounded,        'color': Color(0xFF3B82F6)},
    'media':  {'label': 'Media & Reports', 'icon': Icons.perm_media_rounded,      'color': Color(0xFF10B981)},
    'chats':  {'label': 'Chat History',    'icon': Icons.chat_bubble_outline,     'color': Color(0xFF8B5CF6)},
    'skills': {'label': 'Skill Packages',  'icon': Icons.code_rounded,            'color': Color(0xFFF59E0B)},
    'other':  {'label': 'Other Files',     'icon': Icons.folder_outlined,         'color': Color(0xFF6B7280)},
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final base = Provider.of<AppState>(context, listen: false).serverUrl;
      final resp = await http.get(Uri.parse('$base/workspace/files'));
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body) as Map<String, dynamic>;
        setState(() {
          _categories = data.map((k, v) => MapEntry(k, List<dynamic>.from(v)));
          _loading = false;
        });
      } else {
        setState(() { _error = 'Server returned ${resp.statusCode}'; _loading = false; });
      }
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _deleteFile(String name) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Delete File?', style: TextStyle(fontWeight: FontWeight.bold)),
        content: Text('Are you sure you want to delete "$name"? This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white, elevation: 0),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final base = Provider.of<AppState>(context, listen: false).serverUrl;
      await http.delete(Uri.parse('$base/workspace/files/${Uri.encodeComponent(name)}'));
      _load();
    } catch (_) {}
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F8),
      appBar: AppBar(
        title: const Text('Workspace', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
        centerTitle: true,
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: Colors.grey.shade200, height: 1),
        ),
        actions: [
          IconButton(icon: const Icon(Icons.refresh_rounded), tooltip: 'Refresh', onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.error_outline, size: 48, color: Colors.red.shade400),
                      const SizedBox(height: 12),
                      Text(_error!, style: const TextStyle(color: Colors.red)),
                      const SizedBox(height: 16),
                      ElevatedButton(onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  children: _categoryConfig.entries.map((entry) {
                    final key = entry.key;
                    final conf = entry.value;
                    final files = _categories[key] ?? [];
                    if (files.isEmpty) return const SizedBox.shrink();

                    final color = conf['color'] as Color;
                    final icon = conf['icon'] as IconData;
                    final label = conf['label'] as String;

                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(left: 4, bottom: 8, top: 16),
                          child: Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(6),
                                decoration: BoxDecoration(
                                  color: color.withOpacity(0.12),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Icon(icon, size: 16, color: color),
                              ),
                              const SizedBox(width: 10),
                              Text(
                                label.toUpperCase(),
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.grey.shade600,
                                  letterSpacing: 0.7,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                decoration: BoxDecoration(
                                  color: color.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Text('${files.length}', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: color)),
                              ),
                            ],
                          ),
                        ),
                        Container(
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: Colors.grey.shade200),
                          ),
                          child: Column(
                            children: files.asMap().entries.map((e) {
                              final i = e.key;
                              final f = e.value as Map<String, dynamic>;
                              final isDir = f['isDir'] == true;
                              return Column(
                                children: [
                                  ListTile(
                                    leading: Container(
                                      width: 36, height: 36,
                                      decoration: BoxDecoration(
                                        color: color.withOpacity(0.08),
                                        borderRadius: BorderRadius.circular(8),
                                      ),
                                      child: Icon(
                                        isDir ? Icons.folder_rounded : _fileIcon(f['name'] as String),
                                        size: 18, color: color,
                                      ),
                                    ),
                                    title: Text(
                                      f['name'] as String,
                                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
                                    ),
                                    subtitle: isDir
                                        ? const Text('Directory', style: TextStyle(fontSize: 12, color: Colors.grey))
                                        : Text(
                                            _formatSize(f['sizeBytes'] as int),
                                            style: const TextStyle(fontSize: 12, color: Colors.grey),
                                          ),
                                    trailing: isDir
                                        ? Icon(Icons.chevron_right, color: Colors.grey.shade400)
                                        : IconButton(
                                            icon: Icon(Icons.delete_outline, size: 18, color: Colors.red.shade300),
                                            tooltip: 'Delete',
                                            onPressed: () => _deleteFile(f['name'] as String),
                                          ),
                                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                                  ),
                                  if (i < files.length - 1)
                                    Divider(height: 1, thickness: 1, indent: 56, color: Colors.grey.shade100),
                                ],
                              );
                            }).toList(),
                          ),
                        ),
                      ],
                    );
                  }).toList(),
                ),
    );
  }

  IconData _fileIcon(String name) {
    final ext = name.split('.').last.toLowerCase();
    switch (ext) {
      case 'json': return Icons.data_object_rounded;
      case 'md': return Icons.article_outlined;
      case 'png': case 'jpg': case 'jpeg': return Icons.image_rounded;
      case 'mp4': return Icons.video_file_rounded;
      default: return Icons.insert_drive_file_outlined;
    }
  }
}
