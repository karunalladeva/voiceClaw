import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../providers/app_state.dart';
import '../services/api_service.dart';
import 'settings_screen.dart';
import 'channels_screen.dart';
import 'pipelines_screen.dart';
import 'evolution_screen.dart';

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
  bool _isSending = false; // Guard against double-submits
  String _statusText = '';
  
  // Siri-like features
  double _amplitude = 0.0;
  bool _isWakeWordListening = false;
  DateTime? _lastVoiceActivity;
  StreamSubscription? _amplitudeSub;
  StreamSubscription? _audioPlayerSub;
  late AnimationController _pulseController;
  final SpeechToText _speech = SpeechToText();
  Object _currentRequestId = Object();

  List<Map<String, String>> _messages = [];
  Timer? _wakeWordTimer;

  String _currentChatId = 'default';
  List<Map<String, dynamic>> _chatHistoryList = [];

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    );
    _checkMicPermission();
    _loadChats();
    _textController.addListener(() {
      if (mounted) setState(() {});
    });
  }

  Future<void> _checkMicPermission() async {
    final status = await Permission.microphone.request();
    if (status.isGranted) {
      _initWakeWord();
    } else if (status.isPermanentlyDenied) {
      if (mounted) {
        showDialog(
          context: context,
          builder: (_) => AlertDialog(
            title: const Text('Microphone Access Required'),
            content: const Text(
              'VoiceClaw needs microphone access to listen for your voice.\n\nPlease enable it in Settings → Apps → VoiceClaw → Permissions.',
            ),
            actions: [
              TextButton(
                onPressed: () { Navigator.pop(context); openAppSettings(); },
                child: const Text('Open Settings'),
              ),
            ],
          ),
        );
      }
    } else {
      // Denied but not permanently — show a snackbar & still init (may fail gracefully)
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Microphone permission denied. Voice features unavailable.'),
          duration: Duration(seconds: 4),
        ));
      }
      _initWakeWord(); // still try, OS may prompt again
    }
  }

  Future<void> _loadChats() async {
    final appState = Provider.of<AppState>(context, listen: false);
    final list = await appState.apiService.getChats();
    if (mounted) {
      setState(() {
        _chatHistoryList = list;
      });
    }
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

  Future<void> _handleSSEStream(Stream<SSEEvent> stream, Object requestId) async {
    String agentText = '';
    bool agentMsgAdded = false;

    await for (final event in stream) {
      if (!mounted || _currentRequestId != requestId) return;

      switch (event.type) {
        case 'transcription':
          _addMessage('User', event.data);
          break;

        case 'thinking':
          // Server signals audio generation — suppress it gracefully if it's tts noise
          if (!event.data.contains('Generating audio')) {
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
          // Abort any in-progress audio from pre-tool conversational filler
          _audioQueue.clear();
          if (_audioPlayer.state == PlayerState.playing) {
             _audioPlayer.stop();
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
    _audioQueue.clear();
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
        onStatus: (status) async {
          if (status == 'done' || status == 'notListening') {
            await Future.delayed(const Duration(milliseconds: 500));
            if (!mounted) return;
            
            final config = Provider.of<AppState>(context, listen: false).config;
            if (config?.voiceHandling.wakeWordEnabled == true && !_isRecording && !_isRecordingStarting && !_isProcessing) {
              _startWakeWordListening();
            }
          }
        },
        onError: (error) => debugPrint('STT Error: $error'),
      );
      if (available) {
        _startWakeWordListening();
      } else if (mounted) {
        final config = Provider.of<AppState>(context, listen: false).config;
        if (config?.voiceHandling.wakeWordEnabled == true) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text("Warning: Native Speech Recognition is missing/disabled on this OS. Wake Word offline."),
            duration: Duration(seconds: 4),
          ));
        }
      }
    } catch (e) {
      debugPrint('STT Init Error: $e');
    }
  }

  void _startWakeWordListening() {
    final config = Provider.of<AppState>(context, listen: false).config;
    if (config?.voiceHandling.wakeWordEnabled != true || _isRecording || _isRecordingStarting || _isProcessing) return;

    try {
      _speech.listen(
      onResult: (result) {
        final name = config?.assistantName.toLowerCase() ?? 'claw';
        final transcript = result.recognizedWords.toLowerCase();
        
        final isClawFuzzy = name == 'claw' && (
          transcript.contains('claw') || transcript.contains('call') ||
          transcript.contains('cloud') || transcript.contains('clock') ||
          transcript.contains('clark') || transcript.contains('close') ||
          transcript.contains('craw') || transcript.contains('law')
        );

        if (transcript.contains(name) || isClawFuzzy) {
          if (!_isProcessing) {
            _startRecording();
          }
        }
      },
      listenFor: const Duration(seconds: 30),
      pauseFor: const Duration(seconds: 5),
      partialResults: true,
      cancelOnError: false,
    );
    } catch(e) { debugPrint("Wake word error: $e"); }
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
    if (_isSending) return; // Strict lock on double-clicks
    if (_textController.text.trim().isEmpty) return;

    // FULL DUPLEX BARGE-IN for Text: Abort current processing/audio if any
    if (_isProcessing || _audioPlayer.state == PlayerState.playing || _audioQueue.isNotEmpty) {
      _stopProcessing();
      await Future.delayed(const Duration(milliseconds: 100)); // Let state settle
    }

    final text = _textController.text.trim();
    _isSending = true; // Lock immediately before any async work
    
    _textController.clear();
    _addMessage('User', text);

    setState(() {
      _isProcessing = true;
      _isSending = false; // Open for next turn after state is synced
      _currentRequestId = Object();
    });

    try {
      final appState = Provider.of<AppState>(context, listen: false);
      final stream = appState.apiService.streamTextChat(text, _currentChatId);
      await _handleSSEStream(stream, _currentRequestId);
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

  Future<void> _retryLastMessage() async {
    if (_isProcessing || _isSending || _messages.length < 2) return;
    if (_messages.last['sender'] != 'Agent') return;
    // Walk back to find the last user message
    final lastUserMsg = _messages.reversed.firstWhere(
      (m) => m['sender'] == 'User',
      orElse: () => {'text': ''},
    );
    final textToRetry = lastUserMsg['text'] ?? '';
    if (textToRetry.isEmpty || textToRetry == '(Voice Message)') return;

    setState(() {
      // Remove last AI message
      if (_messages.last['sender'] == 'Agent') {
        _messages.removeLast();
      }
      // Remove last User message so it can be re-added naturally by _sendText
      if (_messages.isNotEmpty && _messages.last['sender'] == 'User') {
        _messages.removeLast();
      }
    });

    _textController.text = textToRetry;
    await _sendText();
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
    
    // FULL DUPLEX BARGE-IN: If the AI is talking or thinking, abort the stream 
    // and stop the audio player so the user can immediately interrupt it.
    if (_isProcessing || _audioPlayer.state == PlayerState.playing) {
      _stopProcessing();
    }

    try {
      _isRecordingStarting = true;
      final config = Provider.of<AppState>(context, listen: false).config;
      
      if (_speech.isListening) {
        await _speech.stop();
        // CRITICAL FOR WINDOWS: Wait for the OS to release the hardware microphone lock
        await Future.delayed(const Duration(milliseconds: 600)); 
      }

      if (await _audioRecorder.hasPermission()) {
        final dir = await getApplicationDocumentsDirectory();
        final filePath = '${dir.path}/temp_record.wav';

        await _audioRecorder.start(
          RecordConfig(
            encoder: AudioEncoder.wav,
            sampleRate: 16000,
            numChannels: 1,
            autoGain: !Platform.isWindows,
            echoCancel: !Platform.isWindows,
            noiseSuppress: !Platform.isWindows,
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
            final threshold = Platform.isWindows ? -35.0 : -25.0;
            if (amp.current > threshold) { 
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
          _currentRequestId = Object();
          _amplitude = 0.0;
        });
      }


      if (path != null) {
        _addMessage('User', '(Voice Message)');
        final appState = Provider.of<AppState>(context, listen: false);
        final stream = appState.apiService.streamAudioChat(path, _currentChatId);
        await _handleSSEStream(stream, _currentRequestId);
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

  List<String> _audioQueue = [];
  bool _isPlayingAudioQueue = false;

  Future<void> _playBase64Audio(String base64Data) async {
    _audioQueue.add(base64Data);
    if (!_isPlayingAudioQueue) {
      _processAudioQueue();
    }
  }

  Future<void> _processAudioQueue() async {
    _isPlayingAudioQueue = true;
    while (_audioQueue.isNotEmpty) {
      final base64Data = _audioQueue.removeAt(0);
      try {
        final bytes = base64Decode(base64Data);
        final dir = await getTemporaryDirectory();
        final file = File('${dir.path}/response_${DateTime.now().millisecondsSinceEpoch}.wav');
        await file.writeAsBytes(bytes);
        
        await _audioPlayer.play(DeviceFileSource(file.path));
        
        // Wait for player to finish or get interrupted by Barge-in.
        // Barge-in calls _audioPlayer.stop(), which changes state to stopped and exits this loop.
        while (_audioPlayer.state == PlayerState.playing) {
          await Future.delayed(const Duration(milliseconds: 100));
        }
      } catch (e) {
        debugPrint("Error playing audio chunk: $e");
      }
    }
    _isPlayingAudioQueue = false;
  }

  // ── OpenUI Sidebar / History Methods ──

  Future<void> _switchChat(String id) async {
    final appState = Provider.of<AppState>(context, listen: false);
    setState(() {
      _currentChatId = id;
      _messages.clear();
      _statusText = 'Loading chat...';
    });
    Navigator.pop(context); // close drawer

    final history = await appState.apiService.loadChat(id);
    if (mounted) {
      setState(() {
        _messages = history.map((m) {
          String sender = m['role'] == 'user' ? 'User' : 'Agent';
          if (m['role'] == 'system') sender = 'System';
          return {'sender': sender, 'text': m['content'].toString()};
        }).toList();
        _statusText = '';
      });
      _scrollToBottom();
    }
  }

  Future<void> _newChat() async {
    setState(() {
      _currentChatId = DateTime.now().millisecondsSinceEpoch.toString();
      _messages.clear();
      _statusText = '';
    });
    Navigator.pop(context); // close drawer
    _loadChats();
  }

  Future<void> _deleteChat(String id) async {
    final appState = Provider.of<AppState>(context, listen: false);
    await appState.apiService.deleteChat(id);
    _loadChats();
    if (_currentChatId == id) {
       setState(() {
         _currentChatId = 'default';
         _messages.clear();
       });
    }
  }

  // ── Build UI Methods ──

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: const Text('OpenUI VoiceClaw', style: TextStyle(fontWeight: FontWeight.w600)),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.add_comment_outlined),
            tooltip: 'New Conversation',
            onPressed: _isProcessing ? null : () {
               setState(() {
                 _currentChatId = DateTime.now().millisecondsSinceEpoch.toString();
                 _messages.clear();
               });
            },
          )
        ],
      ),
      drawer: Drawer(
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      backgroundColor: Colors.blueAccent,
                      foregroundColor: Colors.white,
                    ),
                    onPressed: _newChat,
                    icon: const Icon(Icons.add),
                    label: const Text('New Chat', style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView.builder(
                  itemCount: _chatHistoryList.length,
                  itemBuilder: (context, index) {
                    final chat = _chatHistoryList[index];
                    final isSelected = chat['id'] == _currentChatId;
                    return ListTile(
                      selected: isSelected,
                      selectedTileColor: Colors.blue.withOpacity(0.1),
                      title: Text(
                        chat['title'] ?? 'Chat',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontWeight: isSelected ? FontWeight.bold : FontWeight.normal),
                      ),
                      leading: const Icon(Icons.chat_bubble_outline, size: 20),
                      trailing: IconButton(
                        icon: const Icon(Icons.delete_outline, size: 20, color: Colors.grey),
                        onPressed: () => _deleteChat(chat['id']),
                      ),
                      onTap: () => _switchChat(chat['id']),
                    );
                  },
                ),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.auto_awesome),
                title: const Text('Pipelines & Jobs'),
                onTap: () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const PipelinesScreen()));
                },
              ),
              ListTile(
                leading: const Icon(Icons.biotech),
                title: const Text('Evolution'),
                onTap: () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const EvolutionScreen()));
                },
              ),
              ListTile(
                leading: const Icon(Icons.send),
                title: const Text('Channels'),
                onTap: () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const ChannelsScreen()));
                },
              ),
              ListTile(
                leading: const Icon(Icons.settings),
                title: const Text('Admin Panel (Settings)'),
                onTap: () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen()));
                },
              )
            ],
          ),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.symmetric(horizontal: 0, vertical: 16),
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final msg = _messages[index];
                final isUser = msg['sender'] == 'User';
                final isSystem = msg['sender'] == 'System';

                return Container(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
                  decoration: BoxDecoration(
                    color: isUser ? Colors.white : (isSystem ? Colors.orange[50] : const Color(0xFFF7F7F8)),
                    border: Border(
                      bottom: BorderSide(
                        color: Colors.black.withOpacity(0.05),
                        width: 1,
                      ),
                    ),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 30,
                        height: 30,
                        decoration: BoxDecoration(
                          color: isUser ? Colors.blue.shade100 : Colors.teal.shade500,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Icon(
                          isUser ? Icons.person : Icons.smart_toy,
                          size: 20,
                          color: isUser ? Colors.blue.shade700 : Colors.white,
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  msg['sender']!,
                                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                                ),
                                if (index == _messages.length - 1 && msg['sender'] == 'Agent' && !_isProcessing)
                                  IconButton(
                                    icon: const Icon(Icons.refresh, size: 16, color: Colors.grey),
                                    padding: EdgeInsets.zero,
                                    constraints: const BoxConstraints(),
                                    onPressed: _retryLastMessage,
                                    tooltip: 'Retry last message',
                                  ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            if (isUser || isSystem)
                              Text(
                                msg['text'] ?? '',
                                style: const TextStyle(fontSize: 15, height: 1.5, color: Colors.black87),
                              )
                            else
                              MarkdownBody(
                                data: msg['text'] ?? '',
                                selectable: true,
                                styleSheet: MarkdownStyleSheet(
                                  p: const TextStyle(fontSize: 15, height: 1.5, color: Colors.black87),
                                  codeblockPadding: const EdgeInsets.all(12),
                                  codeblockDecoration: BoxDecoration(
                                    color: Colors.grey[200],
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
          
          if (_isProcessing || _statusText.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
              color: const Color(0xFFF7F7F8),
              child: Row(
                children: [
                  if (_isProcessing)
                    const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  if (_statusText.isNotEmpty) ...[
                    const SizedBox(width: 12),
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
          
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.08),
                      blurRadius: 15,
                      offset: const Offset(0, 4),
                    ),
                  ],
                  border: Border.all(color: Colors.grey.shade200),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _textController,
                        minLines: 1,
                        maxLines: 5,
                        decoration: InputDecoration(
                          hintText: _isProcessing ? 'Tap Stop to cancel...' : 'Message VoiceClaw...',
                          border: InputBorder.none,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                        ),
                        onSubmitted: (_) => _isProcessing ? null : _sendText(),
                        enabled: !_isProcessing,
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4, right: 4),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (_textController.text.isNotEmpty || _isProcessing)
                            IconButton(
                              icon: const Icon(Icons.arrow_upward),
                              onPressed: _isProcessing ? null : _sendText,
                              color: Colors.white,
                              style: IconButton.styleFrom(
                                backgroundColor: _isProcessing ? Colors.grey : Colors.black87,
                              ),
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
                                        width: 36 + (20 * _pulseController.value * _amplitude),
                                        height: 36 + (20 * _pulseController.value * _amplitude),
                                        decoration: BoxDecoration(
                                          color: Colors.red.withOpacity(0.3),
                                          shape: BoxShape.circle,
                                        ),
                                      );
                                    },
                                  ),
                                Container(
                                  padding: const EdgeInsets.all(8),
                                  margin: const EdgeInsets.symmetric(horizontal: 4),
                                  decoration: BoxDecoration(
                                    color: _isRecording ? Colors.red : Colors.grey.shade100,
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(
                                    _isRecording ? Icons.stop : Icons.mic_none,
                                    color: _isRecording ? Colors.white : Colors.black87,
                                    size: 22,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
