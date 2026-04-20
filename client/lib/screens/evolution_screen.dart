import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart';

/// Evolution Pipeline screen — Dashboard, Review Queue, and Model Versions.
class EvolutionScreen extends StatefulWidget {
  const EvolutionScreen({Key? key}) : super(key: key);

  @override
  State<EvolutionScreen> createState() => _EvolutionScreenState();
}

class _EvolutionScreenState extends State<EvolutionScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  // Dashboard state
  Map<String, dynamic> _stats = {};
  Map<String, dynamic> _vram = {};
  bool _isHarvesting = false;
  bool _isTraining = false;
  Timer? _pollTimer;

  // Review queue state
  List<Map<String, dynamic>> _queue = [];
  int _queueTotal = 0;
  int _queuePage = 1;
  bool _isLoadingQueue = false;
  final Set<String> _selectedIds = {};

  // Models state
  List<Map<String, dynamic>> _evolvedModels = [];
  bool _isLoadingModels = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _tabController.addListener(() {
      if (_tabController.indexIsChanging) return;
      if (_tabController.index == 0) _loadDashboard();
      if (_tabController.index == 1) _loadQueue();
      if (_tabController.index == 2) _loadModels();
    });
    _loadDashboard();

    // Poll for training status every 5s
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted && _isTraining) _loadDashboard();
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadDashboard() async {
    final api = Provider.of<AppState>(context, listen: false).apiService;
    final stats = await api.getEvolutionStats();
    final vram = await api.getVramStatus();
    if (mounted) {
      setState(() {
        _stats = stats;
        _vram = vram;
        _isTraining = stats['currentTraining'] != null &&
            stats['currentTraining']['status'] == 'running';
      });
    }
  }

  Future<void> _loadQueue() async {
    if (_isLoadingQueue) return;
    setState(() => _isLoadingQueue = true);
    try {
      final api = Provider.of<AppState>(context, listen: false).apiService;
      final result = await api.getReviewQueue(page: _queuePage, limit: 20);
      if (mounted) {
        setState(() {
          _queue = List<Map<String, dynamic>>.from(result['samples'] ?? []);
          _queueTotal = (result['total'] as num?)?.toInt() ?? 0;
          _selectedIds.clear();
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to load queue: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoadingQueue = false);
    }
  }

  Future<void> _loadModels() async {
    setState(() => _isLoadingModels = true);
    try {
      final api = Provider.of<AppState>(context, listen: false).apiService;
      final models = await api.listEvolvedModels();
      if (mounted) setState(() => _evolvedModels = models);
    } catch (_) {}
    if (mounted) setState(() => _isLoadingModels = false);
  }

  Future<void> _harvest() async {
    setState(() => _isHarvesting = true);
    try {
      final api = Provider.of<AppState>(context, listen: false).apiService;
      final result = await api.harvestWorkspace();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(
            '✅ Harvest complete: ${result['newPairs']} new pairs, ${result['skipped']} skipped',
          ),
        ));
        _loadDashboard();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Harvest failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isHarvesting = false);
    }
  }

  Future<void> _startTraining() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Start Training'),
        content: const Text(
          'This will start QLoRA fine-tuning on your GPU. '
          'Training may take 5-30 minutes depending on sample count.\n\n'
          'Ensure no heavy GPU workloads are running.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.deepPurple),
            child: const Text('Start Training', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      final api = Provider.of<AppState>(context, listen: false).apiService;
      await api.startTraining();
      if (mounted) {
        setState(() => _isTraining = true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('🚀 Training started!')),
        );
        _loadDashboard();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Training failed: $e')),
        );
      }
    }
  }

  Future<void> _approveSample(String id) async {
    final api = Provider.of<AppState>(context, listen: false).apiService;
    await api.approveSample(id);
    _loadQueue();
    _loadDashboard();
  }

  Future<void> _rejectSample(String id) async {
    final api = Provider.of<AppState>(context, listen: false).apiService;
    await api.rejectSample(id);
    _loadQueue();
    _loadDashboard();
  }

  Future<void> _batchApprove() async {
    if (_selectedIds.isEmpty) return;
    final api = Provider.of<AppState>(context, listen: false).apiService;
    await api.batchApproveSamples(_selectedIds.toList());
    _loadQueue();
    _loadDashboard();
  }

  Future<void> _batchReject() async {
    if (_selectedIds.isEmpty) return;
    final api = Provider.of<AppState>(context, listen: false).apiService;
    await api.batchRejectSamples(_selectedIds.toList());
    _loadQueue();
    _loadDashboard();
  }

  Future<void> _activateModel(String version) async {
    final api = Provider.of<AppState>(context, listen: false).apiService;
    final ok = await api.activateEvolvedModel(version);
    if (ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('✅ Model $version activated')),
      );
      _loadModels();
    }
  }

  Future<void> _rollback() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Rollback to Base Model'),
        content: const Text(
          'This will switch the master model back to the original base model. '
          'Your evolved models are preserved and can be re-activated later.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.orange),
            child: const Text('Rollback', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    final api = Provider.of<AppState>(context, listen: false).apiService;
    final ok = await api.rollbackToBase();
    if (ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('✅ Rolled back to base model')),
      );
      _loadModels();
    }
  }

  Future<void> _resetHarvest() async {
    final choice = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reset Harvest Data'),
        content: const Text(
          'Choose how to reset:\n\n'
          '• Full Reset — Clears everything (pending, approved, rejected) '
          'and re-scans all files on next harvest.\n\n'
          '• Clean Reset — Clears pending & rejected but keeps your '
          'approved samples for training.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, null),
            child: const Text('Cancel'),
          ),
          OutlinedButton(
            onPressed: () => Navigator.pop(ctx, 'clean'),
            style: OutlinedButton.styleFrom(foregroundColor: Colors.orange),
            child: const Text('Clean Reset'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, 'full'),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Full Reset', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
    if (choice == null) return;

    final api = Provider.of<AppState>(context, listen: false).apiService;
    final keepVerified = choice == 'clean';
    final ok = await api.resetHarvest(keepVerified: keepVerified);
    if (ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(keepVerified
            ? '✅ Clean reset done — approved samples preserved'
            : '✅ Full reset done — all data cleared'),
      ));
      _loadDashboard();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD
  // ═══════════════════════════════════════════════════════════════════════════

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAFAFA),
      appBar: AppBar(
        title: const Text('Evolution Pipeline',
            style: TextStyle(fontWeight: FontWeight.w700)),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 0,
        bottom: TabBar(
          controller: _tabController,
          labelColor: Colors.deepPurple,
          unselectedLabelColor: Colors.grey,
          indicatorColor: Colors.deepPurple,
          tabs: const [
            Tab(icon: Icon(Icons.dashboard_outlined), text: 'Dashboard'),
            Tab(icon: Icon(Icons.rate_review_outlined), text: 'Review Queue'),
            Tab(icon: Icon(Icons.model_training), text: 'Models'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildDashboard(),
          _buildReviewQueue(),
          _buildModelsTab(),
        ],
      ),
    );
  }

  // ── Tab 1: Dashboard ─────────────────────────────────────────────────────

  Widget _buildDashboard() {
    final approved = (_stats['approved'] as num?)?.toInt() ?? 0;
    final minSamples = (_stats['minSamples'] as num?)?.toInt() ?? 100;
    final progress = minSamples > 0 ? (approved / minSamples).clamp(0.0, 1.0) : 0.0;
    final trainUnlocked = _stats['trainUnlocked'] == true;
    final vramSafe = _vram['safe'] == true;
    final vramUsed = (_vram['usedMB'] as num?)?.toInt() ?? 0;
    final vramThreshold = (_vram['thresholdMB'] as num?)?.toInt() ?? 2048;
    final vramRatio = vramThreshold > 0 ? (vramUsed / vramThreshold).clamp(0.0, 1.0) : 0.0;

    return RefreshIndicator(
      onRefresh: _loadDashboard,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Stats cards row
          Row(
            children: [
              _statCard('Harvested', '${_stats['totalHarvested'] ?? 0}',
                  Icons.agriculture, Colors.green),
              const SizedBox(width: 12),
              _statCard('Pending', '${_stats['pendingReview'] ?? 0}',
                  Icons.pending_actions, Colors.orange),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _statCard('Approved', '$approved',
                  Icons.check_circle_outline, Colors.blue),
              const SizedBox(width: 12),
              _statCard('Rejected', '${_stats['rejected'] ?? 0}',
                  Icons.cancel_outlined, Colors.red),
            ],
          ),
          const SizedBox(height: 20),

          // Progress toward training unlock
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(color: Colors.grey.shade200),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Training Unlock Progress',
                          style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                      Text('$approved / $minSamples',
                          style: TextStyle(
                            color: trainUnlocked ? Colors.green : Colors.orange,
                            fontWeight: FontWeight.bold,
                          )),
                    ],
                  ),
                  const SizedBox(height: 10),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: LinearProgressIndicator(
                      value: progress,
                      minHeight: 10,
                      backgroundColor: Colors.grey.shade200,
                      valueColor: AlwaysStoppedAnimation(
                        trainUnlocked ? Colors.green : Colors.deepPurple,
                      ),
                    ),
                  ),
                  if (trainUnlocked)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text('✅ Training unlocked!',
                          style: TextStyle(color: Colors.green, fontWeight: FontWeight.w600)),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // VRAM Gauge
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(color: Colors.grey.shade200),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('VRAM Guard',
                          style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                      Row(
                        children: [
                          Icon(
                            vramSafe ? Icons.shield_outlined : Icons.warning_amber,
                            size: 16,
                            color: vramSafe ? Colors.green : Colors.red,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            vramSafe ? 'Safe' : 'Busy',
                            style: TextStyle(
                              color: vramSafe ? Colors.green : Colors.red,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: LinearProgressIndicator(
                      value: vramRatio,
                      minHeight: 10,
                      backgroundColor: Colors.grey.shade200,
                      valueColor: AlwaysStoppedAnimation(
                        vramSafe ? Colors.teal : Colors.red,
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text('$vramUsed MB / $vramThreshold MB threshold',
                      style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Training status
          if (_isTraining)
            Card(
              elevation: 0,
              color: Colors.deepPurple.shade50,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    const SizedBox(
                      width: 20, height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.deepPurple),
                    ),
                    const SizedBox(width: 12),
                    const Expanded(
                      child: Text('Training in progress...',
                          style: TextStyle(fontWeight: FontWeight.w600, color: Colors.deepPurple)),
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 20),

          // Action buttons
          Row(
            children: [
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: _isHarvesting ? null : _harvest,
                  icon: _isHarvesting
                      ? const SizedBox(width: 16, height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.agriculture),
                  label: Text(_isHarvesting ? 'Harvesting...' : 'Harvest Now'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    backgroundColor: Colors.teal,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: (trainUnlocked && vramSafe && !_isTraining) ? _startTraining : null,
                  icon: const Icon(Icons.rocket_launch),
                  label: const Text('Train Model'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    backgroundColor: Colors.deepPurple,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    disabledBackgroundColor: Colors.grey.shade300,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // Reset button
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _resetHarvest,
              icon: const Icon(Icons.cleaning_services_outlined, size: 18),
              label: const Text('Reset Harvest Data'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 12),
                foregroundColor: Colors.red.shade400,
                side: BorderSide(color: Colors.red.shade200),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),

          if (_stats['lastHarvestAt'] != null) ...[
            const SizedBox(height: 16),
            Text(
              'Last harvest: ${_stats['lastHarvestAt']}',
              style: TextStyle(color: Colors.grey.shade500, fontSize: 12),
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }

  Widget _statCard(String label, String value, IconData icon, Color color) {
    return Expanded(
      child: Card(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: Colors.grey.shade200),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 40, height: 40,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: color, size: 22),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(value,
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                  Text(label,
                      style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Tab 2: Review Queue ──────────────────────────────────────────────────

  Widget _buildReviewQueue() {
    if (_queue.isEmpty && !_isLoadingQueue) {
      // First load
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadQueue());
    }

    return Column(
      children: [
        // Batch actions bar
        if (_selectedIds.isNotEmpty)
          Container(
            color: Colors.deepPurple.shade50,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Text('${_selectedIds.length} selected',
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                const Spacer(),
                TextButton.icon(
                  onPressed: _batchApprove,
                  icon: const Icon(Icons.check_circle, color: Colors.green, size: 18),
                  label: const Text('Approve All', style: TextStyle(color: Colors.green)),
                ),
                const SizedBox(width: 8),
                TextButton.icon(
                  onPressed: _batchReject,
                  icon: const Icon(Icons.cancel, color: Colors.red, size: 18),
                  label: const Text('Reject All', style: TextStyle(color: Colors.red)),
                ),
              ],
            ),
          ),

        // Queue info
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('$_queueTotal pending samples',
                  style: TextStyle(color: Colors.grey.shade600)),
              Row(
                children: [
                  if (_queuePage > 1)
                    IconButton(
                      icon: const Icon(Icons.chevron_left),
                      onPressed: () { _queuePage--; _loadQueue(); },
                    ),
                  Text('Page $_queuePage'),
                  if (_queueTotal > _queuePage * 20)
                    IconButton(
                      icon: const Icon(Icons.chevron_right),
                      onPressed: () { _queuePage++; _loadQueue(); },
                    ),
                ],
              ),
            ],
          ),
        ),

        if (_isLoadingQueue)
          const Expanded(child: Center(child: CircularProgressIndicator()))
        else if (_queue.isEmpty)
          Expanded(
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.inbox_outlined, size: 48, color: Colors.grey.shade400),
                  const SizedBox(height: 12),
                  Text('No samples pending review',
                      style: TextStyle(color: Colors.grey.shade500)),
                  const SizedBox(height: 8),
                  ElevatedButton.icon(
                    onPressed: _harvest,
                    icon: const Icon(Icons.agriculture, size: 18),
                    label: const Text('Harvest Workspace'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.teal,
                      foregroundColor: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
          )
        else
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: _queue.length,
              itemBuilder: (context, index) {
                final sample = _queue[index];
                final id = sample['id'] as String? ?? '';
                final isSelected = _selectedIds.contains(id);
                final redactions = (sample['piiRedactions'] as num?)?.toInt() ?? 0;

                return Card(
                  elevation: 0,
                  margin: const EdgeInsets.symmetric(vertical: 4),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                    side: BorderSide(
                      color: isSelected ? Colors.deepPurple : Colors.grey.shade200,
                      width: isSelected ? 2 : 1,
                    ),
                  ),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(10),
                    onLongPress: () {
                      setState(() {
                        if (isSelected) {
                          _selectedIds.remove(id);
                        } else {
                          _selectedIds.add(id);
                        }
                      });
                    },
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Source file badge
                          Row(
                            children: [
                              if (isSelected)
                                Padding(
                                  padding: const EdgeInsets.only(right: 8),
                                  child: Icon(Icons.check_box,
                                      color: Colors.deepPurple, size: 18),
                                ),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: Colors.grey.shade100,
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: Text(
                                  sample['sourceFile'] ?? 'unknown',
                                  style: TextStyle(
                                    fontSize: 11,
                                    color: Colors.grey.shade600,
                                    fontFamily: 'monospace',
                                  ),
                                ),
                              ),
                              if (redactions > 0) ...[
                                const SizedBox(width: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: Colors.amber.shade50,
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    '$redactions PII redacted',
                                    style: TextStyle(
                                        fontSize: 11, color: Colors.amber.shade800),
                                  ),
                                ),
                              ],
                            ],
                          ),
                          const SizedBox(height: 10),

                          // Instruction
                          const Text('Instruction:',
                              style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 12,
                                  color: Colors.deepPurple)),
                          const SizedBox(height: 4),
                          Text(
                            sample['instruction'] ?? '',
                            style: const TextStyle(fontSize: 13),
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 10),

                          // Output
                          const Text('Output:',
                              style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 12,
                                  color: Colors.teal)),
                          const SizedBox(height: 4),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: Colors.grey.shade50,
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              sample['output'] ?? '',
                              style: const TextStyle(
                                  fontSize: 12, fontFamily: 'monospace'),
                              maxLines: 6,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(height: 10),

                          // Actions
                          Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              OutlinedButton.icon(
                                onPressed: () => _rejectSample(id),
                                icon: const Icon(Icons.close, size: 16),
                                label: const Text('Reject'),
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: Colors.red,
                                  side: const BorderSide(color: Colors.red),
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 12, vertical: 6),
                                ),
                              ),
                              const SizedBox(width: 8),
                              ElevatedButton.icon(
                                onPressed: () => _approveSample(id),
                                icon: const Icon(Icons.check, size: 16),
                                label: const Text('Approve'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.green,
                                  foregroundColor: Colors.white,
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 12, vertical: 6),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
      ],
    );
  }

  // ── Tab 3: Model Versions ────────────────────────────────────────────────

  Widget _buildModelsTab() {
    if (_evolvedModels.isEmpty && !_isLoadingModels) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadModels());
    }

    return Column(
      children: [
        // Rollback button
        Padding(
          padding: const EdgeInsets.all(16),
          child: SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _rollback,
              icon: const Icon(Icons.restore, color: Colors.orange),
              label: const Text('Rollback to Base Model',
                  style: TextStyle(color: Colors.orange)),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                side: const BorderSide(color: Colors.orange),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
        ),

        if (_isLoadingModels)
          const Expanded(child: Center(child: CircularProgressIndicator()))
        else if (_evolvedModels.isEmpty)
          Expanded(
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.model_training, size: 48, color: Colors.grey.shade400),
                  const SizedBox(height: 12),
                  Text('No evolved models yet',
                      style: TextStyle(color: Colors.grey.shade500)),
                  const SizedBox(height: 4),
                  Text('Train your first model from the Dashboard tab',
                      style: TextStyle(color: Colors.grey.shade400, fontSize: 12)),
                ],
              ),
            ),
          )
        else
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: _evolvedModels.length,
              itemBuilder: (context, index) {
                final model = _evolvedModels[index];
                final isActive = model['active'] == true;

                return Card(
                  elevation: 0,
                  margin: const EdgeInsets.only(bottom: 8),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: BorderSide(
                      color: isActive ? Colors.green : Colors.grey.shade200,
                      width: isActive ? 2 : 1,
                    ),
                  ),
                  child: ListTile(
                    contentPadding: const EdgeInsets.all(12),
                    leading: Container(
                      width: 40, height: 40,
                      decoration: BoxDecoration(
                        color: isActive
                            ? Colors.green.shade50
                            : Colors.deepPurple.shade50,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(
                        isActive ? Icons.check_circle : Icons.model_training,
                        color: isActive ? Colors.green : Colors.deepPurple,
                      ),
                    ),
                    title: Text(
                      model['version'] ?? 'unknown',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SizedBox(height: 4),
                        Text('Base: ${model['baseModel'] ?? '?'}',
                            style: const TextStyle(fontSize: 12)),
                        Text(
                          '${model['samplesUsed'] ?? 0} samples · ${model['steps'] ?? 0} steps'
                          '${model['finalLoss'] != null ? ' · Loss: ${(model['finalLoss'] as num).toStringAsFixed(4)}' : ''}',
                          style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
                        ),
                        Text('Trained: ${model['trainedAt'] ?? '?'}',
                            style: TextStyle(fontSize: 11, color: Colors.grey.shade500)),
                      ],
                    ),
                    trailing: isActive
                        ? const Chip(
                            label: Text('Active',
                                style: TextStyle(
                                    color: Colors.green, fontSize: 11)),
                            backgroundColor: Color(0xFFE8F5E9),
                            side: BorderSide.none,
                            padding: EdgeInsets.zero,
                          )
                        : ElevatedButton(
                            onPressed: () =>
                                _activateModel(model['version']),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.deepPurple,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 12, vertical: 6),
                            ),
                            child: const Text('Activate', style: TextStyle(fontSize: 12)),
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
