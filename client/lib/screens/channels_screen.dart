import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/channel_provider.dart';

/// Channel icons & metadata for the UI
const _channelMeta = {
  'discord': {'icon': Icons.discord, 'color': Color(0xFF5865F2), 'fields': ['webhook_url']},
  'telegram': {'icon': Icons.telegram, 'color': Color(0xFF2AABEE), 'fields': ['bot_token', 'chat_id']},
  'whatsapp': {'icon': Icons.chat, 'color': Color(0xFF25D366), 'fields': ['twilio_sid', 'twilio_token', 'from_number', 'to_number']},
  'email': {'icon': Icons.email, 'color': Color(0xFFEA4335), 'fields': ['smtp_host', 'smtp_port', 'email_user', 'email_pass', 'to_email']},
  'history': {'icon': Icons.history, 'color': Color(0xFF757575), 'fields': ['chat_id']},
};

class ChannelsScreen extends StatefulWidget {
  const ChannelsScreen({Key? key}) : super(key: key);
  @override
  State<ChannelsScreen> createState() => _ChannelsScreenState();
}

class _ChannelsScreenState extends State<ChannelsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ChannelProvider>().loadChannels();
    });
  }

  Future<void> _showConnectDialog(String type, ChannelProvider provider) async {
    final meta = _channelMeta[type];
    final fields = (meta?['fields'] as List<String>?) ?? [];
    final existing = provider.getChannel(type);

    final result = await showDialog<Map<String, String>>(
      context: context,
      barrierColor: Colors.black.withOpacity(0.4),
      builder: (ctx) => _ChannelConnectDialog(
        type: type,
        fields: fields,
        existingSettings: (existing?['settings'] as Map?)?.cast<String, dynamic>(),
        icon: (meta?['icon'] as IconData?) ?? Icons.link,
        color: (meta?['color'] as Color?) ?? Colors.blueAccent,
      ),
    );

    if (result != null) {
      final name = '${type[0].toUpperCase()}${type.substring(1)} Channel';
      await provider.connectChannel(type, name, result);
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ChannelProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Delivery Channels', style: TextStyle(fontWeight: FontWeight.w600)),
        backgroundColor: Colors.white, foregroundColor: Colors.black87, elevation: 0,
      ),
      backgroundColor: const Color(0xFFF5F5F5),
      body: provider.isLoading
        ? const Center(child: CircularProgressIndicator())
        : ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Padding(
                padding: EdgeInsets.only(bottom: 16),
                child: Text('Connect channels to receive pipeline outputs via Discord, Telegram, WhatsApp, Email, or local history.',
                  style: TextStyle(color: Colors.black54, fontSize: 14)),
              ),
              ...provider.supported.map((type) {
                final meta = _channelMeta[type];
                final connected = provider.isConnected(type);
                final icon = (meta?['icon'] as IconData?) ?? Icons.link;
                final color = (meta?['color'] as Color?) ?? Colors.grey;
                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  child: ListTile(
                    leading: CircleAvatar(backgroundColor: color.withOpacity(0.15), child: Icon(icon, color: color)),
                    title: Text(type[0].toUpperCase() + type.substring(1), style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text(connected ? 'Connected ✅' : 'Not connected'),
                    trailing: connected
                      ? Row(mainAxisSize: MainAxisSize.min, children: [
                          IconButton(icon: const Icon(Icons.edit, size: 20), onPressed: () => _showConnectDialog(type, provider)),
                          IconButton(icon: const Icon(Icons.link_off, color: Colors.red, size: 20), onPressed: () => provider.disconnectChannel(type)),
                        ])
                      : ElevatedButton(
                          onPressed: () => _showConnectDialog(type, provider),
                          style: ElevatedButton.styleFrom(backgroundColor: color),
                          child: const Text('Connect', style: TextStyle(color: Colors.white)),
                        ),
                  ),
                );
              }),
            ],
          ),
    );
  }
}

class _ChannelConnectDialog extends StatefulWidget {
  final String type;
  final List<String> fields;
  final Map<String, dynamic>? existingSettings;
  final IconData icon;
  final Color color;

  const _ChannelConnectDialog({
    required this.type,
    required this.fields,
    this.existingSettings,
    required this.icon,
    required this.color,
  });

  @override
  State<_ChannelConnectDialog> createState() => _ChannelConnectDialogState();
}

class _ChannelConnectDialogState extends State<_ChannelConnectDialog> {
  final Map<String, TextEditingController> _controllers = {};

  @override
  void initState() {
    super.initState();
    for (final f in widget.fields) {
      final val = widget.existingSettings?[f]?.toString() ?? '';
      _controllers[f] = TextEditingController(text: val);
    }
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      elevation: 0,
      backgroundColor: Colors.transparent,
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.1),
              blurRadius: 20,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              radius: 30,
              backgroundColor: widget.color.withOpacity(0.1),
              child: Icon(widget.icon, color: widget.color, size: 32),
            ),
            const SizedBox(height: 16),
            Text(
              'Connect ${widget.type[0].toUpperCase()}${widget.type.substring(1)}',
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, letterSpacing: -0.5),
            ),
            const SizedBox(height: 8),
            Text(
              'Configure your delivery settings to receive notifications.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey[600], fontSize: 13),
            ),
            const SizedBox(height: 24),
            Flexible(
              child: SingleChildScrollView(
                child: Column(
                  children: widget.fields.map((f) => Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          f.replaceAll('_', ' ').toUpperCase(),
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: Colors.grey[500],
                            letterSpacing: 0.5,
                          ),
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          controller: _controllers[f],
                          obscureText: f.contains('token') || f.contains('pass') || f.contains('sid'),
                          decoration: InputDecoration(
                            hintText: 'Enter ${f.replaceAll('_', ' ')}...',
                            hintStyle: TextStyle(color: Colors.grey[400], fontSize: 14),
                            filled: true,
                            fillColor: Colors.grey[50],
                            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(color: Colors.grey[200]!),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(color: widget.color, width: 1.5),
                            ),
                          ),
                        ),
                      ],
                    ),
                  )).toList(),
                ),
              ),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: TextButton(
                    onPressed: () => Navigator.pop(context),
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: Text('Cancel', style: TextStyle(color: Colors.grey[600], fontWeight: FontWeight.w600)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {
                      final results = _controllers.map((k, v) => MapEntry(k, v.text.trim()));
                      Navigator.pop(context, results);
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.black87,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      elevation: 0,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text('Connect', style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
