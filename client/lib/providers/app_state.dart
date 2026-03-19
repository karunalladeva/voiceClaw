import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../models/app_config.dart';

class AppState extends ChangeNotifier {
  final ApiService apiService = ApiService();
  
  bool isConnected = false;
  String connectionError = '';
  AppConfig? config;

  Future<void> setServerUrl(String url) async {
    apiService.setBaseUrl(url);
    await checkConnection();
  }

  Future<void> checkConnection() async {
    try {
      isConnected = await apiService.checkHealth();
      if (isConnected) {
        config = await apiService.getConfig();
        connectionError = '';
      } else {
        connectionError = 'Server not reachable.';
      }
    } catch (e) {
      isConnected = false;
      connectionError = e.toString();
    }
    notifyListeners();
  }

  Future<void> updateConfig(AppConfig newConfig) async {
    try {
      config = await apiService.updateConfig(newConfig);
      notifyListeners();
    } catch (e) {
      print('Error updating config: $e');
    }
  }
}
