import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:path_provider/path_provider.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../providers/app_state.dart';

import '../services/api_service.dart';
import 'settings_screen.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({Key? key}) : super(key: key);

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> with TickerProviderStateMixin {

  final TextEditingController _textController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final AudioRecorder _audioRecorder = AudioRecorder();
  final AudioPlayer _audioPlayer = AudioPlayer();

  bool _isRecording = false;
  bool _isRecordingStarting = false;
  bool _isProcessing = false;
  String _statusText = '';
  
  // Siri-like features
  double _amplitude = 0.0;
  bool _isWakeWordListening = false;
  DateTime? _lastVoiceActivity;
  StreamSubscription? _amplitudeSub;
  StreamSubscription? _audioPlayerSub;
  late AnimationController _pulseController;
  final SpeechToText _speech = SpeechToText();


  final List<Map<String, String>> _messages = [];
  Timer? _wakeWordTimer;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    );
    _initWakeWord();
  }


  @override
  void dispose() {
    _textController.dispose();
    _scrollController.dispose();
    _audioRecorder.dispose();
    _audioPlayer.dispose();
    _amplitudeSub?.cancel();
    _audioPlayerSub?.cancel();
    _pulseController.dispose();
    super.dispose();
  }


  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _addMessage(String sender, String text) {
    setState(() {
      _messages.add({'sender': sender, 'text': text});
    });
    _scrollToBottom();
  }

  void _updateLastAgentMessage(String text) {
    setState(() {
      for (int i = _messages.length - 1; i >= 0; i--) {
        if (_messages[i]['sender'] == 'Agent') {
          _messages[i] = {'sender': 'Agent', 'text': text};
          break;
        }
      }
    });
    _scrollToBottom();
  }

  Future<void> _handleSSEStream(Stream<SSEEvent> stream) async {
    String agentText = '';
    bool agentMsgAdded = false;

    await for (final event in stream) {
      if (!mounted) return;

      switch (event.type) {
        case 'transcription':
          _addMessage('User', event.data);
          break;

        case 'thinking':
          // Server signals "Generating audio..." via thinking — suppress it here
          // because the status bar already shows it.
          if (event.data != 'Generating audio...') {
            setState(() => _statusText = event.data);
          }
          break;

        case 'tool_call':
          // Clear any partial pre-tool text the agent may have already streamed
          // so only the final clean response appears in the bubble.
          if (agentMsgAdded && agentText.isNotEmpty) {
            agentText = '';
            agentMsgAdded = false;
            // Remove the incomplete agent bubble that held pre-tool tokens
            setState(() {
              for (int i = _messages.length - 1; i >= 0; i--) {
                if (_messages[i]['sender'] == 'Agent') {
                  _messages.removeAt(i);
                  break;
                }
              }
            });
          }
          setState(() => _statusText = 'Using tool: ${event.data}...');
          break;

        case 'token':
          if (!agentMsgAdded) {
            _addMessage('Agent', '');
            agentMsgAdded = true;
          }
          agentText += event.data;
          _updateLastAgentMessage(agentText);
          break;

        case 'text_done':
          if (!agentMsgAdded) {
            _addMessage('Agent', event.data);
            agentMsgAdded = true;
          } else {
            _updateLastAgentMessage(event.data);
          }
          agentText = event.data;
          setState(() => _statusText = 'Generating audio...');
          break;

        case 'audio':
          setState(() => _statusText = '');
          await _playBase64Audio(event.data);
          break;

        case 'error':
          if (!agentMsgAdded) {
            _addMessage('Agent', event.data);
          } else {
            _updateLastAgentMessage(event.data);
          }
          setState(() => _statusText = '');
          break;

        case 'done':
          setState(() => _statusText = '');
          // If auto-listen is enabled, wait for audio to finish then restart mic
          final config = Provider.of<AppState>(context, listen: false).config;
          if (config?.voiceHandling.autoListen == true) {
            _waitForAudioAndRestart();
          }
          break;
      }
    }
  }

  Future<void> _waitForAudioAndRestart() async {
    // Wait for player to become idle
    while (_audioPlayer.state == PlayerState.playing) {
      await Future.delayed(const Duration(milliseconds: 200));
    }
    if (mounted && !_isProcessing && !_isRecording) {
      _startRecording();
    }
  }


  /// Stop an in-progress stream. Aborts the HTTP connection, stops audio,
  /// and resets UI state. The server detects the disconnect and cancels its
  /// own LLM processing via AbortController.
  void _stopProcessing() {
    final appState = Provider.of<AppState>(context, listen: false);
    appState.apiService.abort();
    _audioPlayer.stop();
    if (mounted) {
      setState(() {
        _isProcessing = false;
        _statusText = '';
      });
    }
  }

  Future<void> _initWakeWord() async {
    try {
      bool available = await _speech.initialize(
        onStatus: (status) {
          if (status == 'done' || status == 'notListening') {
            final config = Provider.of<AppState>(context, listen: false).config;
            if (config?.voiceHandling.wakeWordEnabled == true && !_isRecording && !_isProcessing) {
              _startWakeWordListening();
            }
          }
        },
        onError: (error) => debugPrint('STT Error: $error'),
      );
      if (available) {
        _startWakeWordListening();
      }
    } catch (e) {
      debugPrint('STT Init Error: $e');
    }
  }

  void _startWakeWordListening() {
    final config = Provider.of<AppState>(context, listen: false).config;
    if (config?.voiceHandling.wakeWordEnabled != true) return;

    _speech.listen(
      onResult: (result) {
        final name = config?.assistantName.toLowerCase() ?? 'Claw';
        if (result.recognizedWords.toLowerCase().contains(name)) {
          _speech.stop();
          _startRecording();
        }
      },
      listenFor: const Duration(seconds: 30),
      pauseFor: const Duration(seconds: 5),
      partialResults: true,
      cancelOnError: false,
    );

  }


  /// Returns true if [error] was caused by an intentional abort (not a real error).
  bool _isAbortError(Object e) {
    final msg = e.toString().toLowerCase();
    return msg.contains('connection closed') ||
        msg.contains('software caused connection abort') ||
        msg.contains('connection reset') ||
        msg.contains('broken pipe') ||
        msg.contains('clientexception') ||
        msg.contains('socketexception');
  }

  Future<void> _sendText() async {

    if (_textController.text.trim().isEmpty) return;

    final text = _textController.text.trim();
    _textController.clear();
    _addMessage('User', text);

    setState(() => _isProcessing = true);
    try {
      final appState = Provider.of<AppState>(context, listen: false);
      final stream = appState.apiService.streamTextChat(text);
      await _handleSSEStream(stream);
    } catch (e) {
      if (!_isAbortError(e)) _addMessage('System', 'Error: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isProcessing = false;
          _statusText = '';
        });
      }
    }
  }

  Future<void> _toggleRecording() async {
    if (_isRecording) {
      await _stopRecording();
    } else {
      await _startRecording();
    }
  }

  Future<void> _startRecording() async {
    if (_isRecording || _isRecordingStarting) return;
    try {
      _isRecordingStarting = true;
      final config = Provider.of<AppState>(context, listen: false).config;
      
      if (_speech.isListening) await _speech.stop();

      if (await _audioRecorder.hasPermission()) {
        final dir = await getApplicationDocumentsDirectory();
        final filePath = '${dir.path}/temp_record.wav';

        await _audioRecorder.start(
          const RecordConfig(
            encoder: AudioEncoder.wav,
            sampleRate: 16000,
            numChannels: 1,
            autoGain: true,
            echoCancel: true,
            noiseSuppress: true,
          ),
          path: filePath,
        );

        _lastVoiceActivity = DateTime.now();
        _amplitudeSub = _audioRecorder.onAmplitudeChanged(const Duration(milliseconds: 100)).listen((amp) {
          if (!mounted) return;
          setState(() {
            _amplitude = (amp.current + 60).clamp(0, 60) / 60;
          });

          if (config?.voiceHandling.vadEnabled == true) {
            if (amp.current > -25) { 
              _lastVoiceActivity = DateTime.now();
            } else if (_lastVoiceActivity != null) {
              final quietDuration = DateTime.now().difference(_lastVoiceActivity!).inMilliseconds;
              if (quietDuration > 1800) { // 1.8s silence
                _stopRecording();
              }
            }
          }
        });

        if (mounted) {
          setState(() => _isRecording = true);
          _pulseController.repeat(reverse: true);
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
      }
    } finally {
      _isRecordingStarting = false;
    }

  }

  Future<void> _stopRecording() async {
    while (_isRecordingStarting) {
      await Future.delayed(const Duration(milliseconds: 50));
    }

    if (!_isRecording) return;

    try {
      final path = await _audioRecorder.stop();
      _amplitudeSub?.cancel();
      _pulseController.stop();
      
      if (mounted) {
        setState(() {
          _isRecording = false;
          _isProcessing = true;
          _amplitude = 0.0;
        });
      }


      if (path != null) {
        _addMessage('User', '(Voice Message)');
        final appState = Provider.of<AppState>(context, listen: false);
        final stream = appState.apiService.streamAudioChat(path);
        await _handleSSEStream(stream);
      }
    } catch (e) {
      if (!_isAbortError(e)) _addMessage('System', 'Error processing audio: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isProcessing = false;
          _statusText = '';
        });
      }
    }
  }

  Future<void> _playBase64Audio(String base64Data) async {
    try {
      final bytes = base64Decode(base64Data);
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/response_${DateTime.now().millisecondsSinceEpoch}.wav');
      await file.writeAsBytes(bytes);
      await _audioPlayer.play(DeviceFileSource(file.path));
    } catch (e) {
      debugPrint("Error playing audio: $e");
    }
  }

  Future<void> _resetConversation() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New Conversation'),
        content: const Text('Clear the current conversation and start fresh?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Clear')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    final appState = Provider.of<AppState>(context, listen: false);
    await appState.apiService.resetConversation();
    setState(() {
      _messages.clear();
      _statusText = '';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Local Voice AI'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_comment_outlined),
            tooltip: 'New Conversation',
            onPressed: _isProcessing ? null : _resetConversation,
          ),
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (context) => const SettingsScreen()),
            ),
          )
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final msg = _messages[index];
                final isUser = msg['sender'] == 'User';
                final isSystem = msg['sender'] == 'System';
                return Align(
                  alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    padding: const EdgeInsets.all(12),
                    constraints: BoxConstraints(
                      maxWidth: MediaQuery.of(context).size.width * 0.75,
                    ),
                    decoration: BoxDecoration(
                      color: isUser
                          ? Colors.blue[100]
                          : isSystem
                              ? Colors.orange[100]
                              : Colors.grey[200],
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          msg['sender']!,
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 12,
                            color: Colors.grey[600],
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          msg['text'] ?? '',
                          style: const TextStyle(fontSize: 15),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          // Status bar with spinner + stop button
          if (_isProcessing || _statusText.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              color: Colors.grey[100],
              child: Row(
                children: [
                  if (_isProcessing)
                    const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  if (_statusText.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _statusText,
                        style: TextStyle(
                          color: Colors.grey[600],
                          fontSize: 13,
                          fontStyle: FontStyle.italic,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ] else
                    const Spacer(),
                  // Stop button — always visible while processing
                  if (_isProcessing)
                    TextButton.icon(
                      onPressed: _stopProcessing,
                      icon: const Icon(Icons.stop_circle_outlined, size: 18),
                      label: const Text('Stop'),
                      style: TextButton.styleFrom(
                        foregroundColor: Colors.red,
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                    ),
                ],
              ),
            ),
          Container(
            padding: const EdgeInsets.all(8.0),
            decoration: BoxDecoration(
              color: Theme.of(context).scaffoldBackgroundColor,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.05),
                  blurRadius: 4,
                  offset: const Offset(0, -2),
                ),
              ],
            ),
            child: SafeArea(
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _textController,
                      decoration: InputDecoration(
                        hintText: _isProcessing ? 'Tap Stop to cancel...' : 'Type a message...',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(24),
                        ),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      ),
                      onSubmitted: (_) => _isProcessing ? null : _sendText(),
                      enabled: !_isProcessing,
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    icon: const Icon(Icons.send),
                    onPressed: _isProcessing ? null : _sendText,
                    color: Colors.blue,
                  ),
                   GestureDetector(
                    onTap: _isProcessing ? null : _toggleRecording,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        if (_isRecording)
                          AnimatedBuilder(
                            animation: _pulseController,
                            builder: (context, child) {
                              return Container(
                                width: 48 + (32 * _pulseController.value * _amplitude),
                                height: 48 + (32 * _pulseController.value * _amplitude),
                                decoration: BoxDecoration(
                                  color: Colors.red.withOpacity(0.3),
                                  shape: BoxShape.circle,
                                ),
                              );
                            },
                          ),
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: _isRecording ? Colors.red : Colors.blue,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            _isRecording ? Icons.stop : Icons.mic,
                            color: _isProcessing ? Colors.white54 : Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),

                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

