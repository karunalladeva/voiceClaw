import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:path_provider/path_provider.dart';

import '../providers/app_state.dart';
import '../services/api_service.dart';
import 'settings_screen.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({Key? key}) : super(key: key);

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _textController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final AudioRecorder _audioRecorder = AudioRecorder();
  final AudioPlayer _audioPlayer = AudioPlayer();

  bool _isRecording = false;
  bool _isRecordingStarting = false;
  bool _isProcessing = false;
  String _statusText = '';

  final List<Map<String, String>> _messages = [];

  @override
  void dispose() {
    _textController.dispose();
    _scrollController.dispose();
    _audioRecorder.dispose();
    _audioPlayer.dispose();
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
          setState(() => _statusText = event.data);
          break;

        case 'tool_call':
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
          } else {
            _updateLastAgentMessage(event.data);
          }
          agentText = event.data;
          setState(() => _statusText = 'Generating audio...');
          break;

        case 'audio':
          await _playBase64Audio(event.data);
          break;

        case 'error':
          if (!agentMsgAdded) {
            _addMessage('Agent', event.data);
          } else {
            _updateLastAgentMessage(event.data);
          }
          break;

        case 'done':
          setState(() => _statusText = '');
          break;
      }
    }
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
      _addMessage('System', 'Error: $e');
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
        if (mounted) {
          setState(() => _isRecording = true);
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
      if (mounted) {
        setState(() {
          _isRecording = false;
          _isProcessing = true;
        });
      }

      if (path != null) {
        _addMessage('User', '(Voice Message)');
        final appState = Provider.of<AppState>(context, listen: false);
        final stream = appState.apiService.streamAudioChat(path);
        await _handleSSEStream(stream);
      }
    } catch (e) {
      _addMessage('System', 'Error processing audio: $e');
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Local Voice AI'),
        actions: [
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
          if (_isProcessing || _statusText.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: Colors.grey[100],
              child: Row(
                children: [
                  if (_isProcessing)
                    const SizedBox(
                      width: 16,
                      height: 16,
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
                  ],
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
                        hintText: 'Type a message...',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(24),
                        ),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      ),
                      onSubmitted: (_) => _sendText(),
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
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: _isProcessing
                            ? Colors.grey
                            : _isRecording
                                ? Colors.red
                                : Colors.blue,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        _isRecording ? Icons.stop : Icons.mic,
                        color: Colors.white,
                      ),
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

