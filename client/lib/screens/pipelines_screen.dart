import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart';

class PipelinesScreen extends StatefulWidget {
  const PipelinesScreen({Key? key}) : super(key: key);
  @override
  State<PipelinesScreen> createState() => _PipelinesScreenState();
}

class _PipelinesScreenState extends State<PipelinesScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Map<String, dynamic>> _pipelines = [];
  List<Map<String, dynamic>> _history = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    final api = Provider.of<AppState>(context, listen: false).apiService;
    final pipelines = await api.getPipelines();
    final history = await api.getPipelineHistory();
    if (mounted) {
      setState(() {
        _pipelines = pipelines;
        _history = history;
        _loading = false;
      });
    }
  }

  Future<void> _deletePipeline(String id) async {
    final api = Provider.of<AppState>(context, listen: false).apiService;
    await api.deletePipeline(id);
    _loadData();
  }

  Future<void> _togglePipeline(String id) async {
    final api = Provider.of<AppState>(context, listen: false).apiService;
    await api.togglePipeline(id);
    _loadData();
  }

  Future<void> _runPipeline(String id) async {
    final api = Provider.of<AppState>(context, listen: false).apiService;
    if (mounted) setState(() => _loading = true);
    await api.runPipelineNow(id);
    await _loadData();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Pipeline executed!')));
    }
  }

  String _formatDate(dynamic ms) {
    if (ms == null) return 'N/A';
    try {
      final d = DateTime.fromMillisecondsSinceEpoch((ms as num).toInt());
      return '${d.day}/${d.month} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
    } catch (_) { return 'N/A'; }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Pipelines & Jobs', style: TextStyle(fontWeight: FontWeight.w600)),
        backgroundColor: Colors.white, foregroundColor: Colors.black87, elevation: 0,
        bottom: TabBar(
          controller: _tabController,
          labelColor: Colors.blueAccent,
          unselectedLabelColor: Colors.black54,
          indicatorColor: Colors.blueAccent,
          tabs: const [Tab(text: 'Active Pipelines'), Tab(text: 'Job History')],
        ),
      ),
      backgroundColor: const Color(0xFFF5F5F5),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : TabBarView(
            controller: _tabController,
            children: [_buildPipelinesList(), _buildHistoryList()],
          ),
    );
  }

  Widget _buildPipelinesList() {
    if (_pipelines.isEmpty) {
      return const Center(child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.auto_awesome, size: 48, color: Colors.grey),
          SizedBox(height: 12),
          Text('No pipelines yet', style: TextStyle(fontSize: 16, color: Colors.grey)),
          SizedBox(height: 4),
          Text('Ask the AI to create one!', style: TextStyle(fontSize: 13, color: Colors.black45)),
        ],
      ));
    }
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _pipelines.length,
        itemBuilder: (context, index) {
          final p = _pipelines[index];
          final enabled = p['enabled'] == true;
          final steps = (p['steps'] as List?)?.map((s) => s['type'].toString()).join(' → ') ?? '';
          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Icon(enabled ? Icons.play_circle : Icons.pause_circle, color: enabled ? Colors.green : Colors.orange, size: 22),
                  const SizedBox(width: 8),
                  Expanded(child: Text(p['name'] ?? 'Unnamed', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16))),
                  PopupMenuButton<String>(
                    onSelected: (v) {
                      if (v == 'delete') _deletePipeline(p['id']);
                      if (v == 'toggle') _togglePipeline(p['id']);
                      if (v == 'run') _runPipeline(p['id']);
                    },
                    itemBuilder: (_) => [
                      PopupMenuItem(value: 'run', child: Row(children: [Icon(Icons.play_arrow, size: 18, color: Colors.blue), SizedBox(width: 8), Text('Run Now')])),
                      PopupMenuItem(value: 'toggle', child: Row(children: [Icon(enabled ? Icons.pause : Icons.play_arrow, size: 18), SizedBox(width: 8), Text(enabled ? 'Disable' : 'Enable')])),
                      PopupMenuItem(value: 'delete', child: Row(children: [Icon(Icons.delete, size: 18, color: Colors.red), SizedBox(width: 8), Text('Delete', style: TextStyle(color: Colors.red))])),
                    ],
                  ),
                ]),
                const SizedBox(height: 8),
                Text(steps, style: const TextStyle(fontSize: 13, color: Colors.blueAccent, fontFamily: 'monospace')),
                const SizedBox(height: 6),
                Row(children: [
                  const Icon(Icons.schedule, size: 14, color: Colors.black45),
                  const SizedBox(width: 4),
                  Text(p['schedule'] ?? 'Manual', style: const TextStyle(fontSize: 12, color: Colors.black54)),
                  const Spacer(),
                  Text('Next: ${_formatDate(p['nextRun'])}', style: const TextStyle(fontSize: 12, color: Colors.black45)),
                ]),
              ]),
            ),
          );
        },
      ),
    );
  }

  Widget _buildHistoryList() {
    if (_history.isEmpty) {
      return const Center(child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.history, size: 48, color: Colors.grey),
          SizedBox(height: 12),
          Text('No job history yet', style: TextStyle(fontSize: 16, color: Colors.grey)),
        ],
      ));
    }
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _history.length,
        itemBuilder: (context, index) {
          final h = _history[index];
          final success = h['success'] == true;
          final steps = (h['stepResults'] as List?)
            ?.map((s) => '${s['success'] == true ? '✅' : '❌'} ${s['type']}')
            .join('\n') ?? '';
          return Card(
            margin: const EdgeInsets.only(bottom: 10),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            child: ExpansionTile(
              leading: Icon(success ? Icons.check_circle : Icons.error, color: success ? Colors.green : Colors.red),
              title: Text(h['pipelineName'] ?? 'Unknown', style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(_formatDate(h['ranAt']), style: const TextStyle(fontSize: 12, color: Colors.black45)),
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Align(alignment: Alignment.centerLeft, child: Text(steps, style: const TextStyle(fontSize: 13))),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
