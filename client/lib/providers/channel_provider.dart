import 'package:flutter/material.dart';
import '../services/api_service.dart';

class ChannelProvider extends ChangeNotifier {
  final ApiService _apiService;

  List<Map<String, dynamic>> _channels = [];
  List<String> _supported = [];
  bool _isLoading = false;

  ChannelProvider(this._apiService);

  List<Map<String, dynamic>> get channels => _channels;
  List<String> get supported => _supported;
  bool get isLoading => _isLoading;

  Future<void> loadChannels() async {
    _isLoading = true;
    notifyListeners();

    try {
      final data = await _apiService.getChannels();
      _channels = List<Map<String, dynamic>>.from(data['channels'] ?? []);
      _supported = List<String>.from(data['supported'] ?? []);
    } catch (_) {
      _channels = [];
      _supported = [];
    }

    _isLoading = false;
    notifyListeners();
  }

  bool isConnected(String type) {
    return _channels.any((c) => c['type'] == type && c['enabled'] == true);
  }

  Map<String, dynamic>? getChannel(String type) {
    try {
      return _channels.firstWhere((c) => c['type'] == type);
    } catch (_) {
      return null;
    }
  }

  Future<bool> connectChannel(String type, String name, Map<String, String> settings) async {
    final success = await _apiService.saveChannel(type, name, settings);
    if (success) {
      await loadChannels();
    }
    return success;
  }

  Future<bool> disconnectChannel(String type) async {
    final success = await _apiService.deleteChannel(type);
    if (success) {
      await loadChannels();
    }
    return success;
  }

  Future<bool> toggleChannel(String type) async {
    final success = await _apiService.toggleChannel(type);
    if (success) {
      await loadChannels();
    }
    return success;
  }
}
