import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../models/app_config.dart';
import '../models/model_config.dart';

class SSEEvent {
  final String type;
  final String data;
  SSEEvent({required this.type, required this.data});
}

class ApiService {
  String baseUrl = 'http://localhost:3000';

  /// The active streaming HTTP client. Kept as a field so it can be
  /// force-closed via [abort] to cancel an in-progress SSE stream.
  HttpClient? _activeClient;

  ApiService({String? initialUrl}) {
    if (initialUrl != null && initialUrl.isNotEmpty) {
      baseUrl = initialUrl;
    }
  }

  void setBaseUrl(String url) {
    if (!url.startsWith('http')) {
      url = 'http://$url';
    }
    baseUrl = url;
  }

  /// Abort the currently active SSE stream (if any).
  /// Closing the client causes the server to receive a connection-close event
  /// and cancel its own processing.
  void abort() {
    _activeClient?.close(force: true);
    _activeClient = null;
  }

  Future<bool> checkHealth() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/health')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return data['status'] == 'ok';
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  Future<Map<String, dynamic>> checkOnboard() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/onboard')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
      throw Exception('Failed to get onboard status');
    } catch (e) {
      throw Exception('Server unreachable: $e');
    }
  }

  Future<AppConfig> getConfig() async {
    final response = await http.get(Uri.parse('$baseUrl/config'));
    if (response.statusCode == 200) {
      return AppConfig.fromJson(jsonDecode(response.body));
    }
    throw Exception('Failed to load config');
  }

  Future<AppConfig> updateConfig(AppConfig config) async {
    final response = await http.post(
      Uri.parse('$baseUrl/config'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(config.toJson()),
    );
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      return AppConfig.fromJson(data['config']);
    }
    throw Exception('Failed to update config');
  }

  // ── Memory API ────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getMemoryStatus() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/memory/status')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) return jsonDecode(response.body);
    } catch (_) {}
    return {'available': false, 'enabled': false};
  }

  Future<List<dynamic>> listMemories() async {
    final response = await http.get(Uri.parse('$baseUrl/memory'));
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      if (data is! Map) return [];
      final raw = data['memories'];
      if (raw is List) return raw;
      if (raw is String && raw.isNotEmpty) {
        try {
          final decoded = jsonDecode(raw);
          if (decoded is List) return decoded;
        } catch (_) {}
        return [
          {'id': 'string-content', 'content': raw, 'timestamp': DateTime.now().toIso8601String(), 'tags': []}
        ];
      }
      return [];
    }
    throw Exception('Failed to list memories');
  }

  Future<void> addMemory(String content, List<String> tags) async {
    final response = await http.post(
      Uri.parse('$baseUrl/memory'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'content': content, 'tags': tags}),
    );
    if (response.statusCode != 200) throw Exception('Failed to add memory');
  }

  Future<void> deleteMemory(String id) async {
    final response = await http.delete(Uri.parse('$baseUrl/memory/$id'));
    if (response.statusCode != 200) throw Exception('Failed to delete memory');
  }

  // ── Models API ────────────────────────────────────────────────────────────

  Future<List<ModelConfig>> listModels() async {
    final response = await http.get(Uri.parse('$baseUrl/models'));
    if (response.statusCode == 200) {
      final list = (jsonDecode(response.body)['models'] as List?) ?? [];
      return list.map((m) => ModelConfig.fromJson(m as Map<String, dynamic>)).toList();
    }
    throw Exception('Failed to list models');
  }

  Future<ModelConfig> saveModel(ModelConfig config) async {
    final response = await http.post(
      Uri.parse('$baseUrl/models'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(config.toJson()),
    );
    if (response.statusCode == 200) {
      return ModelConfig.fromJson(jsonDecode(response.body)['model'] as Map<String, dynamic>);
    }
    final detail = jsonDecode(response.body)['error'] ?? 'Unknown error';
    throw Exception('Failed to save model: $detail');
  }

  Future<void> deleteModel(String id) async {
    final response = await http.delete(Uri.parse('$baseUrl/models/$id'));
    if (response.statusCode != 200) throw Exception('Failed to delete model');
  }

  Future<void> setMasterModel(String id) async {
    final response = await http.post(Uri.parse('$baseUrl/models/$id/master'));
    if (response.statusCode != 200) throw Exception('Failed to set master model');
  }

  Future<ModelCapabilities> detectModelCapabilities(String id) async {
    final response = await http
        .post(Uri.parse('$baseUrl/models/$id/detect'))
        .timeout(const Duration(seconds: 60));
    if (response.statusCode == 200) {
      return ModelCapabilities.fromJson(
          jsonDecode(response.body)['capabilities'] as Map<String, dynamic>);
    }
    throw Exception('Capability detection failed');
  }

  Future<List<ModelConfig>> detectAllCapabilities() async {
    final response = await http
        .post(Uri.parse('$baseUrl/models/detect-all'))
        .timeout(const Duration(seconds: 120));
    if (response.statusCode == 200) {
      final list = (jsonDecode(response.body)['models'] as List?) ?? [];
      return list.map((m) => ModelConfig.fromJson(m as Map<String, dynamic>)).toList();
    }
    throw Exception('Bulk detection failed');
  }

  // ── Session API ────────────────────────────────────────────────────────────

  Future<void> resetConversation() async {
    try {
      await http.post(Uri.parse('$baseUrl/chat/reset')).timeout(const Duration(seconds: 5));
    } catch (_) {}
  }

  Future<int> getHistoryTurns() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/chat/history')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return (data['turns'] as num?)?.toInt() ?? 0;
      }
    } catch (_) {}
    return 0;
  }

  /// Stream text chat via SSE. Yields SSEEvent objects as they arrive.
  Stream<SSEEvent> streamTextChat(String text) async* {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 30)
      ..idleTimeout = const Duration(seconds: 120);
    _activeClient = client;
    try {
      final request = await client.postUrl(Uri.parse('$baseUrl/chat/text'));
      request.headers.set('Content-Type', 'application/json');
      request.headers.set('Accept', 'text/event-stream');
      request.write(jsonEncode({'text': text}));
      final response = await request.close();

      yield* _parseSSEStream(response);
    } finally {
      _activeClient = null;
      client.close();
    }
  }

  /// Stream audio chat via SSE. Yields SSEEvent objects as they arrive.
  Stream<SSEEvent> streamAudioChat(String filePath) async* {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 30)
      ..idleTimeout = const Duration(seconds: 120);
    _activeClient = client;
    try {
      final file = File(filePath);
      final fileBytes = await file.readAsBytes();
      final fileName = filePath.split('/').last.split('\\').last;
      
      final boundary = 'boundary-${DateTime.now().millisecondsSinceEpoch}';
      final request = await client.postUrl(Uri.parse('$baseUrl/chat/audio'));
      request.headers.set('Content-Type', 'multipart/form-data; boundary=$boundary');
      request.headers.set('Accept', 'text/event-stream');

      // Build multipart body manually since HttpClient doesn't have MultipartRequest
      final bodyParts = <int>[];
      final header = '--$boundary\r\nContent-Disposition: form-data; name="audio"; filename="$fileName"\r\nContent-Type: audio/wav\r\n\r\n';
      bodyParts.addAll(utf8.encode(header));
      bodyParts.addAll(fileBytes);
      bodyParts.addAll(utf8.encode('\r\n--$boundary--\r\n'));

      request.contentLength = bodyParts.length;
      request.add(bodyParts);
      final response = await request.close();

      yield* _parseSSEStream(response);
    } finally {
      _activeClient = null;
      client.close();
    }
  }

  /// Parse raw SSE byte stream into SSEEvent objects
  Stream<SSEEvent> _parseSSEStream(HttpClientResponse response) async* {
    String buffer = '';

    await for (final chunk in response.transform(utf8.decoder)) {
      buffer += chunk;

      // SSE events are separated by double newlines
      while (buffer.contains('\n\n')) {
        final eventEnd = buffer.indexOf('\n\n');
        final rawEvent = buffer.substring(0, eventEnd);
        buffer = buffer.substring(eventEnd + 2);

        // Skip SSE comment lines (keepalive: ': keepalive')
        if (rawEvent.trim().startsWith(':')) continue;

        String? eventType;
        String? eventData;

        for (final line in rawEvent.split('\n')) {
          if (line.startsWith('event: ')) {
            eventType = line.substring(7).trim();
          } else if (line.startsWith('data: ')) {
            final raw = line.substring(6).trim();
            // The data is JSON-encoded, strip quotes
            try {
              eventData = jsonDecode(raw) as String;
            } catch (_) {
              eventData = raw;
            }
          }
        }

        if (eventType != null && eventData != null) {
          yield SSEEvent(type: eventType, data: eventData);
        }
      }
    }
  }
}
