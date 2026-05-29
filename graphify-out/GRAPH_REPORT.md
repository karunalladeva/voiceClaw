# Graph Report - voice-to-voice  (2026-05-29)

## Corpus Check
- 226 files · ~436,295 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1657 nodes · 4157 edges · 35 communities detected
- Extraction: 83% EXTRACTED · 17% INFERRED · 0% AMBIGUOUS · INFERRED: 692 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 86|Community 86]]

## God Nodes (most connected - your core abstractions)
1. `push()` - 111 edges
2. `i()` - 70 edges
3. `tc()` - 53 edges
4. `slice()` - 53 edges
5. `stringify()` - 40 edges
6. `r()` - 33 edges
7. `mc()` - 33 edges
8. `hc()` - 33 edges
9. `A()` - 30 edges
10. `s()` - 30 edges

## Surprising Connections (you probably didn't know these)
- `VoiceClaw Project` --conceptually_related_to--> `VoiceClaw Emblem (Audio Claw Logo)`  [INFERRED]
  README.md → logo.png
- `test()` --calls--> `containsPII()`  [INFERRED]
  test_api.ts → src\services\pii-sanitizer.ts
- `abort` --calls--> `handleStreamingChat()`  [INFERRED]
  client\lib\services\api_service.dart → src\api\server.ts
- `zt()` --calls--> `test()`  [INFERRED]
  src\admin\public\assets\index-Dusejr1l.js → test_api.ts
- `di()` --calls--> `test()`  [INFERRED]
  src\admin\public\assets\index-Dusejr1l.js → test_api.ts

## Hyperedges (group relationships)
- **VoiceClaw Core Runtime Loop** — readme_voiceclaw_project, architecture_macro_bypass_engine, readme_hierarchical_multi_agent_graph, architecture_precision_os_controllers, channels_bidirectional_channels [EXTRACTED 0.75]
- **Design To Implementation Trace** — plan_four_phase_roadmap, plan_resilience_first_design_rationale, implementation_execution_playbook, library_dependency_rationale [EXTRACTED 0.75]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (314): A(), Aa(), abort(), ac(), af(), ai(), al(), an() (+306 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (221): build, InitScreen, _InitScreenState, initState, LocalVoiceApp, main, MaterialApp, Scaffold (+213 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (36): AgentEventEmitter, AgentFactory, AgentRegistry, BrowserControllerSkill, BudgetTracker, CacheManager, MemoryStore, CompanyManager (+28 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (62): broadcastAdminMessage(), handleClientMessage(), notifyOrchestrationUpdate(), setupAdminRoutes(), setupAdminWebSocket(), ChannelInputManager, deliverToChannel(), DiscordProvider (+54 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (78): flutter(), dispose, ForwardToHandler(), ResizeChannel(), SendResponseData(), SetChannelWarnsOnOverflow(), SetMessageHandler(), flutter() (+70 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (22): AgentHistoryManager, AgentCard(), BasicAgent, HistoryProvider, formatDate(), resolveExecutionChatId(), resolveExecutionChatTitle(), handle_new_rx_page() (+14 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (72): GeneratedPluginRegistrant, -registerWithRegistry, $(), ad(), add(), ap(), at(), Au() (+64 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (31): detectCapabilities(), detectCapabilitiesOffline(), inferFromName(), matchKnown(), probe(), buildUserPrompt(), CreatorPolicyError, CreatorValidationError (+23 more)

### Community 8 - "Community 8"
Cohesion: 0.16
Nodes (30): doDelete(), doRegenerate(), doStatus(), openItem(), saveDraft(), appendNote(), assertSafeName(), checkCreatorConflicts() (+22 more)

### Community 9 - "Community 9"
Cohesion: 0.11
Nodes (11): TTSModule, buildFinalTtsText(), handleStreamingChat(), initSSE(), sendSSE(), synthToBuffer(), capSpeechPlain(), extractMinimalSpokenSummary() (+3 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (7): RedisStore, discard(), disconnectGraph(), stop(), float32ToWavPcm16Mono(), mergeFloat32Chunks(), WavRecorder

### Community 11 - "Community 11"
Cohesion: 0.18
Nodes (2): MemoryPanel(), useMemory()

### Community 12 - "Community 12"
Cohesion: 0.2
Nodes (9): AgentConfig, AppConfig, CacheConfig, LearningConfig, LlmConfig, MemoryConfig, SttConfig, TtsConfig (+1 more)

### Community 14 - "Community 14"
Cohesion: 0.28
Nodes (6): ml(), reset(), ClearPlugins(), GetInstance(), OnRegistrarDestroyed(), PluginRegistrar()

### Community 15 - "Community 15"
Cohesion: 0.29
Nodes (1): AudioQueuePlayer

### Community 16 - "Community 16"
Cohesion: 0.29
Nodes (2): AppDelegate, FlutterAppDelegate

### Community 17 - "Community 17"
Cohesion: 0.29
Nodes (3): # TODO: Replace with actual Qwen-TTS generation, SynthesizeRequest, BaseModel

### Community 18 - "Community 18"
Cohesion: 0.29
Nodes (7): Rolling Vision Context Manager, Bidirectional Channel Integrations, VoiceClaw Emblem (Audio Claw Logo), Hierarchical Multi-Agent Graph, Model Context Protocol Modular Architecture, VoiceClaw Project, Reference Repositories

### Community 19 - "Community 19"
Cohesion: 0.33
Nodes (5): copyWith, ModelAuth, ModelCapabilities, ModelConfig, ProviderInfo

### Community 21 - "Community 21"
Cohesion: 0.47
Nodes (5): load_samples(), main(), parse_args(), VoiceClaw Self-Evolution — Unsloth QLoRA Fine-Tuning Script.  This script is spa, Load JSONL training samples and format into Alpaca instruction template.

### Community 22 - "Community 22"
Cohesion: 0.4
Nodes (2): makeTools(), SchedulerSkill

### Community 23 - "Community 23"
Cohesion: 0.4
Nodes (2): RunnerTests, XCTestCase

### Community 26 - "Community 26"
Cohesion: 0.83
Nodes (3): handleDelete(), handlePromote(), showToast()

### Community 28 - "Community 28"
Cohesion: 0.83
Nodes (3): getAdb(), getClient(), getDevice()

### Community 29 - "Community 29"
Cohesion: 0.67
Nodes (4): Implementation Playbook, Dependency Rationale, Four-Phase Implementation Roadmap, Resilience-First Design Rationale

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (2): executeTemplate(), parseSymbols()

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (2): getClient(), getCollection()

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (1): AndroidControllerSkill

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (1): FileManagerSkill

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (1): OsEnvSkill

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (1): ScreenReaderSkill

### Community 40 - "Community 40"
Cohesion: 0.67
Nodes (1): ShellSkill

### Community 41 - "Community 41"
Cohesion: 0.67
Nodes (1): VoiceClawFinancialAnalystSkill

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (1): MainActivity

### Community 86 - "Community 86"
Cohesion: 1.0
Nodes (2): Macro Bypass Engine, Precision OS Controllers

## Knowledge Gaps
- **233 isolated node(s):** `MainActivity`, `Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages.`, `-registerWithRegistry`, `LocalVoiceApp`, `InitScreen` (+228 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 11`** (11 nodes): `MemoryPanel()`, `MemoryPanel.tsx`, `useApi.ts`, `useConfig()`, `useLearnedSkills()`, `useMemory()`, `useMetrics()`, `useModels()`, `useModelsAdmin()`, `useSystemInfo()`, `useWorkspace()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (8 nodes): `voiceApi.ts`, `AudioQueuePlayer`, `.abort()`, `.enqueue()`, `.isPlaying()`, `.processQueue()`, `.reset()`, `streamAudioChat()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (7 nodes): `AppDelegate`, `.application()`, `.applicationShouldTerminateAfterLastWindowClosed()`, `.applicationSupportsSecureRestorableState()`, `AppDelegate.swift`, `AppDelegate.swift`, `FlutterAppDelegate`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (6 nodes): `describeSchedule()`, `makeTools()`, `SchedulerSkill`, `.define()`, `tryParseRRule()`, `scheduler.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (5 nodes): `RunnerTests.swift`, `RunnerTests.swift`, `RunnerTests`, `.testExample()`, `XCTestCase`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (3 nodes): `TradingDashboard.tsx`, `executeTemplate()`, `parseSymbols()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (3 nodes): `getClient()`, `getCollection()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (3 nodes): `AndroidControllerSkill`, `.define()`, `android-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (3 nodes): `FileManagerSkill`, `.define()`, `file-manager.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (3 nodes): `OsEnvSkill`, `.define()`, `os-env.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (3 nodes): `ScreenReaderSkill`, `.define()`, `screen-reader.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (3 nodes): `ShellSkill`, `.define()`, `shell-commander.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (3 nodes): `voiceclaw-financial-analyst.ts`, `VoiceClawFinancialAnalystSkill`, `.define()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `MainActivity.kt`, `MainActivity`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (2 nodes): `Macro Bypass Engine`, `Precision OS Controllers`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `handleStreamingChat()` connect `Community 9` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 7`?**
  _High betweenness centrality (0.137) - this node is a cross-community bridge._
- **Why does `abort` connect `Community 1` to `Community 9`?**
  _High betweenness centrality (0.123) - this node is a cross-community bridge._
- **Why does `slice()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 8`, `Community 9`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Are the 51 inferred relationships involving `push()` (e.g. with `.emit()` and `.updateActiveAgents()`) actually correct?**
  _`push()` has 51 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `slice()` (e.g. with `.getRecentEvents()` and `.recoverTempFiles()`) actually correct?**
  _`slice()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 31 inferred relationships involving `stringify()` (e.g. with `broadcastAdminMessage()` and `handleClientMessage()`) actually correct?**
  _`stringify()` has 31 INFERRED edges - model-reasoned connections that need verification._
- **What connects `MainActivity`, `Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages.`, `-registerWithRegistry` to the rest of the system?**
  _233 weakly-connected nodes found - possible documentation gaps or missing edges._