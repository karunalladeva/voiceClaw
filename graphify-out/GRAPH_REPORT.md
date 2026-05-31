# Graph Report - voice-to-voice  (2026-05-31)

## Corpus Check
- 296 files · ~984,372 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2286 nodes · 5852 edges · 45 communities detected
- Extraction: 77% EXTRACTED · 23% INFERRED · 0% AMBIGUOUS · INFERRED: 1366 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 105|Community 105]]

## God Nodes (most connected - your core abstractions)
1. `push()` - 156 edges
2. `slice()` - 78 edges
3. `i()` - 73 edges
4. `stringify()` - 56 edges
5. `ec()` - 51 edges
6. `test()` - 47 edges
7. `TaskManager` - 45 edges
8. `nc()` - 38 edges
9. `parse()` - 38 edges
10. `TaskWorkflowEngine` - 36 edges

## Surprising Connections (you probably didn't know these)
- `VoiceClaw Project` --conceptually_related_to--> `VoiceClaw Emblem (Audio Claw Logo)`  [INFERRED]
  README.md → logo.png
- `test()` --calls--> `containsPII()`  [INFERRED]
  test_api.ts → src\services\pii-sanitizer.ts
- `loadJson()` --calls--> `parse()`  [INFERRED]
  scripts\validate-orchestration-flow.ts → src\admin\public\assets\index-B0KQlHCP.js
- `MediaKindIcon()` --calls--> `If()`  [INFERRED]
  src\admin\app\src\components\chat\ChatMediaAttachments.tsx → src\admin\public\assets\index-B0KQlHCP.js
- `getTaskStatusHints()` --calls--> `push()`  [INFERRED]
  src\admin\app\src\components\orchestration\taskStatusHelpers.ts → src\admin\public\assets\index-B0KQlHCP.js

## Hyperedges (group relationships)
- **VoiceClaw Core Runtime Loop** — readme_voiceclaw_project, architecture_macro_bypass_engine, readme_hierarchical_multi_agent_graph, architecture_precision_os_controllers, channels_bidirectional_channels [EXTRACTED 0.75]
- **Design To Implementation Trace** — plan_four_phase_roadmap, plan_resilience_first_design_rationale, implementation_execution_playbook, library_dependency_rationale [EXTRACTED 0.75]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (420): patch(), _(), a(), aa(), abort(), ac(), ad(), add() (+412 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (235): build, InitScreen, _InitScreenState, initState, LocalVoiceApp, main, MaterialApp, Scaffold (+227 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (63): normalizeOrgAgent(), normalizeOrgAgents(), AgentRegistry, getOrgHeartbeatIntervalMs(), detectAwaitingUserInput(), extractUserClarificationQuestion(), hasAwaitingUserLabel(), CompanyManager (+55 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (60): AgentBodyValidationError, listCapabilitySkills(), parseCreateAgentBody(), parsePermissionsPatch(), parseSkillsArray(), parseUpdateAgentBody(), validateSkillIds(), AgentFactory (+52 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (71): handleClientMessage(), BudgetTracker, Text, buildChannelReplyFn(), deliverTextAndMedia(), readAttachmentBuffer(), sendDiscordReply(), sendTelegramMedia() (+63 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (50): broadcastAdminMessage(), notifyOrchestrationUpdate(), setupAdminRoutes(), setupAdminWebSocket(), logAgentRun(), abort, detectCapabilities(), detectCapabilitiesOffline() (+42 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (36): ComfyUICreatorSkill, ConfigManager, TTSSwitcher, buildLlamacppServerConfig(), checkLlamacppServerReachable(), getLlamacppOpenAiUrl(), getLlamacppServerUrl(), listLlamacppModels() (+28 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (44): ComfyUIClient, countHistoryOutputs(), formatComfyUIErrorBody(), formatNodeValidationErrors(), handleComfyUIWsMessage(), logComfyUIBinaryPreview(), logComfyUIWs(), parseComfyUIBinaryMessage() (+36 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (44): AgentEventEmitter, flutter(), CacheManager, MemoryStore, RedisStore, ForwardToHandler(), ResizeChannel(), SendResponseData() (+36 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (46): dispose, FlutterEngine(), GetRegistrarForPlugin(), RelinquishEngine(), ReloadSystemFonts(), SetNextFrameCallback(), ShutDown(), FlutterViewController() (+38 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (43): getAgentRunContext(), getAgentRunStorage(), toTaskArtifactScope(), collectHistoryOutputs(), isVideoFilename(), Semaphore, FileManagerSkill, resolveReadTarget() (+35 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (45): buildUserPrompt(), CreatorPolicyError, CreatorValidationError, enforcePolicy(), ensureJsonObject(), generateCreatorContent(), getModelIdForAudit(), getSystemPrompt() (+37 more)

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (21): main(), pickSectionContent(), readIfExists(), buildHtmlDocument(), collectMarkdownFiles(), generatePdfFromDirectory(), generatePdfFromFiles(), generatePdfFromMarkdown() (+13 more)

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (4): BrowserControllerSkill, SkillLoader, resolveToolsByIds(), WebResearcherSkill

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
Cohesion: 0.29
Nodes (1): AudioQueuePlayer

### Community 21 - "Community 21"
Cohesion: 0.32
Nodes (5): reset(), ClearPlugins(), GetInstance(), OnRegistrarDestroyed(), PluginRegistrar()

### Community 22 - "Community 22"
Cohesion: 0.29
Nodes (2): AppDelegate, FlutterAppDelegate

### Community 23 - "Community 23"
Cohesion: 0.29
Nodes (6): _addAttachment, _extensionFromUrl, filenameFromUrl, isMarkdownImageUrl, MediaAttachment, normalizeMediaUrl

### Community 24 - "Community 24"
Cohesion: 0.29
Nodes (3): # TODO: Replace with actual Qwen-TTS generation, SynthesizeRequest, BaseModel

### Community 25 - "Community 25"
Cohesion: 0.33
Nodes (3): permissionsForRole(), emptyForm(), handleCreate()

### Community 26 - "Community 26"
Cohesion: 0.29
Nodes (7): Rolling Vision Context Manager, Bidirectional Channel Integrations, VoiceClaw Emblem (Audio Claw Logo), Hierarchical Multi-Agent Graph, Model Context Protocol Modular Architecture, VoiceClaw Project, Reference Repositories

### Community 27 - "Community 27"
Cohesion: 0.33
Nodes (5): copyWith, ModelAuth, ModelCapabilities, ModelConfig, ProviderInfo

### Community 28 - "Community 28"
Cohesion: 0.4
Nodes (2): RunnerTests, XCTestCase

### Community 30 - "Community 30"
Cohesion: 0.4
Nodes (2): GeneratedPluginRegistrant, -registerWithRegistry

### Community 31 - "Community 31"
Cohesion: 0.5
Nodes (1): MediaKindIcon()

### Community 32 - "Community 32"
Cohesion: 0.5
Nodes (1): getTaskStatusHints()

### Community 34 - "Community 34"
Cohesion: 0.83
Nodes (3): handleDelete(), handlePromote(), showToast()

### Community 36 - "Community 36"
Cohesion: 0.83
Nodes (3): getAdb(), getClient(), getDevice()

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (4): Implementation Playbook, Dependency Rationale, Four-Phase Implementation Roadmap, Resilience-First Design Rationale

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (2): executeTemplate(), parseSymbols()

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (2): getClient(), getCollection()

### Community 48 - "Community 48"
Cohesion: 0.67
Nodes (1): AndroidControllerSkill

### Community 49 - "Community 49"
Cohesion: 0.67
Nodes (1): OsControllerSkill

### Community 50 - "Community 50"
Cohesion: 0.67
Nodes (1): OsEnvSkill

### Community 51 - "Community 51"
Cohesion: 0.67
Nodes (1): ScreenReaderSkill

### Community 52 - "Community 52"
Cohesion: 0.67
Nodes (1): ShellSkill

### Community 53 - "Community 53"
Cohesion: 0.67
Nodes (1): VoiceClawFinancialAnalystSkill

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (1): MainActivity

### Community 93 - "Community 93"
Cohesion: 1.0
Nodes (1): WorkProductAssets()

### Community 105 - "Community 105"
Cohesion: 1.0
Nodes (2): Macro Bypass Engine, Precision OS Controllers

## Knowledge Gaps
- **254 isolated node(s):** `MainActivity`, `Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages.`, `-registerWithRegistry`, `LocalVoiceApp`, `InitScreen` (+249 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 15`** (13 nodes): `MemoryPanel()`, `MemoryPanel.tsx`, `useApi.ts`, `useChannels()`, `useConfig()`, `useLearnedSkills()`, `useMemory()`, `useMetrics()`, `useModels()`, `useModelsAdmin()`, `usePipelines()`, `useSystemInfo()`, `useWorkspace()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (8 nodes): `voiceApi.ts`, `AudioQueuePlayer`, `.abort()`, `.enqueue()`, `.isPlaying()`, `.processQueue()`, `.reset()`, `streamAudioChat()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (7 nodes): `AppDelegate`, `.application()`, `.applicationShouldTerminateAfterLastWindowClosed()`, `.applicationSupportsSecureRestorableState()`, `AppDelegate.swift`, `AppDelegate.swift`, `FlutterAppDelegate`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (5 nodes): `RunnerTests.swift`, `RunnerTests.swift`, `RunnerTests`, `.testExample()`, `XCTestCase`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (5 nodes): `GeneratedPluginRegistrant.java`, `GeneratedPluginRegistrant.m`, `GeneratedPluginRegistrant`, `.registerWith()`, `-registerWithRegistry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (4 nodes): `downloadHref()`, `MediaDownloadButton()`, `MediaKindIcon()`, `ChatMediaAttachments.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (4 nodes): `taskStatusHelpers.ts`, `getRootTaskId()`, `getTaskStatusHints()`, `isPipelineTask()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (3 nodes): `TradingDashboard.tsx`, `executeTemplate()`, `parseSymbols()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (3 nodes): `getClient()`, `getCollection()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (3 nodes): `AndroidControllerSkill`, `.define()`, `android-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (3 nodes): `OsControllerSkill`, `.define()`, `os-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (3 nodes): `OsEnvSkill`, `.define()`, `os-env.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (3 nodes): `ScreenReaderSkill`, `.define()`, `screen-reader.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (3 nodes): `ShellSkill`, `.define()`, `shell-commander.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (3 nodes): `voiceclaw-financial-analyst.ts`, `VoiceClawFinancialAnalystSkill`, `.define()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (2 nodes): `MainActivity.kt`, `MainActivity`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (2 nodes): `WorkProductAssets.tsx`, `WorkProductAssets()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 105`** (2 nodes): `Macro Bypass Engine`, `Precision OS Controllers`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `push()` connect `Community 0` to `Community 32`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 49`, `Community 20`, `Community 93`?**
  _High betweenness centrality (0.145) - this node is a cross-community bridge._
- **Why does `slice()` connect `Community 0` to `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 7`, `Community 10`, `Community 11`, `Community 13`, `Community 14`, `Community 19`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `handleStreamingChat()` connect `Community 5` to `Community 0`, `Community 2`, `Community 3`, `Community 6`, `Community 8`, `Community 9`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **Are the 94 inferred relationships involving `push()` (e.g. with `main()` and `record()`) actually correct?**
  _`push()` has 94 INFERRED edges - model-reasoned connections that need verification._
- **Are the 35 inferred relationships involving `slice()` (e.g. with `.getRecentEvents()` and `capitalizeType()`) actually correct?**
  _`slice()` has 35 INFERRED edges - model-reasoned connections that need verification._
- **Are the 46 inferred relationships involving `stringify()` (e.g. with `broadcastAdminMessage()` and `handleClientMessage()`) actually correct?**
  _`stringify()` has 46 INFERRED edges - model-reasoned connections that need verification._
- **What connects `MainActivity`, `Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages.`, `-registerWithRegistry` to the rest of the system?**
  _254 weakly-connected nodes found - possible documentation gaps or missing edges._