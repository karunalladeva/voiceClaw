# Graph Report - voice-to-voice  (2026-04-25)

## Corpus Check
- 152 files · ~388,633 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 889 nodes · 1243 edges · 42 communities detected
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 265 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 73|Community 73]]

## God Nodes (most connected - your core abstractions)
1. `ReactAgent` - 26 edges
2. `EvolutionService` - 24 edges
3. `ModelRegistry` - 16 edges
4. `ChannelInputManager` - 15 edges
5. `package:flutter/material.dart` - 14 edges
6. `MCPClientManager` - 14 edges
7. `LearningEngine` - 13 edges
8. `handleStreamingChat()` - 13 edges
9. `startServer()` - 13 edges
10. `SkillRegistry` - 12 edges

## Surprising Connections (you probably didn't know these)
- `VoiceClaw Project` --conceptually_related_to--> `VoiceClaw Emblem (Audio Claw Logo)`  [INFERRED]
  README.md → logo.png
- `abort` --calls--> `handleStreamingChat()`  [INFERRED]
  client\lib\services\api_service.dart → src\api\server.ts
- `test()` --calls--> `inferFromName()`  [INFERRED]
  test_api.ts → src\models\capability-detector.ts
- `test()` --calls--> `containsPII()`  [INFERRED]
  test_api.ts → src\services\pii-sanitizer.ts
- `SetNextFrameCallback()` --calls--> `OnCreate()`  [INFERRED]
  client\windows\flutter\ephemeral\cpp_client_wrapper\flutter_engine.cc → client\windows\runner\flutter_window.cpp

## Hyperedges (group relationships)
- **VoiceClaw Core Runtime Loop** — readme_voiceclaw_project, architecture_macro_bypass_engine, readme_hierarchical_multi_agent_graph, architecture_precision_os_controllers, channels_bidirectional_channels [EXTRACTED 0.75]
- **Design To Implementation Trace** — plan_four_phase_roadmap, plan_resilience_first_design_rationale, implementation_execution_playbook, library_dependency_rationale [EXTRACTED 0.75]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (84): build, InitScreen, _InitScreenState, initState, LocalVoiceApp, main, MaterialApp, Scaffold (+76 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (45): dispose, FlutterEngine(), GetRegistrarForPlugin(), RelinquishEngine(), ReloadSystemFonts(), SetNextFrameCallback(), ShutDown(), FlutterViewController() (+37 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (61): _addMessage, build, ChatScreen, _ChatScreenState, Container, dispose, Divider, _handleSSEStream (+53 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (7): LearningEngine, slugify(), ReactAgent, SkillRegistry, addToolSafely(), isValidTool(), loadNativeTools()

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (30): flutter(), ForwardToHandler(), ResizeChannel(), SendResponseData(), SetChannelWarnsOnOverflow(), SetMessageHandler(), flutter(), flutter() (+22 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (18): handleClientMessage(), setupAdminRoutes(), setupAdminWebSocket(), ChannelInputManager, deliverToChannel(), DiscordProvider, EmailProvider, getInputCapableChannels() (+10 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (17): BasicAgent, EvolutionScheduler, getEvolutionConfig(), parseScheduleInterval(), askQuestion(), main(), TTSModule, checkOllama() (+9 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (8): AgentFactory, CacheManager, MemoryStore, RedisStore, ModelRouter, pickFast(), buildAuthHeaders(), createProvider()

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (9): appendJsonl(), EvolutionService, generateId(), hashContent(), shouldSkip(), writeJsonl(), TTSSwitcher, callMarketTool() (+1 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (29): AppState, checkConnection, ChannelProvider, isConnected, loadChannels, build, _buildCardGroup, _buildDropdownBlock (+21 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (27): _ActionBtn, _autoId, build, _CapBadge, Card, Container, dispose, _EmptyView (+19 more)

### Community 11 - "Community 11"
Cohesion: 0.16
Nodes (8): detectCapabilities(), detectCapabilitiesOffline(), inferFromName(), matchKnown(), probe(), buildDefaultModels(), ModelRegistry, main()

### Community 12 - "Community 12"
Cohesion: 0.1
Nodes (19): build, _buildDashboard, _buildModelsTab, _buildReviewQueue, Card, Column, dispose, EvolutionScreen (+11 more)

### Community 13 - "Community 13"
Cohesion: 0.14
Nodes (4): AgentHistoryManager, HistoryProvider, handle_new_rx_page(), Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages.

### Community 14 - "Community 14"
Cohesion: 0.17
Nodes (10): buildFinalTtsText(), handleStreamingChat(), initSSE(), sendSSE(), synthToBuffer(), capSpeechPlain(), extractMinimalSpokenSummary(), selectPlainTextForTts() (+2 more)

### Community 15 - "Community 15"
Cohesion: 0.17
Nodes (2): AgentEventEmitter, ConfigManager

### Community 16 - "Community 16"
Cohesion: 0.23
Nodes (1): MCPClientManager

### Community 17 - "Community 17"
Cohesion: 0.2
Nodes (9): AgentConfig, AppConfig, CacheConfig, LearningConfig, LlmConfig, MemoryConfig, SttConfig, TtsConfig (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.29
Nodes (6): appendHistory(), computeNextRun(), loadHistory(), parseScheduleMs(), runPipeline(), startPipelineTicker()

### Community 19 - "Community 19"
Cohesion: 0.29
Nodes (2): AppDelegate, FlutterAppDelegate

### Community 20 - "Community 20"
Cohesion: 0.38
Nodes (4): ClearPlugins(), GetInstance(), OnRegistrarDestroyed(), PluginRegistrar()

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (3): # TODO: Replace with actual Qwen-TTS generation, SynthesizeRequest, BaseModel

### Community 22 - "Community 22"
Cohesion: 0.29
Nodes (7): Rolling Vision Context Manager, Bidirectional Channel Integrations, VoiceClaw Emblem (Audio Claw Logo), Hierarchical Multi-Agent Graph, Model Context Protocol Modular Architecture, VoiceClaw Project, Reference Repositories

### Community 23 - "Community 23"
Cohesion: 0.33
Nodes (5): copyWith, ModelAuth, ModelCapabilities, ModelConfig, ProviderInfo

### Community 24 - "Community 24"
Cohesion: 0.47
Nodes (5): load_samples(), main(), parse_args(), VoiceClaw Self-Evolution — Unsloth QLoRA Fine-Tuning Script.  This script is spa, Load JSONL training samples and format into Alpaca instruction template.

### Community 26 - "Community 26"
Cohesion: 0.4
Nodes (2): makeTools(), SchedulerSkill

### Community 27 - "Community 27"
Cohesion: 0.4
Nodes (2): GeneratedPluginRegistrant, -registerWithRegistry

### Community 28 - "Community 28"
Cohesion: 0.4
Nodes (2): RunnerTests, XCTestCase

### Community 29 - "Community 29"
Cohesion: 0.83
Nodes (3): getAdb(), getClient(), getDevice()

### Community 30 - "Community 30"
Cohesion: 0.67
Nodes (4): Implementation Playbook, Dependency Rationale, Four-Phase Implementation Roadmap, Resilience-First Design Rationale

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (2): getClient(), getCollection()

### Community 32 - "Community 32"
Cohesion: 0.67
Nodes (1): AndroidControllerSkill

### Community 33 - "Community 33"
Cohesion: 0.67
Nodes (1): BrowserControllerSkill

### Community 34 - "Community 34"
Cohesion: 0.67
Nodes (1): FileManagerSkill

### Community 35 - "Community 35"
Cohesion: 0.67
Nodes (1): OsControllerSkill

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (1): OsEnvSkill

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (1): ScreenReaderSkill

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (1): ShellSkill

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (1): VoiceClawFinancialAnalystSkill

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (2): callChromaTool(), getChromaMcpClient()

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (1): MainActivity

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (2): Macro Bypass Engine, Precision OS Controllers

## Knowledge Gaps
- **234 isolated node(s):** `MainActivity`, `Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages.`, `-registerWithRegistry`, `LocalVoiceApp`, `InitScreen` (+229 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 15`** (17 nodes): `AgentEventEmitter`, `.constructor()`, `.emit()`, `.getActiveAgents()`, `.getAgentTree()`, `.getStats()`, `.updateActiveAgents()`, `.updateStats()`, `.approvePairing()`, `ConfigManager`, `.constructor()`, `.initialize()`, `.saveConfig()`, `.setupWatcher()`, `.updateConfig()`, `agent-events.ts`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (13 nodes): `MCPClientManager`, `.buildZodFromJsonSchema()`, `.callMemoryTool()`, `.deleteMemory()`, `.findMemoryServerId()`, `.formatToolResult()`, `.getStats()`, `.getTools()`, `.isMemoryAvailable()`, `.listMemories()`, `.loadTools()`, `.searchMemory()`, `mcp-client.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (7 nodes): `AppDelegate`, `.application()`, `.applicationShouldTerminateAfterLastWindowClosed()`, `.applicationSupportsSecureRestorableState()`, `AppDelegate.swift`, `AppDelegate.swift`, `FlutterAppDelegate`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (6 nodes): `describeSchedule()`, `makeTools()`, `SchedulerSkill`, `.define()`, `tryParseRRule()`, `scheduler.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (5 nodes): `GeneratedPluginRegistrant.java`, `GeneratedPluginRegistrant.m`, `GeneratedPluginRegistrant`, `.registerWith()`, `-registerWithRegistry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (5 nodes): `RunnerTests.swift`, `RunnerTests.swift`, `RunnerTests`, `.testExample()`, `XCTestCase`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (3 nodes): `getClient()`, `getCollection()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (3 nodes): `AndroidControllerSkill`, `.define()`, `android-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (3 nodes): `BrowserControllerSkill`, `.define()`, `browser-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (3 nodes): `FileManagerSkill`, `.define()`, `file-manager.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (3 nodes): `OsControllerSkill`, `.define()`, `os-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (3 nodes): `OsEnvSkill`, `.define()`, `os-env.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (3 nodes): `ScreenReaderSkill`, `.define()`, `screen-reader.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (3 nodes): `ShellSkill`, `.define()`, `shell-commander.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (3 nodes): `voiceclaw-financial-analyst.ts`, `VoiceClawFinancialAnalystSkill`, `.define()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (3 nodes): `callChromaTool()`, `getChromaMcpClient()`, `finance-memory.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (2 nodes): `MainActivity.kt`, `MainActivity`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (2 nodes): `Macro Bypass Engine`, `Precision OS Controllers`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `handleStreamingChat()` connect `Community 14` to `Community 2`, `Community 3`, `Community 4`, `Community 6`, `Community 7`, `Community 8`, `Community 11`?**
  _High betweenness centrality (0.278) - this node is a cross-community bridge._
- **Why does `abort` connect `Community 2` to `Community 14`?**
  _High betweenness centrality (0.262) - this node is a cross-community bridge._
- **Why does `dart:convert` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **What connects `MainActivity`, `Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages.`, `-registerWithRegistry` to the rest of the system?**
  _234 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._