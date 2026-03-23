import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../providers/app_state.dart';
import 'chat_screen.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({Key? key}) : super(key: key);

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final PageController _pageController = PageController();
  final TextEditingController _urlController = TextEditingController(text: 'http://192.168.1.50:3000');
  bool _isLoading = false;
  int _currentPage = 0;

  @override
  void initState() {
    super.initState();
    _checkInitialPage();
  }

  Future<void> _checkInitialPage() async {
    final prefs = await SharedPreferences.getInstance();
    final bool completed = prefs.getBool('onboarding_completed') ?? false;
    final String? url = prefs.getString('server_url');
    if (url != null) {
      _urlController.text = url;
    }
    if (completed && mounted) {
      setState(() {
        _currentPage = 2; // Jump to Connect Server page
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_pageController.hasClients) {
          _pageController.jumpToPage(2);
        }
      });
    }
  }

  @override
  void dispose() {
    _pageController.dispose();
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _completeOnboarding() async {
    setState(() => _isLoading = true);
    final appState = Provider.of<AppState>(context, listen: false);
    
    await appState.setServerUrl(_urlController.text);
    
    if (!mounted) return;
    setState(() => _isLoading = false);
    
    if (appState.isConnected) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('onboarding_completed', true);
      await prefs.setString('server_url', _urlController.text);
      if (mounted) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(builder: (context) => const ChatScreen()),
        );
      }
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(appState.connectionError.isNotEmpty ? appState.connectionError : 'Failed to connect. Is the server running?')),
      );
    }
  }

  Widget _buildPage({
    IconData? icon,
    String? imageAsset,
    required String title,
    required String description,
    Widget? extraChild,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 40.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (imageAsset != null)
            Image.asset(imageAsset, width: 120, height: 120, fit: BoxFit.contain)
          else if (icon != null)
            Icon(icon, size: 80, color: Colors.blue.shade700),
          const SizedBox(height: 32),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.black87),
          ),
          const SizedBox(height: 16),
          Text(
            description,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 15, height: 1.5, color: Colors.grey.shade600),
          ),
          if (extraChild != null) ...[
            const SizedBox(height: 32),
            extraChild,
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: PageView(
                controller: _pageController,
                onPageChanged: (idx) => setState(() => _currentPage = idx),
                children: [
                  _buildPage(
                    imageAsset: 'assets/images/logo.png',
                    title: 'Welcome to VoiceClaw',
                    description: 'Your intelligent, fully local voice assistant built on OpenUI design principles.',
                  ),
                  _buildPage(
                    icon: Icons.security,
                    title: 'Privacy First',
                    description: 'All conversations and voice processing happen entirely on your local network. No data leaves your control.',
                  ),
                  _buildPage(
                    icon: Icons.dns_outlined,
                    title: 'Connect Server',
                    description: 'Enter the Local AI Server URL to connect.',
                    extraChild: TextField(
                      controller: _urlController,
                      textAlign: TextAlign.center,
                      decoration: InputDecoration(
                        labelText: 'Server URL',
                        hintText: 'http://192.168.1.10:3000',
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(24.0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: List.generate(3, (index) => 
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 300),
                        margin: const EdgeInsets.only(right: 8),
                        height: 8,
                        width: _currentPage == index ? 24 : 8,
                        decoration: BoxDecoration(
                          color: _currentPage == index ? Colors.blue.shade700 : Colors.grey.shade300,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      )
                    ),
                  ),
                  ElevatedButton(
                    onPressed: _isLoading ? null : () {
                      if (_currentPage < 2) {
                        _pageController.nextPage(duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
                      } else {
                        _completeOnboarding();
                      }
                    },
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                      backgroundColor: Colors.black87,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      elevation: 0,
                    ),
                    child: _isLoading 
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                      : Text(_currentPage == 2 ? 'Connect' : 'Next', style: const TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
