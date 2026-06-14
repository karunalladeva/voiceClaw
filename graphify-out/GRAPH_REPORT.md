# Graph Report - voice-to-voice  (2026-06-12)

## Corpus Check
- 363 files · ~1,110,203 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2665 nodes · 6945 edges · 49 communities detected
- Extraction: 72% EXTRACTED · 28% INFERRED · 0% AMBIGUOUS · INFERRED: 1942 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 112|Community 112]]
- [[_COMMUNITY_Community 164|Community 164]]
- [[_COMMUNITY_Community 165|Community 165]]

## God Nodes (most connected - your core abstractions)
1. `push()` - 192 edges
2. `slice()` - 136 edges
3. `i()` - 74 edges
4. `test()` - 73 edges
5. `stringify()` - 63 edges
6. `tc()` - 54 edges
7. `TaskManager` - 45 edges
8. `parse()` - 44 edges
9. `add()` - 42 edges
10. `ReactAgent` - 36 edges

## Surprising Connections (you probably didn't know these)
- `VoiceClaw Project` --conceptually_related_to--> `VoiceClaw Emblem (Audio Claw Logo)`  [INFERRED]
  README.md → logo.png
- `test()` --calls--> `isSkillRouteBlockedMessage()`  [INFERRED]
  test_api.ts → src\agents\skill-route-guard.ts
- `test()` --calls--> `containsPII()`  [INFERRED]
  test_api.ts → src\services\pii-sanitizer.ts
- `abort` --calls--> `handleStreamingChat()`  [INFERRED]
  client\lib\services\api_service.dart → src\api\server.ts
- `MediaKindIcon()` --calls--> `If()`  [INFERRED]
  src\admin\app\src\components\chat\ChatMediaAttachments.tsx → src\admin\public\assets\index-DdeBQgwV.js

## Hyperedges (group relationships)
- **Architecture Doc to Orchestration Bridge** — project_architecture_deep_dive, TaskManager, HeartbeatScheduler, ReactAgent [INFERRED 0.85]
- **Digital Pipeline Documentation Chain** — digital_product_pipeline_sop, project_architecture_deep_dive, approval_gates_section [EXTRACTED 0.90]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (415): patch(), _(), a(), aa(), abort(), ac(), ad(), af() (+407 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (236): build, InitScreen, _InitScreenState, initState, LocalVoiceApp, main, MaterialApp, Scaffold (+228 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (66): normalizeOrgAgent(), normalizeOrgAgents(), AgentRegistry, getOrgHeartbeatIntervalMs(), detectAwaitingUserInput(), extractUserClarificationQuestion(), hasAwaitingUserLabel(), CompanyManager (+58 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (77): AgentFactory, isGraphRecursionError(), messageContentToString(), resolveSkillToolLimits(), bm25RankIndices(), termFreq(), tokenize(), CacheManager (+69 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (81): AgentHistoryManager, extractLegacySummaryBody(), isLegacySummaryContent(), newSummaryId(), BasicAgent, formatDate(), resolveExecutionChatId(), resolveExecutionChatTitle() (+73 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (105): AgentBodyValidationError, listCapabilitySkills(), parseCreateAgentBody(), parsePermissionsPatch(), parseSkillsArray(), parseUpdateAgentBody(), validateSkillIds(), listUpstreamDeliverablePaths() (+97 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (70): detectCapabilities(), detectCapabilitiesOffline(), inferFromName(), matchKnown(), probe(), clearAllChatHistory(), streamTextChat(), buildUserPrompt() (+62 more)

### Community 7 - "Community 7"
Cohesion: 0.02
Nodes (84): flutter(), dispose, ForwardToHandler(), ReplyManager(), ResizeChannel(), SendResponseData(), SetChannelWarnsOnOverflow(), SetMessageHandler() (+76 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (66): getAgentRunContext(), getAgentRunStorage(), toTaskArtifactScope(), buildWorkerReadAllowlist(), isReadPathAllowed(), isUnderDir(), normAbs(), FileManagerSkill (+58 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (40): saveChannels(), appendJsonl(), EvolutionService, hashContent(), shouldSkip(), writeJsonl(), callChromaTool(), getChromaMcpClient() (+32 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (34): handleClientMessage(), AgentEventEmitter, ChannelInputManager, buildChannelReplyFn(), deliverTextAndMedia(), readAttachmentBuffer(), sendDiscordReply(), sendTelegramMedia() (+26 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (26): broadcastAdminMessage(), notifyOrchestrationUpdate(), setupAdminRoutes(), setupAdminWebSocket(), logAgentRun(), BudgetTracker, refreshCreatorWorkspaceSkills(), registerCreatorSkillReload() (+18 more)

### Community 12 - "Community 12"
Cohesion: 0.07
Nodes (40): main(), pickSectionContent(), readIfExists(), buildHtmlDocument(), collectMarkdownFiles(), generatePdfFromDirectory(), generatePdfFromFiles(), generatePdfFromMarkdown() (+32 more)

### Community 13 - "Community 13"
Cohesion: 0.08
Nodes (23): messageContentForDisplay(), InferenceActivityTracker, TTSModule, ClearPlugins(), GetInstance(), OnRegistrarDestroyed(), PluginRegistrar(), buildFinalTtsText() (+15 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (32): GeneratedPluginRegistrant, -registerWithRegistry, add(), consume(), Qf(), Xf(), buildRoutableCatalog(), catalogFingerprint() (+24 more)

### Community 15 - "Community 15"
Cohesion: 0.16
Nodes (30): doDelete(), doRegenerate(), doStatus(), openItem(), saveDraft(), appendNote(), assertSafeName(), checkCreatorConflicts() (+22 more)

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (16): fromInjectionForm(), handleDelete(), handleExpand(), handleImport(), handlePreviewImport(), handleSave(), handleSaveConfig(), handleUpload() (+8 more)

### Community 17 - "Community 17"
Cohesion: 0.14
Nodes (13): isConnected, getDefaultTestRecipient(), capitalizeType(), handleResetWhatsApp(), handleSaveCredentials(), handleShowWhatsAppQr(), handleToggle(), openChannelTest() (+5 more)

### Community 18 - "Community 18"
Cohesion: 0.15
Nodes (2): MemoryPanel(), useMemory()

### Community 20 - "Community 20"
Cohesion: 0.3
Nodes (10): debugLog(), debugLogLlmRequest(), debugLogLlmResponse(), invokeLlmWithDebug(), isDebugLoggingEnabled(), isLlmIoDebugEnabled(), messageToLogEntry(), truncate() (+2 more)

### Community 21 - "Community 21"
Cohesion: 0.2
Nodes (9): AgentConfig, AppConfig, CacheConfig, LearningConfig, LlmConfig, MemoryConfig, SttConfig, TtsConfig (+1 more)

### Community 22 - "Community 22"
Cohesion: 0.25
Nodes (4): AgentCard(), StatCard(), formatDuration(), formatNumber()

### Community 23 - "Community 23"
Cohesion: 0.29
Nodes (1): AudioQueuePlayer

### Community 24 - "Community 24"
Cohesion: 0.29
Nodes (2): AppDelegate, FlutterAppDelegate

### Community 25 - "Community 25"
Cohesion: 0.29
Nodes (6): _addAttachment, _extensionFromUrl, filenameFromUrl, isMarkdownImageUrl, MediaAttachment, normalizeMediaUrl

### Community 26 - "Community 26"
Cohesion: 0.29
Nodes (3): # TODO: Replace with actual Qwen-TTS generation, SynthesizeRequest, BaseModel

### Community 27 - "Community 27"
Cohesion: 0.33
Nodes (3): permissionsForRole(), emptyForm(), handleCreate()

### Community 28 - "Community 28"
Cohesion: 0.29
Nodes (7): Rolling Vision Context Manager, Bidirectional Channel Integrations, VoiceClaw Emblem (Audio Claw Logo), Hierarchical Multi-Agent Graph, Model Context Protocol Modular Architecture, VoiceClaw Project, Reference Repositories

### Community 29 - "Community 29"
Cohesion: 0.33
Nodes (5): copyWith, ModelAuth, ModelCapabilities, ModelConfig, ProviderInfo

### Community 30 - "Community 30"
Cohesion: 0.4
Nodes (2): cn(), tabButtonClass()

### Community 31 - "Community 31"
Cohesion: 0.4
Nodes (2): RunnerTests, XCTestCase

### Community 33 - "Community 33"
Cohesion: 0.5
Nodes (1): MediaKindIcon()

### Community 35 - "Community 35"
Cohesion: 0.83
Nodes (3): handleDelete(), handlePromote(), showToast()

### Community 37 - "Community 37"
Cohesion: 0.83
Nodes (3): getAdb(), getClient(), getDevice()

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (4): Implementation Playbook, Dependency Rationale, Four-Phase Implementation Roadmap, Resilience-First Design Rationale

### Community 39 - "Community 39"
Cohesion: 0.5
Nodes (4): Human Approval Gates, Digital Product Pipeline SOP, Graphify Knowledge Graph Section, Project Architecture Deep Dive

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (2): flattenCellText(), renderSignalCell()

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (2): executeTemplate(), parseSymbols()

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (2): getClient(), getCollection()

### Community 51 - "Community 51"
Cohesion: 0.67
Nodes (1): AndroidControllerSkill

### Community 52 - "Community 52"
Cohesion: 0.67
Nodes (1): OsEnvSkill

### Community 53 - "Community 53"
Cohesion: 0.67
Nodes (1): ScreenReaderSkill

### Community 54 - "Community 54"
Cohesion: 0.67
Nodes (1): ShellSkill

### Community 55 - "Community 55"
Cohesion: 0.67
Nodes (1): VoiceClawFinancialAnalystSkill

### Community 58 - "Community 58"
Cohesion: 0.67
Nodes (3): Context Enrich Engine, Recommended Algorithms and Engines, Research Engine Planner

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (1): MainActivity

### Community 112 - "Community 112"
Cohesion: 1.0
Nodes (2): Macro Bypass Engine, Precision OS Controllers

### Community 164 - "Community 164"
Cohesion: 1.0
Nodes (1): Highly Agentic Target Architecture

### Community 165 - "Community 165"
Cohesion: 1.0
Nodes (1): Architecture Gaps G1-G10

## Knowledge Gaps
- **261 isolated node(s):** `MainActivity`, `Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages.`, `-registerWithRegistry`, `LocalVoiceApp`, `InitScreen` (+256 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 18`** (13 nodes): `MemoryPanel()`, `MemoryPanel.tsx`, `useApi.ts`, `useChannels()`, `useConfig()`, `useLearnedSkills()`, `useMemory()`, `useMetrics()`, `useModels()`, `useModelsAdmin()`, `usePipelines()`, `useSystemInfo()`, `useWorkspace()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (8 nodes): `voiceApi.ts`, `AudioQueuePlayer`, `.abort()`, `.enqueue()`, `.isPlaying()`, `.processQueue()`, `.reset()`, `streamAudioChat()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (7 nodes): `AppDelegate`, `.application()`, `.applicationShouldTerminateAfterLastWindowClosed()`, `.applicationSupportsSecureRestorableState()`, `AppDelegate.swift`, `AppDelegate.swift`, `FlutterAppDelegate`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (6 nodes): `cn()`, `handleSelect()`, `onKeyDown()`, `onPointerDown()`, `tabButtonClass()`, `SettingsTabNav.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (5 nodes): `RunnerTests.swift`, `RunnerTests.swift`, `RunnerTests`, `.testExample()`, `XCTestCase`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (4 nodes): `downloadHref()`, `MediaDownloadButton()`, `MediaKindIcon()`, `ChatMediaAttachments.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (3 nodes): `flattenCellText()`, `renderSignalCell()`, `ChatMarkdown.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (3 nodes): `TradingDashboard.tsx`, `executeTemplate()`, `parseSymbols()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (3 nodes): `getClient()`, `getCollection()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (3 nodes): `AndroidControllerSkill`, `.define()`, `android-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (3 nodes): `OsEnvSkill`, `.define()`, `os-env.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (3 nodes): `ScreenReaderSkill`, `.define()`, `screen-reader.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (3 nodes): `ShellSkill`, `.define()`, `shell-commander.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (3 nodes): `voiceclaw-financial-analyst.ts`, `VoiceClawFinancialAnalystSkill`, `.define()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (2 nodes): `MainActivity.kt`, `MainActivity`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 112`** (2 nodes): `Macro Bypass Engine`, `Precision OS Controllers`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 164`** (1 nodes): `Highly Agentic Target Architecture`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 165`** (1 nodes): `Architecture Gaps G1-G10`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `push()` connect `Community 5` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 23`?**
  _High betweenness centrality (0.151) - this node is a cross-community bridge._
- **Why does `slice()` connect `Community 5` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 17`, `Community 20`?**
  _High betweenness centrality (0.141) - this node is a cross-community bridge._
- **Why does `Text` connect `Community 5` to `Community 1`, `Community 10`, `Community 12`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Are the 128 inferred relationships involving `push()` (e.g. with `main()` and `parseAmazonSearchHtml()`) actually correct?**
  _`push()` has 128 INFERRED edges - model-reasoned connections that need verification._
- **Are the 92 inferred relationships involving `slice()` (e.g. with `testBing()` and `testGooglethisRaw()`) actually correct?**
  _`slice()` has 92 INFERRED edges - model-reasoned connections that need verification._
- **Are the 72 inferred relationships involving `test()` (e.g. with `.log()` and `.transcribeBuffer()`) actually correct?**
  _`test()` has 72 INFERRED edges - model-reasoned connections that need verification._
- **Are the 52 inferred relationships involving `stringify()` (e.g. with `testGooglethisRaw()` and `broadcastAdminMessage()`) actually correct?**
  _`stringify()` has 52 INFERRED edges - model-reasoned connections that need verification._