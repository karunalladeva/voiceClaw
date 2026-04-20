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

  Future<List<Map<String, dynamic>>> getChats() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/chats')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return List<Map<String, dynamic>>.from(data['chats'] ?? []);
      }
    } catch (_) {}
    return [];
  }

  Future<List<Map<String, dynamic>>> loadChat(String id) async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/chats/$id')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return List<Map<String, dynamic>>.from(data['messages'] ?? []);
      }
    } catch (_) {}
    return [];
  }

  Future<void> deleteChat(String id) async {
    try {
      await http.delete(Uri.parse('$baseUrl/chats/$id')).timeout(const Duration(seconds: 5));
    } catch (_) {}
  }

  Future<void> resetConversation(String chatId) async {
    try {
      await http.post(
          Uri.parse('$baseUrl/chat/reset'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'chatId': chatId})
      ).timeout(const Duration(seconds: 5));
    } catch (_) {}
  }

  Future<int> getHistoryTurns(String chatId) async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/chat/history?chatId=$chatId')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return (data['turns'] as num?)?.toInt() ?? 0;
      }
    } catch (_) {}
    return 0;
  }

  /// Stream text chat via SSE. Yields SSEEvent objects as they arrive.
  Stream<SSEEvent> streamTextChat(String text, String chatId) async* {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 30)
      ..idleTimeout = const Duration(seconds: 120);
    _activeClient = client;
    try {
      final request = await client.postUrl(Uri.parse('$baseUrl/chat/text'));
      request.headers.set('Content-Type', 'application/json');
      request.headers.set('Accept', 'text/event-stream');
      request.write(jsonEncode({'text': text, 'chatId': chatId}));
      final response = await request.close();

      yield* _parseSSEStream(response);
    } finally {
      _activeClient = null;
      client.close();
    }
  }

  /// Stream audio chat via SSE. Yields SSEEvent objects as they arrive.
  Stream<SSEEvent> streamAudioChat(String filePath, String chatId) async* {
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
      
      final chatHeader = '\r\n--$boundary\r\nContent-Disposition: form-data; name="chatId"\r\n\r\n$chatId';
      bodyParts.addAll(utf8.encode(chatHeader));

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
          final trimmed = line.trim();
          if (trimmed.isEmpty) continue;

          if (trimmed.startsWith('event: ')) {
            eventType = trimmed.substring(7).trim();
          } else if (trimmed.startsWith('data: ')) {
            final raw = trimmed.substring(6).trim();
            try {
              final decoded = jsonDecode(raw);
              if (decoded is String) {
                eventData = decoded;
              } else {
                // If it's a Map or other type, convert to string
                eventData = jsonEncode(decoded);
              }
            } catch (e) {
              eventData = raw; // Fallback to raw string
            }
          }
        }

        if (eventType != null && eventData != null) {
          yield SSEEvent(type: eventType, data: eventData);
        }
      }
    }
  }

  // ── Channels API ────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getChannels() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/channels')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) return jsonDecode(response.body);
    } catch (_) {}
    return {'channels': [], 'supported': []};
  }

  Future<bool> saveChannel(String type, String name, Map<String, String> settings) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/channels'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'type': type, 'name': name, 'settings': settings}),
      );
      return response.statusCode == 200;
    } catch (_) { return false; }
  }

  Future<bool> toggleChannel(String type) async {
    try {
      final response = await http.put(Uri.parse('$baseUrl/channels/$type/toggle'));
      return response.statusCode == 200;
    } catch (_) { return false; }
  }

  Future<bool> deleteChannel(String type) async {
    try {
      final response = await http.delete(Uri.parse('$baseUrl/channels/$type'));
      return response.statusCode == 200;
    } catch (_) { return false; }
  }

  // ── Pairing API ─────────────────────────────────────────────────────────────

  Future<List<Map<String, dynamic>>> getPendingPairings() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/channels/pairings/pending')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        return List<Map<String, dynamic>>.from(jsonDecode(response.body)['pairings'] ?? []);
      }
    } catch (_) {}
    return [];
  }

  Future<Map<String, dynamic>> getApprovedPairings() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/channels/pairings/approved')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        return jsonDecode(response.body)['approved'] ?? {};
      }
    } catch (_) {}
    return {};
  }

  Future<bool> approvePairing(String code) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/channels/pairings/approve'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'code': code}),
      );
      return response.statusCode == 200 && jsonDecode(response.body)['success'] == true;
    } catch (_) { return false; }
  }

  Future<bool> rejectPairing(String code) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/channels/pairings/reject'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'code': code}),
      );
      return response.statusCode == 200 && jsonDecode(response.body)['success'] == true;
    } catch (_) { return false; }
  }

  Future<bool> revokePairing(String channelType, String senderId) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/channels/pairings/revoke'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'channelType': channelType, 'senderId': senderId}),
      );
      return response.statusCode == 200;
    } catch (_) { return false; }
  }

  Future<Map<String, dynamic>> getWhatsAppStatus() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/channels/whatsapp/status')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (_) {}
    return {'qr': null, 'connected': false};
  }

  Future<bool> resetWhatsApp() async {
    try {
      final response = await http.post(Uri.parse('$baseUrl/channels/whatsapp/reset')).timeout(const Duration(seconds: 15));
      return response.statusCode == 200 && jsonDecode(response.body)['success'] == true;
    } catch (_) { return false; }
  }

  Future<bool> sendTestMessage(String channelType, String recipientId, String message) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/channels/test-message'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'channelType': channelType, 'recipientId': recipientId, 'message': message}),
      );
      return response.statusCode == 200 && jsonDecode(response.body)['success'] == true;
    } catch (_) { return false; }
  }

  // ── Pipelines API ──────────────────────────────────────────────────────────

  Future<List<Map<String, dynamic>>> getPipelines() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/pipelines')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        return List<Map<String, dynamic>>.from(jsonDecode(response.body)['pipelines'] ?? []);
      }
    } catch (_) {}
    return [];
  }

  Future<bool> deletePipeline(String id) async {
    try {
      final response = await http.delete(Uri.parse('$baseUrl/pipelines/$id'));
      return response.statusCode == 200;
    } catch (_) { return false; }
  }

  Future<bool> togglePipeline(String id) async {
    try {
      final response = await http.put(Uri.parse('$baseUrl/pipelines/$id/toggle'));
      return response.statusCode == 200;
    } catch (_) { return false; }
  }

  Future<Map<String, dynamic>?> runPipelineNow(String id) async {
    try {
      final response = await http.post(Uri.parse('$baseUrl/pipelines/$id/run')).timeout(const Duration(seconds: 120));
      if (response.statusCode == 200) return jsonDecode(response.body);
    } catch (_) {}
    return null;
  }

  Future<List<Map<String, dynamic>>> getPipelineHistory() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/pipelines/history')).timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) {
        return List<Map<String, dynamic>>.from(jsonDecode(response.body)['history'] ?? []);
      }
    } catch (_) {}
    return [];
  }

  // ── Evolution Pipeline API ──────────────────────────────────────────────────

  Future<Map<String, dynamic>> harvestWorkspace() async {
    final response = await http.post(Uri.parse('$baseUrl/evolution/harvest'))
        .timeout(const Duration(minutes: 10));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception('Harvest failed: ${response.body}');
  }

  Future<Map<String, dynamic>> getEvolutionStats() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/evolution/stats'))
          .timeout(const Duration(seconds: 10));
      if (response.statusCode == 200) return jsonDecode(response.body);
    } catch (_) {}
    return {
      'totalHarvested': 0, 'pendingReview': 0, 'approved': 0,
      'rejected': 0, 'trainUnlocked': false, 'minSamples': 100,
      'lastHarvestAt': null, 'lastTrainingAt': null, 'currentTraining': null,
    };
  }

  Future<Map<String, dynamic>> getReviewQueue({int page = 1, int limit = 20}) async {
    final response = await http.get(
      Uri.parse('$baseUrl/evolution/queue?page=$page&limit=$limit'),
    ).timeout(const Duration(seconds: 10));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception('Failed to fetch review queue');
  }

  Future<bool> approveSample(String id) async {
    try {
      final response = await http.post(Uri.parse('$baseUrl/evolution/queue/$id/approve'));
      return response.statusCode == 200;
    } catch (_) { return false; }
  }

  Future<bool> rejectSample(String id) async {
    try {
      final response = await http.post(Uri.parse('$baseUrl/evolution/queue/$id/reject'));
      return response.statusCode == 200;
    } catch (_) { return false; }
  }

  Future<Map<String, dynamic>> batchApproveSamples(List<String> ids) async {
    final response = await http.post(
      Uri.parse('$baseUrl/evolution/queue/batch-approve'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'ids': ids}),
    );
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception('Batch approve failed');
  }

  Future<Map<String, dynamic>> batchRejectSamples(List<String> ids) async {
    final response = await http.post(
      Uri.parse('$baseUrl/evolution/queue/batch-reject'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'ids': ids}),
    );
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception('Batch reject failed');
  }

  Future<Map<String, dynamic>> startTraining() async {
    final response = await http.post(Uri.parse('$baseUrl/evolution/train'))
        .timeout(const Duration(seconds: 30));
    if (response.statusCode == 200) return jsonDecode(response.body);
    final detail = jsonDecode(response.body)['error'] ?? 'Unknown error';
    throw Exception(detail);
  }

  Future<Map<String, dynamic>?> getTrainingStatus() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/evolution/training-status'))
          .timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) return jsonDecode(response.body);
    } catch (_) {}
    return null;
  }

  Future<Map<String, dynamic>> getVramStatus() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/evolution/vram'))
          .timeout(const Duration(seconds: 5));
      if (response.statusCode == 200) return jsonDecode(response.body);
    } catch (_) {}
    return {'safe': true, 'usedMB': 0, 'thresholdMB': 2048};
  }

  Future<List<Map<String, dynamic>>> listEvolvedModels() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/evolution/models'))
          .timeout(const Duration(seconds: 10));
      if (response.statusCode == 200) {
        return List<Map<String, dynamic>>.from(jsonDecode(response.body)['models'] ?? []);
      }
    } catch (_) {}
    return [];
  }

  Future<bool> activateEvolvedModel(String version) async {
    try {
      final response = await http.post(Uri.parse('$baseUrl/evolution/models/$version/activate'));
      return response.statusCode == 200;
    } catch (_) { return false; }
  }

  Future<bool> rollbackToBase() async {
    try {
      final response = await http.post(Uri.parse('$baseUrl/evolution/models/rollback'));
      return response.statusCode == 200;
    } catch (_) { return false; }
  }

  Future<bool> resetHarvest({bool keepVerified = false}) async {
    try {
      final response = await http.delete(
        Uri.parse('$baseUrl/evolution/reset?keepVerified=$keepVerified'),
      ).timeout(const Duration(seconds: 10));
      return response.statusCode == 200;
    } catch (_) { return false; }
  }
}
