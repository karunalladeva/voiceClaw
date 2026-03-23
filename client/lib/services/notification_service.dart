import 'dart:async';
import 'dart:convert';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;

class NotificationService {
  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  String? _baseUrl;
  Timer? _pollingTimer;
  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) return;

    const androidOptions = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosOptions = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: false,
      requestSoundPermission: true,
    );

    const initSettings = InitializationSettings(
      android: androidOptions,
      iOS: iosOptions,
    );

    await _plugin.initialize(initSettings);

    // Create an Android channel
    final channel = AndroidNotificationChannel(
      'voiceclaw_pipeline_channel',
      'Pipeline Outputs',
      description: 'Notifications from Agentic Pipelines',
      importance: Importance.max,
    );

    await _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
      ?.createNotificationChannel(channel);

    _initialized = true;
  }

  void startPolling(String baseUrl) {
    if (!_initialized) initialize();
    _baseUrl = baseUrl;
    _pollingTimer?.cancel();
    // Poll every 10 seconds for new notifications
    _pollingTimer = Timer.periodic(const Duration(seconds: 10), (_) => _fetchAndShow());
    _fetchAndShow(); // fetch immediately
  }

  void stopPolling() {
    _pollingTimer?.cancel();
    _pollingTimer = null;
  }

  Future<void> _fetchAndShow() async {
    if (_baseUrl == null) return;
    
    try {
      final response = await http.get(Uri.parse('$_baseUrl/notifications')).timeout(const Duration(seconds: 5));
      if (response.statusCode != 200) return;

      final data = jsonDecode(response.body);
      final List notifications = data['notifications'] ?? [];
      
      if (notifications.isEmpty) return;

      final idsToMark = <String>[];

      for (var n in notifications) {
        final String id = n['id'];
        final String title = n['title'] ?? 'VoiceClaw';
        final String body = n['body'] ?? '';

        await _showNotification(id.hashCode, title, body);
        idsToMark.add(id);
      }

      if (idsToMark.isNotEmpty) {
        await http.post(
          Uri.parse('$_baseUrl/notifications/read'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'ids': idsToMark}),
        );
      }
    } catch (e) {
      // Silently ignore network errors during background polling
    }
  }

  Future<void> _showNotification(int id, String title, String body) async {
    const androidDetails = AndroidNotificationDetails(
      'voiceclaw_pipeline_channel',
      'Pipeline Outputs',
      channelDescription: 'Notifications from Agentic Pipelines',
      importance: Importance.max,
      priority: Priority.high,
    );
    const iosDetails = DarwinNotificationDetails();
    const details = NotificationDetails(android: androidDetails, iOS: iosDetails);

    await _plugin.show(id, title, body, details);
  }
}
