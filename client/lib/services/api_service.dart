import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../models/app_config.dart';

class SSEEvent {
  final String type;
  final String data;
  SSEEvent({required this.type, required this.data});
}

class ApiService {
  String baseUrl = 'http://10.0.2.2:3000';

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

  /// Stream text chat via SSE. Yields SSEEvent objects as they arrive.
  Stream<SSEEvent> streamTextChat(String text) async* {
    final client = HttpClient();
    try {
      final request = await client.postUrl(Uri.parse('$baseUrl/chat/text'));
      request.headers.set('Content-Type', 'application/json');
      request.headers.set('Accept', 'text/event-stream');
      request.write(jsonEncode({'text': text}));
      final response = await request.close();

      yield* _parseSSEStream(response);
    } finally {
      client.close();
    }
  }

  /// Stream audio chat via SSE. Yields SSEEvent objects as they arrive.
  Stream<SSEEvent> streamAudioChat(String filePath) async* {
    final client = HttpClient();
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
