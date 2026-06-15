# Graph Report - voice-to-voice  (2026-06-16)

## Corpus Check
- 399 files · ~1,175,014 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2845 nodes · 7447 edges · 54 communities detected
- Extraction: 70% EXTRACTED · 30% INFERRED · 0% AMBIGUOUS · INFERRED: 2199 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 117|Community 117]]
- [[_COMMUNITY_Community 177|Community 177]]
- [[_COMMUNITY_Community 178|Community 178]]

## God Nodes (most connected - your core abstractions)
1. `push()` - 200 edges
2. `slice()` - 148 edges
3. `test()` - 78 edges
4. `i()` - 74 edges
5. `stringify()` - 73 edges
6. `tc()` - 54 edges
7. `parse()` - 53 edges
8. `TaskManager` - 46 edges
9. `add()` - 42 edges
10. `toString()` - 38 edges

## Surprising Connections (you probably didn't know these)
- `VoiceClaw Project` --conceptually_related_to--> `VoiceClaw Emblem (Audio Claw Logo)`  [INFERRED]
  README.md → logo.png
- `test()` --calls--> `isSkillRouteBlockedMessage()`  [INFERRED]
  test_api.ts → src\agents\skill-route-guard.ts
- `test()` --calls--> `containsPII()`  [INFERRED]
  test_api.ts → src\services\pii-sanitizer.ts
- `abort` --calls--> `handleStreamingChat()`  [INFERRED]
  client\lib\services\api_service.dart → src\api\server.ts
- `ReplyManager()` --calls--> `assert()`  [INFERRED]
  client\windows\flutter\ephemeral\cpp_client_wrapper\core_implementations.cc → scripts\validate-quality-utils.ts

## Hyperedges (group relationships)
- **Architecture Doc to Orchestration Bridge** — project_architecture_deep_dive, TaskManager, HeartbeatScheduler, ReactAgent [INFERRED 0.85]
- **Digital Pipeline Documentation Chain** — digital_product_pipeline_sop, project_architecture_deep_dive, approval_gates_section [EXTRACTED 0.90]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (423): patch(), _(), a(), aa(), ac(), ad(), af(), ag() (+415 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (236): build, InitScreen, _InitScreenState, initState, LocalVoiceApp, main, MaterialApp, Scaffold (+228 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (60): normalizeOrgAgent(), normalizeOrgAgents(), AgentRegistry, getOrgHeartbeatIntervalMs(), CompanyManager, generateId(), main(), probe() (+52 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (105): getAgentRunStorage(), looksLikeArtifactAuditStamp(), readOrgArtifactAuditStamp(), walkFindStampMd(), BasicAgent, GeneratedPluginRegistrant, -registerWithRegistry, add() (+97 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (98): detectCapabilities(), detectCapabilitiesOffline(), inferFromName(), matchKnown(), probe(), clearAllChatHistory(), createChatSession(), streamTextChat() (+90 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (61): broadcastAdminMessage(), handleClientMessage(), notifyOrchestrationUpdate(), setupAdminRoutes(), setupAdminWebSocket(), AgentEventEmitter, termFreq(), CacheManager (+53 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (66): appendFacts(), buildEvidenceBundle(), extractFactsFromToolOutput(), factsPath(), loadFacts(), verifyFactsAgainstAnswer(), appendJsonl(), EvolutionService (+58 more)

### Community 7 - "Community 7"
Cohesion: 0.02
Nodes (78): flutter(), dispose, ForwardToHandler(), ReplyManager(), ResizeChannel(), SendResponseData(), SetChannelWarnsOnOverflow(), SetMessageHandler() (+70 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (52): ComfyUIClient, countHistoryOutputs(), formatComfyUIErrorBody(), formatNodeValidationErrors(), handleComfyUIWsMessage(), logComfyUIBinaryPreview(), logComfyUIWs(), parseComfyUIBinaryMessage() (+44 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (40): AgentHistoryManager, extractLegacySummaryBody(), isLegacySummaryContent(), messageContentForDisplay(), newSummaryId(), formatDate(), resolveExecutionChatId(), resolveExecutionChatTitle() (+32 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (70): getAgentRunContext(), toTaskArtifactScope(), buildWorkerReadAllowlist(), isReadPathAllowed(), isUnderDir(), listUpstreamDeliverablePaths(), normAbs(), FileManagerSkill (+62 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (49): logAgentRun(), BudgetTracker, main(), pickSectionContent(), readIfExists(), ensureWorkspace(), bootstrap(), buildHtmlDocument() (+41 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (66): detectAwaitingUserInput(), extractUserClarificationQuestion(), hasAwaitingUserLabel(), bm25RankIndices(), tokenize(), buildArtifactRagExcerpt(), extractHeaderExcerpt(), mapReduceUpstreamContext() (+58 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (32): Text, buildChannelReplyFn(), deliverTextAndMedia(), readAttachmentBuffer(), sendDiscordReply(), sendTelegramMedia(), sendTelegramReply(), sendWhatsAppReply() (+24 more)

### Community 14 - "Community 14"
Cohesion: 0.1
Nodes (23): AgentFactory, isGraphRecursionError(), messageContentToString(), resolveSkillToolLimits(), debugLog(), debugLogLlmRequest(), debugLogLlmResponse(), invokeLlmWithDebug() (+15 more)

### Community 15 - "Community 15"
Cohesion: 0.16
Nodes (30): doDelete(), doRegenerate(), doStatus(), openItem(), saveDraft(), appendNote(), assertSafeName(), checkCreatorConflicts() (+22 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (25): linkDensity(), stripMarkdownBoilerplate(), assert(), main(), testBoilerplateStrip(), testRrf(), testShellGate(), classifyUrlForFetch() (+17 more)

### Community 17 - "Community 17"
Cohesion: 0.16
Nodes (20): findTaskIdByRef(), looksLikeTaskId(), normalizeBlockedByIds(), pruneStaleBlockedByIds(), findTaskIdByTitleRef(), getMostRecentSiblingId(), resolveBlockedByRefs(), makeTask() (+12 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (8): BrowserControllerSkill, parseToolLimitsFromManifest(), SkillLoader, parseFieldSpec(), parseItemSchema(), parseStructuredOutputFromManifest(), resolveToolsByIds(), WebResearcherSkill

### Community 19 - "Community 19"
Cohesion: 0.14
Nodes (13): isConnected, getDefaultTestRecipient(), capitalizeType(), handleResetWhatsApp(), handleSaveCredentials(), handleShowWhatsAppQr(), handleToggle(), openChannelTest() (+5 more)

### Community 20 - "Community 20"
Cohesion: 0.15
Nodes (2): MemoryPanel(), useMemory()

### Community 22 - "Community 22"
Cohesion: 0.2
Nodes (9): AgentConfig, AppConfig, CacheConfig, LearningConfig, LlmConfig, MemoryConfig, SttConfig, TtsConfig (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.36
Nodes (7): AgentBodyValidationError, listCapabilitySkills(), parseCreateAgentBody(), parsePermissionsPatch(), parseSkillsArray(), parseUpdateAgentBody(), validateSkillIds()

### Community 24 - "Community 24"
Cohesion: 0.25
Nodes (4): AgentCard(), StatCard(), formatDuration(), formatNumber()

### Community 25 - "Community 25"
Cohesion: 0.29
Nodes (1): AudioQueuePlayer

### Community 26 - "Community 26"
Cohesion: 0.29
Nodes (2): AppDelegate, FlutterAppDelegate

### Community 27 - "Community 27"
Cohesion: 0.29
Nodes (6): _addAttachment, _extensionFromUrl, filenameFromUrl, isMarkdownImageUrl, MediaAttachment, normalizeMediaUrl

### Community 28 - "Community 28"
Cohesion: 0.29
Nodes (3): # TODO: Replace with actual Qwen-TTS generation, SynthesizeRequest, BaseModel

### Community 29 - "Community 29"
Cohesion: 0.33
Nodes (3): permissionsForRole(), emptyForm(), handleCreate()

### Community 30 - "Community 30"
Cohesion: 0.29
Nodes (7): Rolling Vision Context Manager, Bidirectional Channel Integrations, VoiceClaw Emblem (Audio Claw Logo), Hierarchical Multi-Agent Graph, Model Context Protocol Modular Architecture, VoiceClaw Project, Reference Repositories

### Community 31 - "Community 31"
Cohesion: 0.33
Nodes (5): copyWith, ModelAuth, ModelCapabilities, ModelConfig, ProviderInfo

### Community 32 - "Community 32"
Cohesion: 0.4
Nodes (2): cn(), tabButtonClass()

### Community 33 - "Community 33"
Cohesion: 0.4
Nodes (2): RunnerTests, XCTestCase

### Community 35 - "Community 35"
Cohesion: 0.83
Nodes (3): fetchHtml(), main(), parseAmazonSearchHtml()

### Community 36 - "Community 36"
Cohesion: 0.5
Nodes (1): getTaskStatusHints()

### Community 38 - "Community 38"
Cohesion: 0.83
Nodes (3): handleDelete(), handlePromote(), showToast()

### Community 40 - "Community 40"
Cohesion: 0.5
Nodes (1): MediaKindIcon()

### Community 41 - "Community 41"
Cohesion: 0.83
Nodes (3): getAdb(), getClient(), getDevice()

### Community 42 - "Community 42"
Cohesion: 0.67
Nodes (4): Implementation Playbook, Dependency Rationale, Four-Phase Implementation Roadmap, Resilience-First Design Rationale

### Community 43 - "Community 43"
Cohesion: 0.5
Nodes (4): Human Approval Gates, Digital Product Pipeline SOP, Graphify Knowledge Graph Section, Project Architecture Deep Dive

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (2): flattenCellText(), renderSignalCell()

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (2): executeTemplate(), parseSymbols()

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (2): getClient(), getCollection()

### Community 55 - "Community 55"
Cohesion: 0.67
Nodes (1): AndroidControllerSkill

### Community 56 - "Community 56"
Cohesion: 0.67
Nodes (1): OsControllerSkill

### Community 57 - "Community 57"
Cohesion: 0.67
Nodes (1): OsEnvSkill

### Community 58 - "Community 58"
Cohesion: 0.67
Nodes (1): ScreenReaderSkill

### Community 59 - "Community 59"
Cohesion: 0.67
Nodes (1): ShellSkill

### Community 60 - "Community 60"
Cohesion: 0.67
Nodes (1): VoiceClawFinancialAnalystSkill

### Community 63 - "Community 63"
Cohesion: 0.67
Nodes (3): Context Enrich Engine, Recommended Algorithms and Engines, Research Engine Planner

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (1): MainActivity

### Community 117 - "Community 117"
Cohesion: 1.0
Nodes (2): Macro Bypass Engine, Precision OS Controllers

### Community 177 - "Community 177"
Cohesion: 1.0
Nodes (1): Highly Agentic Target Architecture

### Community 178 - "Community 178"
Cohesion: 1.0
Nodes (1): Architecture Gaps G1-G10

## Knowledge Gaps
- **261 isolated node(s):** `MainActivity`, `Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages.`, `-registerWithRegistry`, `LocalVoiceApp`, `InitScreen` (+256 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 20`** (13 nodes): `MemoryPanel()`, `MemoryPanel.tsx`, `useApi.ts`, `useChannels()`, `useConfig()`, `useLearnedSkills()`, `useMemory()`, `useMetrics()`, `useModels()`, `useModelsAdmin()`, `usePipelines()`, `useSystemInfo()`, `useWorkspace()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (8 nodes): `voiceApi.ts`, `AudioQueuePlayer`, `.abort()`, `.enqueue()`, `.isPlaying()`, `.processQueue()`, `.reset()`, `streamAudioChat()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (7 nodes): `AppDelegate`, `.application()`, `.applicationShouldTerminateAfterLastWindowClosed()`, `.applicationSupportsSecureRestorableState()`, `AppDelegate.swift`, `AppDelegate.swift`, `FlutterAppDelegate`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (6 nodes): `cn()`, `handleSelect()`, `onKeyDown()`, `onPointerDown()`, `tabButtonClass()`, `SettingsTabNav.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (5 nodes): `RunnerTests.swift`, `RunnerTests.swift`, `RunnerTests`, `.testExample()`, `XCTestCase`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (4 nodes): `taskStatusHelpers.ts`, `getRootTaskId()`, `getTaskStatusHints()`, `isPipelineTask()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (4 nodes): `downloadHref()`, `MediaDownloadButton()`, `MediaKindIcon()`, `ChatMediaAttachments.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (3 nodes): `flattenCellText()`, `renderSignalCell()`, `ChatMarkdown.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (3 nodes): `TradingDashboard.tsx`, `executeTemplate()`, `parseSymbols()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (3 nodes): `getClient()`, `getCollection()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (3 nodes): `AndroidControllerSkill`, `.define()`, `android-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (3 nodes): `OsControllerSkill`, `.define()`, `os-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (3 nodes): `OsEnvSkill`, `.define()`, `os-env.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (3 nodes): `ScreenReaderSkill`, `.define()`, `screen-reader.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (3 nodes): `ShellSkill`, `.define()`, `shell-commander.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (3 nodes): `voiceclaw-financial-analyst.ts`, `VoiceClawFinancialAnalystSkill`, `.define()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (2 nodes): `MainActivity.kt`, `MainActivity`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 117`** (2 nodes): `Macro Bypass Engine`, `Precision OS Controllers`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 177`** (1 nodes): `Highly Agentic Target Architecture`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 178`** (1 nodes): `Architecture Gaps G1-G10`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `push()` connect `Community 0` to `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 16`, `Community 17`, `Community 18`, `Community 25`, `Community 35`, `Community 36`, `Community 56`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **Why does `slice()` connect `Community 12` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 13`, `Community 14`, `Community 15`, `Community 16`, `Community 18`, `Community 19`?**
  _High betweenness centrality (0.115) - this node is a cross-community bridge._
- **Why does `Text` connect `Community 13` to `Community 16`, `Community 1`, `Community 11`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Are the 136 inferred relationships involving `push()` (e.g. with `main()` and `parseAmazonSearchHtml()`) actually correct?**
  _`push()` has 136 INFERRED edges - model-reasoned connections that need verification._
- **Are the 105 inferred relationships involving `slice()` (e.g. with `testBing()` and `testGooglethisRaw()`) actually correct?**
  _`slice()` has 105 INFERRED edges - model-reasoned connections that need verification._
- **Are the 77 inferred relationships involving `test()` (e.g. with `.log()` and `.transcribeBuffer()`) actually correct?**
  _`test()` has 77 INFERRED edges - model-reasoned connections that need verification._
- **Are the 61 inferred relationships involving `stringify()` (e.g. with `testGooglethisRaw()` and `broadcastAdminMessage()`) actually correct?**
  _`stringify()` has 61 INFERRED edges - model-reasoned connections that need verification._