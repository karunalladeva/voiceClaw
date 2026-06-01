# Graph Report - voice-to-voice  (2026-06-01)

## Corpus Check
- 307 files · ~988,513 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2333 nodes · 5968 edges · 41 communities detected
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 1423 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 100|Community 100]]

## God Nodes (most connected - your core abstractions)
1. `push()` - 159 edges
2. `slice()` - 90 edges
3. `i()` - 73 edges
4. `stringify()` - 57 edges
5. `test()` - 53 edges
6. `ec()` - 51 edges
7. `TaskManager` - 45 edges
8. `parse()` - 39 edges
9. `nc()` - 38 edges
10. `TaskWorkflowEngine` - 36 edges

## Surprising Connections (you probably didn't know these)
- `VoiceClaw Project` --conceptually_related_to--> `VoiceClaw Emblem (Audio Claw Logo)`  [INFERRED]
  README.md → logo.png
- `test()` --calls--> `containsPII()`  [INFERRED]
  test_api.ts → src\services\pii-sanitizer.ts
- `abort` --calls--> `handleStreamingChat()`  [INFERRED]
  client\lib\services\api_service.dart → src\api\server.ts
- `loadJson()` --calls--> `parse()`  [INFERRED]
  scripts\validate-orchestration-flow.ts → src\admin\public\assets\index-B0KQlHCP.js
- `MediaKindIcon()` --calls--> `If()`  [INFERRED]
  src\admin\app\src\components\chat\ChatMediaAttachments.tsx → src\admin\public\assets\index-B0KQlHCP.js

## Hyperedges (group relationships)
- **VoiceClaw Core Runtime Loop** — readme_voiceclaw_project, architecture_macro_bypass_engine, readme_hierarchical_multi_agent_graph, architecture_precision_os_controllers, channels_bidirectional_channels [EXTRACTED 0.75]
- **Design To Implementation Trace** — plan_four_phase_roadmap, plan_resilience_first_design_rationale, implementation_execution_playbook, library_dependency_rationale [EXTRACTED 0.75]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (404): patch(), _(), a(), aa(), ac(), ad(), add(), af() (+396 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (236): build, InitScreen, _InitScreenState, initState, LocalVoiceApp, main, MaterialApp, Scaffold (+228 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (60): normalizeOrgAgent(), normalizeOrgAgents(), AgentRegistry, getOrgHeartbeatIntervalMs(), CompanyManager, generateId(), askQuestion(), main() (+52 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (89): deliverToChannel(), DiscordProvider, EmailProvider, loadChannels(), loadNotifications(), logChannelEvent(), markNotificationsRead(), PushProvider (+81 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (67): AgentBodyValidationError, listCapabilitySkills(), parseCreateAgentBody(), parsePermissionsPatch(), parseSkillsArray(), parseUpdateAgentBody(), validateSkillIds(), AgentFactory (+59 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (49): handleClientMessage(), AgentEventEmitter, flutter(), CacheManager, MemoryStore, RedisStore, ForwardToHandler(), ResizeChannel() (+41 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (40): AgentHistoryManager, extractLegacySummaryBody(), isLegacySummaryContent(), newSummaryId(), BrowserControllerSkill, HistoryProvider, formatDate(), resolveExecutionChatId() (+32 more)

### Community 7 - "Community 7"
Cohesion: 0.04
Nodes (44): ComfyUIClient, countHistoryOutputs(), formatComfyUIErrorBody(), formatNodeValidationErrors(), handleComfyUIWsMessage(), logComfyUIBinaryPreview(), logComfyUIWs(), parseComfyUIBinaryMessage() (+36 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (29): broadcastAdminMessage(), notifyOrchestrationUpdate(), setupAdminRoutes(), setupAdminWebSocket(), logAgentRun(), BudgetTracker, ChannelInputManager, getInputCapableChannels() (+21 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (27): detectCapabilities(), detectCapabilitiesOffline(), inferFromName(), matchKnown(), probe(), findLocalConfigForModel(), getLocalBaseUrl(), isLocalProvider() (+19 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (46): dispose, FlutterEngine(), GetRegistrarForPlugin(), RelinquishEngine(), ReloadSystemFonts(), SetNextFrameCallback(), ShutDown(), FlutterViewController() (+38 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (44): Text, buildChannelReplyFn(), deliverTextAndMedia(), readAttachmentBuffer(), sendDiscordReply(), sendTelegramMedia(), sendTelegramReply(), sendWhatsAppReply() (+36 more)

### Community 12 - "Community 12"
Cohesion: 0.07
Nodes (43): getAgentRunContext(), toTaskArtifactScope(), collectHistoryOutputs(), isVideoFilename(), Semaphore, FileManagerSkill, resolveReadTarget(), resolveWriteTarget() (+35 more)

### Community 13 - "Community 13"
Cohesion: 0.1
Nodes (44): buildUserPrompt(), CreatorPolicyError, CreatorValidationError, enforcePolicy(), ensureJsonObject(), generateCreatorContent(), getModelIdForAudit(), getSystemPrompt() (+36 more)

### Community 14 - "Community 14"
Cohesion: 0.24
Nodes (9): isConnected, getDefaultTestRecipient(), capitalizeType(), handleResetWhatsApp(), handleSaveCredentials(), handleShowWhatsAppQr(), handleToggle(), openChannelTest() (+1 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (2): MemoryPanel(), useMemory()

### Community 17 - "Community 17"
Cohesion: 0.24
Nodes (5): handleDelete(), handleRun(), handleToggle(), showToast(), togglePipeline()

### Community 18 - "Community 18"
Cohesion: 0.2
Nodes (9): AgentConfig, AppConfig, CacheConfig, LearningConfig, LlmConfig, MemoryConfig, SttConfig, TtsConfig (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.39
Nodes (7): addAttachment(), classifyMediaUrl(), extensionFromUrl(), extractMediaAttachments(), filenameFromUrl(), isMarkdownImageUrl(), normalizeMediaUrl()

### Community 20 - "Community 20"
Cohesion: 0.25
Nodes (4): AgentCard(), StatCard(), formatDuration(), formatNumber()

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (2): AppDelegate, FlutterAppDelegate

### Community 22 - "Community 22"
Cohesion: 0.29
Nodes (6): _addAttachment, _extensionFromUrl, filenameFromUrl, isMarkdownImageUrl, MediaAttachment, normalizeMediaUrl

### Community 23 - "Community 23"
Cohesion: 0.29
Nodes (3): # TODO: Replace with actual Qwen-TTS generation, SynthesizeRequest, BaseModel

### Community 24 - "Community 24"
Cohesion: 0.33
Nodes (3): permissionsForRole(), emptyForm(), handleCreate()

### Community 25 - "Community 25"
Cohesion: 0.29
Nodes (7): Rolling Vision Context Manager, Bidirectional Channel Integrations, VoiceClaw Emblem (Audio Claw Logo), Hierarchical Multi-Agent Graph, Model Context Protocol Modular Architecture, VoiceClaw Project, Reference Repositories

### Community 26 - "Community 26"
Cohesion: 0.33
Nodes (5): copyWith, ModelAuth, ModelCapabilities, ModelConfig, ProviderInfo

### Community 27 - "Community 27"
Cohesion: 0.4
Nodes (2): RunnerTests, XCTestCase

### Community 29 - "Community 29"
Cohesion: 0.5
Nodes (2): GeneratedPluginRegistrant, -registerWithRegistry

### Community 30 - "Community 30"
Cohesion: 0.5
Nodes (1): MediaKindIcon()

### Community 32 - "Community 32"
Cohesion: 0.83
Nodes (3): handleDelete(), handlePromote(), showToast()

### Community 34 - "Community 34"
Cohesion: 0.83
Nodes (3): getAdb(), getClient(), getDevice()

### Community 35 - "Community 35"
Cohesion: 0.67
Nodes (4): Implementation Playbook, Dependency Rationale, Four-Phase Implementation Roadmap, Resilience-First Design Rationale

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (2): executeTemplate(), parseSymbols()

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (2): getClient(), getCollection()

### Community 46 - "Community 46"
Cohesion: 0.67
Nodes (1): AndroidControllerSkill

### Community 47 - "Community 47"
Cohesion: 0.67
Nodes (1): OsEnvSkill

### Community 48 - "Community 48"
Cohesion: 0.67
Nodes (1): ScreenReaderSkill

### Community 49 - "Community 49"
Cohesion: 0.67
Nodes (1): ShellSkill

### Community 50 - "Community 50"
Cohesion: 0.67
Nodes (1): VoiceClawFinancialAnalystSkill

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (1): MainActivity

### Community 100 - "Community 100"
Cohesion: 1.0
Nodes (2): Macro Bypass Engine, Precision OS Controllers

## Knowledge Gaps
- **254 isolated node(s):** `MainActivity`, `Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages.`, `-registerWithRegistry`, `LocalVoiceApp`, `InitScreen` (+249 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 15`** (13 nodes): `MemoryPanel()`, `MemoryPanel.tsx`, `useApi.ts`, `useChannels()`, `useConfig()`, `useLearnedSkills()`, `useMemory()`, `useMetrics()`, `useModels()`, `useModelsAdmin()`, `usePipelines()`, `useSystemInfo()`, `useWorkspace()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (7 nodes): `AppDelegate`, `.application()`, `.applicationShouldTerminateAfterLastWindowClosed()`, `.applicationSupportsSecureRestorableState()`, `AppDelegate.swift`, `AppDelegate.swift`, `FlutterAppDelegate`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (5 nodes): `RunnerTests.swift`, `RunnerTests.swift`, `RunnerTests`, `.testExample()`, `XCTestCase`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (4 nodes): `GeneratedPluginRegistrant.java`, `GeneratedPluginRegistrant.m`, `GeneratedPluginRegistrant`, `-registerWithRegistry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (4 nodes): `downloadHref()`, `MediaDownloadButton()`, `MediaKindIcon()`, `ChatMediaAttachments.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (3 nodes): `TradingDashboard.tsx`, `executeTemplate()`, `parseSymbols()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (3 nodes): `getClient()`, `getCollection()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (3 nodes): `AndroidControllerSkill`, `.define()`, `android-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (3 nodes): `OsEnvSkill`, `.define()`, `os-env.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (3 nodes): `ScreenReaderSkill`, `.define()`, `screen-reader.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (3 nodes): `ShellSkill`, `.define()`, `shell-commander.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (3 nodes): `voiceclaw-financial-analyst.ts`, `VoiceClawFinancialAnalystSkill`, `.define()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (2 nodes): `MainActivity.kt`, `MainActivity`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 100`** (2 nodes): `Macro Bypass Engine`, `Precision OS Controllers`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `push()` connect `Community 6` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 7`, `Community 9`, `Community 11`, `Community 12`, `Community 13`?**
  _High betweenness centrality (0.156) - this node is a cross-community bridge._
- **Why does `handleStreamingChat()` connect `Community 4` to `Community 1`, `Community 2`, `Community 3`, `Community 5`, `Community 8`, `Community 9`, `Community 10`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Why does `slice()` connect `Community 0` to `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 19`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Are the 97 inferred relationships involving `push()` (e.g. with `main()` and `parseAmazonSearchHtml()`) actually correct?**
  _`push()` has 97 INFERRED edges - model-reasoned connections that need verification._
- **Are the 47 inferred relationships involving `slice()` (e.g. with `testBing()` and `testGooglethisRaw()`) actually correct?**
  _`slice()` has 47 INFERRED edges - model-reasoned connections that need verification._
- **Are the 47 inferred relationships involving `stringify()` (e.g. with `testGooglethisRaw()` and `broadcastAdminMessage()`) actually correct?**
  _`stringify()` has 47 INFERRED edges - model-reasoned connections that need verification._
- **Are the 52 inferred relationships involving `test()` (e.g. with `.log()` and `.transcribeBuffer()`) actually correct?**
  _`test()` has 52 INFERRED edges - model-reasoned connections that need verification._