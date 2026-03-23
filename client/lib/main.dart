import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'providers/app_state.dart';
import 'providers/channel_provider.dart';
import 'screens/onboarding_screen.dart';
import 'screens/chat_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AppState()),
        ChangeNotifierProvider(create: (context) => ChannelProvider(context.read<AppState>().apiService)),
      ],
      child: const LocalVoiceApp(),
    ),
  );
}

class LocalVoiceApp extends StatelessWidget {
  const LocalVoiceApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Local Voice AI',
      theme: ThemeData(
        fontFamily: 'Inter', // Try to keep OpenUI look
        primarySwatch: Colors.blue,
        useMaterial3: true,
      ),
      home: const InitScreen(),
    );
  }
}

class InitScreen extends StatefulWidget {
  const InitScreen({Key? key}) : super(key: key);

  @override
  State<InitScreen> createState() => _InitScreenState();
}

class _InitScreenState extends State<InitScreen> {
  @override
  void initState() {
    super.initState();
    _checkState();
  }

  Future<void> _checkState() async {
    final prefs = await SharedPreferences.getInstance();
    final bool completed = prefs.getBool('onboarding_completed') ?? false;
    final String? serverUrl = prefs.getString('server_url');

    if (completed && serverUrl != null) {
      final appState = Provider.of<AppState>(context, listen: false);
      await appState.setServerUrl(serverUrl);
      
      if (mounted) {
        if (appState.isConnected) {
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(builder: (_) => const ChatScreen()),
          );
          return;
        }
      }
    }

    // Fallback: If not completed or connection failed, go to Onboarding
    if (mounted) {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const OnboardingScreen()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: CircularProgressIndicator(color: Colors.black87),
      ),
    );
  }
}
