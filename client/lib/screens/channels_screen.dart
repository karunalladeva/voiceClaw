import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/channel_provider.dart';

const _channelMeta = {
  'discord': {'icon': Icons.discord, 'color': Color(0xFF5865F2)},
  'telegram': {'icon': Icons.telegram, 'color': Color(0xFF2AABEE)},
  'whatsapp': {'icon': Icons.chat, 'color': Color(0xFF25D366)},
  'slack': {'icon': Icons.abc, 'color': Color(0xFFE01E5A)},
  'email': {'icon': Icons.email, 'color': Color(0xFFEA4335)},
  'history': {'icon': Icons.history, 'color': Color(0xFF757575)},
  'push': {'icon': Icons.notifications, 'color': Color(0xFFFFA000)},
};

class ChannelsScreen extends StatefulWidget {
  const ChannelsScreen({Key? key}) : super(key: key);
  @override
  State<ChannelsScreen> createState() => _ChannelsScreenState();
}

class _ChannelsScreenState extends State<ChannelsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<Map<String, dynamic>> _pendingPairings = [];
  Map<String, dynamic> _approvedPairings = {};
  bool _isLoadingPairings = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadData();
    });
  }

  Future<void> _loadData() async {
    final provider = context.read<ChannelProvider>();
    provider.loadChannels();
    setState(() => _isLoadingPairings = true);
    final pending = await provider.getPendingPairings();
    final approved = await provider.getApprovedPairings();
    setState(() {
      _pendingPairings = pending;
      _approvedPairings = approved;
      _isLoadingPairings = false;
    });
  }

  IconData _getIcon(String type) => (_channelMeta[type]?['icon'] as IconData?) ?? Icons.link;
  Color _getColor(String type) => (_channelMeta[type]?['color'] as Color?) ?? Colors.blueAccent;

  Future<void> _showWhatsAppQR() async {
    final provider = context.read<ChannelProvider>();
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => const AlertDialog(
        title: Text('Connecting to WhatsApp...'),
        content: SizedBox(height: 100, child: Center(child: CircularProgressIndicator())),
      ),
    );

    Map<String, dynamic>? finalStatus;
    
    // Poll up to 8 times (12 seconds) for the QR code to be generated
    for (int i = 0; i < 8; i++) {
        await Future.delayed(const Duration(milliseconds: 1500));
        if (!mounted) return;
        
        finalStatus = await provider.getWhatsAppStatus();
        if (finalStatus['qr'] != null || finalStatus['connected'] == true) {
            break;
        }
    }
    
    Navigator.pop(context); // close loading dialog

    if (finalStatus == null) return;

    if (finalStatus['connected'] == true && finalStatus['qr'] == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('WhatsApp is already connected.')));
      return;
    }

    if (finalStatus['qr'] != null && finalStatus['qr'] is String) {
      final base64String = finalStatus['qr'].split(',').last;
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Scan QR Code'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Open WhatsApp on your phone\n-> Linked Devices\n-> Link a Device', textAlign: TextAlign.center),
              const SizedBox(height: 16),
              Image.memory(base64Decode(base64String), width: 250, height: 250),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Done')),
          ],
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('QR code not ready. Try again in a few seconds.')));
    }
  }

  Future<void> _showTestChatDialog(String type, String id) async {
    final controller = TextEditingController();
    final provider = context.read<ChannelProvider>();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Test Chat: $type'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Send a manual message to $id', style: const TextStyle(fontSize: 12, color: Colors.grey)),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              decoration: const InputDecoration(hintText: 'Type message...', border: OutlineInputBorder()),
              maxLines: 3,
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () async {
              final msg = controller.text.trim();
              if (msg.isEmpty) return;
              Navigator.pop(ctx);
              final success = await provider.sendTestMessage(type, id, msg);
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(success ? '✅ Message sent!' : '❌ Failed to send message.')),
                );
              }
            },
            child: const Text('Send'),
          ),
        ],
      ),
    );
  }

  Widget _buildChannelSettings() {
    final provider = context.watch<ChannelProvider>();
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Channel Services', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('Enable or disable core channel services. API tokens are managed via the backend environment (.env).', style: TextStyle(color: Colors.black54)),
          const SizedBox(height: 16),
          ...provider.supported.map((type) {
            final connected = provider.isConnected(type);
            final color = _getColor(type);
            return Card(
              margin: const EdgeInsets.only(bottom: 12),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              child: ListTile(
                leading: CircleAvatar(backgroundColor: color.withOpacity(0.15), child: Icon(_getIcon(type), color: color)),
                title: Text(type[0].toUpperCase() + type.substring(1), style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text(connected ? 'Running' : 'Stopped'),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (type == 'whatsapp' && connected) ...[
                      IconButton(
                        icon: const Icon(Icons.phonelink_erase),
                        tooltip: 'Reset WhatsApp Session',
                        onPressed: () async {
                          final confirm = await showDialog<bool>(
                            context: context,
                            builder: (ctx) => AlertDialog(
                              title: const Text('Reset WhatsApp?'),
                              content: const Text('This will delete your current WhatsApp session to fix connection issues. You will need to scan a new QR code.'),
                              actions: [
                                TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                                TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Reset', style: TextStyle(color: Colors.red))),
                              ],
                            ),
                          );
                          if (confirm == true) {
                            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Resetting session... Please wait.')));
                            await provider.resetWhatsApp();
                            await Future.delayed(const Duration(seconds: 2));
                            _loadData(); // reload UI
                          }
                        },
                      ),
                      IconButton(
                        icon: const Icon(Icons.qr_code),
                        tooltip: 'Show QR Code',
                        onPressed: _showWhatsAppQR,
                      ),
                    ],
                    Switch(
                      value: connected,
                      activeColor: color,
                      onChanged: (val) async {
                        final exists = provider.getChannel(type) != null;
                        if (!exists && val) {
                           await provider.connectChannel(type, '${type.toUpperCase()} Channel', {});
                        } else {
                           await provider.toggleChannel(type);
                        }
                      },
                    ),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildPairingDashboard() {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Pending Pairing Requests', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('Approve devices trying to communicate with VoiceClaw.', style: TextStyle(color: Colors.black54)),
          const SizedBox(height: 16),
          if (_isLoadingPairings) const Center(child: CircularProgressIndicator()),
          if (!_isLoadingPairings && _pendingPairings.isEmpty)
            const Padding(padding: EdgeInsets.all(16), child: Text('No pending requests', style: TextStyle(color: Colors.black38, fontStyle: FontStyle.italic))),
            
          ..._pendingPairings.map((p) {
             return Card(
               margin: const EdgeInsets.only(bottom: 8),
               child: ListTile(
                 leading: CircleAvatar(backgroundColor: _getColor(p['channelType']).withOpacity(0.1), child: Icon(_getIcon(p['channelType']), color: _getColor(p['channelType']))),
                 title: Text('${p['senderName']} (${p['senderId']})', style: const TextStyle(fontWeight: FontWeight.bold)),
                 subtitle: Text('Code: ${p['code']} • Channel: ${p['channelType']}'),
                 trailing: Row(
                   mainAxisSize: MainAxisSize.min,
                   children: [
                     IconButton(icon: const Icon(Icons.close, color: Colors.grey), onPressed: () async {
                       await context.read<ChannelProvider>().rejectPairing(p['code']);
                       _loadData();
                     }),
                     ElevatedButton(
                       style: ElevatedButton.styleFrom(backgroundColor: Colors.black, foregroundColor: Colors.white),
                       onPressed: () async {
                         await context.read<ChannelProvider>().approvePairing(p['code']);
                         _loadData();
                       },
                       child: const Text('Approve'),
                     ),
                   ],
                 )
               ),
             );
          }).toList(),
          
          const SizedBox(height: 32),
          const Text('Approved Endpoints', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          ..._approvedPairings.entries.expand((entry) {
             final channelType = entry.key;
             final List ids = entry.value;
             return ids.map((id) => Card(
               margin: const EdgeInsets.only(bottom: 8),
               child: ListTile(
                 leading: CircleAvatar(backgroundColor: _getColor(channelType).withOpacity(0.1), child: Icon(_getIcon(channelType), color: _getColor(channelType))),
                 title: Text(id.toString()),
                 subtitle: Text(channelType[0].toUpperCase() + channelType.substring(1)),
                 trailing: Row(
                   mainAxisSize: MainAxisSize.min,
                   children: [
                     IconButton(
                       icon: const Icon(Icons.chat_bubble_outline, size: 20),
                       tooltip: 'Test Message',
                       onPressed: () => _showTestChatDialog(channelType, id.toString()),
                     ),
                     IconButton(icon: const Icon(Icons.link_off, color: Colors.red), onPressed: () async {
                         await context.read<ChannelProvider>().revokePairing(channelType, id.toString());
                         _loadData();
                     }),
                   ],
                 ),
               )
             ));
          }),
          if (!_isLoadingPairings && _approvedPairings.isEmpty)
            const Padding(padding: EdgeInsets.all(16), child: Text('No approved endpoints yet', style: TextStyle(color: Colors.black38, fontStyle: FontStyle.italic))),
        ],
      )
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F5F5),
      appBar: AppBar(
        title: const Text('Channel Connections', style: TextStyle(fontWeight: FontWeight.w600)),
        backgroundColor: Colors.white, foregroundColor: Colors.black87, elevation: 0,
        bottom: TabBar(
          controller: _tabController,
          labelColor: Colors.black87,
          indicatorColor: Colors.black87,
          tabs: const [
            Tab(text: 'Pairing Dashboard'),
            Tab(text: 'Services'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildPairingDashboard(),
          _buildChannelSettings(),
        ],
      ),
    );
  }
}
