# Graph Report - C:\Users\Deva\Documents\Deva\Chennel\voice-to-voice  (2026-06-04)

## Corpus Check
- Large corpus: 549 files · ~1,050,840 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 2740 nodes · 7801 edges · 91 communities detected
- Extraction: 78% EXTRACTED · 22% INFERRED · 0% AMBIGUOUS · INFERRED: 1701 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 25|Community 25]]
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
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 113|Community 113]]
- [[_COMMUNITY_Community 191|Community 191]]
- [[_COMMUNITY_Community 192|Community 192]]

## God Nodes (most connected - your core abstractions)
1. `push()` - 176 edges
2. `slice()` - 109 edges
3. `i()` - 74 edges
4. `test()` - 62 edges
5. `stringify()` - 60 edges
6. `set()` - 58 edges
7. `ec()` - 52 edges
8. `TaskManager` - 46 edges
9. `parse()` - 43 edges
10. `nc()` - 39 edges

## Surprising Connections (you probably didn't know these)
- `VoiceClaw Project` --conceptually_related_to--> `VoiceClaw Emblem (Audio Claw Logo)`  [INFERRED]
  README.md → logo.png
- `test()` --calls--> `testPlaywrightDdg()`  [INFERRED]
  test_api.ts → C:\Users\Deva\Documents\Deva\Chennel\voice-to-voice\scripts\test-search-providers.ts
- `test()` --calls--> `testDdgLite()`  [INFERRED]
  test_api.ts → C:\Users\Deva\Documents\Deva\Chennel\voice-to-voice\scripts\test-search-providers2.ts
- `main()` --calls--> `test()`  [INFERRED]
  C:\Users\Deva\Documents\Deva\Chennel\voice-to-voice\scripts\validate-web-tools.ts → test_api.ts
- `Ot()` --calls--> `test()`  [INFERRED]
  C:\Users\Deva\Documents\Deva\Chennel\voice-to-voice\src\admin\public\assets\index-DQnfYlBZ.js → test_api.ts

## Hyperedges (group relationships)
- **Architecture Doc to Orchestration Bridge** — project_architecture_deep_dive, TaskManager, HeartbeatScheduler, ReactAgent [INFERRED 0.85]
- **Digital Pipeline Documentation Chain** — digital_product_pipeline_sop, project_architecture_deep_dive, approval_gates_section [EXTRACTED 0.90]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (459): patch(), _(), a(), aa(), abort(), ac(), ad(), add() (+451 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (237): build, InitScreen, _InitScreenState, initState, LocalVoiceApp, main, MaterialApp, Scaffold (+229 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (80): AgentFactory, isGraphRecursionError(), messageContentToString(), resolveSkillToolLimits(), getOrgHeartbeatIntervalMs(), getAgentRunContext(), bm25RankIndices(), termFreq() (+72 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (64): normalizeOrgAgent(), normalizeOrgAgents(), AgentRegistry, detectAwaitingUserInput(), extractUserClarificationQuestion(), hasAwaitingUserLabel(), CompanyManager, generateId() (+56 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (59): getAgentRunStorage(), toTaskArtifactScope(), BasicAgent, ComfyUICreatorSkill, rm(), toString(), TTSSwitcher, isInferenceInterruptError() (+51 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (66): clearAllChatHistory(), deleteChat(), fetchChats(), loadChatMessages(), streamTextChat(), ComfyUIClient, countHistoryOutputs(), formatComfyUIErrorBody() (+58 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (53): broadcastAdminMessage(), handleClientMessage(), notifyOrchestrationUpdate(), setupAdminRoutes(), setupAdminWebSocket(), AgentEventEmitter, logAgentRun(), BudgetTracker (+45 more)

### Community 7 - "Community 7"
Cohesion: 0.02
Nodes (76): flutter(), dispose, ForwardToHandler(), ResizeChannel(), SendResponseData(), SetChannelWarnsOnOverflow(), SetMessageHandler(), flutter() (+68 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (53): AgentBodyValidationError, listCapabilitySkills(), parseCreateAgentBody(), parsePermissionsPatch(), parseSkillsArray(), parseUpdateAgentBody(), validateSkillIds(), AgentHistoryManager (+45 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (34): buildLlamacppServerConfig(), checkLlamacppServerReachable(), getLlamacppOpenAiUrl(), getLlamacppServerUrl(), listLlamacppModels(), listLoadedLlamacppModelNames(), loadLlamacppModel(), resolveLlamacppBaseUrl() (+26 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (47): countMarketSymbolsInHumanInput(), joinSections(), orderSectionsForQuery(), packPipelineMarketContext(), resolvePipelineContextBudget(), saveFullPipelineResearchContext(), shrinkSectionForBudget(), splitMarketDataSections() (+39 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (39): FileManagerSkill, filterDeliverablePaths(), resolveReadTarget(), resolveWriteTarget(), basename(), ensureTaskArtifactDirIfNeeded(), formatPdfResult(), resolveOutputPath() (+31 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (47): buildUserPrompt(), CreatorPolicyError, CreatorValidationError, enforcePolicy(), ensureJsonObject(), generateCreatorContent(), getModelIdForAudit(), getSystemPrompt() (+39 more)

### Community 13 - "Community 13"
Cohesion: 0.08
Nodes (35): Text, buildChannelReplyFn(), deliverTextAndMedia(), readAttachmentBuffer(), sendDiscordReply(), sendTelegramMedia(), sendTelegramReply(), sendWhatsAppReply() (+27 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (29): getSearxngBaseUrl(), hitFromUnresponsiveEngines(), invalidateSearxngProbeCache(), isSearxngAvailable(), isSearxngEnabledByConfig(), parsePublishedDate(), parseUnresponsiveEngines(), probeSearxngAvailability() (+21 more)

### Community 15 - "Community 15"
Cohesion: 0.22
Nodes (14): main(), pickSectionContent(), readIfExists(), buildHtmlDocument(), collectMarkdownFiles(), generatePdfFromDirectory(), generatePdfFromFiles(), generatePdfFromMarkdown() (+6 more)

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (11): MemoryPanel(), useChannels(), useConfig(), useLearnedSkills(), useMemory(), useMetrics(), useModels(), useModelsAdmin() (+3 more)

### Community 17 - "Community 17"
Cohesion: 0.3
Nodes (10): getDefaultSettings(), getDefaultTestRecipient(), capitalizeType(), getChannelMeta(), handleResetWhatsApp(), handleSaveCredentials(), handleShowWhatsAppQr(), handleToggle() (+2 more)

### Community 18 - "Community 18"
Cohesion: 0.28
Nodes (9): formatPipelineDate(), formatStepChain(), handleDelete(), handleRun(), handleToggle(), showToast(), addCustomLabel(), removeLabel() (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.28
Nodes (11): useActivity(), useAgentCapabilities(), useAgentRuns(), useApprovals(), useBudget(), useCompanies(), useGoals(), useOrgAgents() (+3 more)

### Community 20 - "Community 20"
Cohesion: 0.22
Nodes (5): AgentCard(), StatCard(), cn(), formatDuration(), formatNumber()

### Community 21 - "Community 21"
Cohesion: 0.2
Nodes (9): AgentConfig, AppConfig, CacheConfig, LearningConfig, LlmConfig, MemoryConfig, SttConfig, TtsConfig (+1 more)

### Community 22 - "Community 22"
Cohesion: 0.49
Nodes (8): addAttachment(), attachmentsNotInMarkdown(), classifyMediaUrl(), extensionFromUrl(), extractMediaAttachments(), filenameFromUrl(), isMarkdownImageUrl(), normalizeMediaUrl()

### Community 23 - "Community 23"
Cohesion: 0.33
Nodes (6): acquirePooledSession(), closePlaywrightPool(), scheduleIdleClose(), withSharedStealthPage(), createStealthSession(), withStealthBrowser()

### Community 24 - "Community 24"
Cohesion: 0.33
Nodes (5): permissionsForRole(), emptyForm(), handleCreate(), handleEdit(), startEdit()

### Community 25 - "Community 25"
Cohesion: 0.28
Nodes (2): AudioQueuePlayer, streamAudioChat()

### Community 26 - "Community 26"
Cohesion: 0.43
Nodes (6): _addAttachment, _extensionFromUrl, filenameFromUrl, isMarkdownImageUrl, MediaAttachment, normalizeMediaUrl

### Community 27 - "Community 27"
Cohesion: 0.29
Nodes (2): getMcpVariant(), getQueueVariant()

### Community 28 - "Community 28"
Cohesion: 0.29
Nodes (2): GeneratedPluginRegistrant, -registerWithRegistry

### Community 29 - "Community 29"
Cohesion: 0.29
Nodes (2): AppDelegate, FlutterAppDelegate

### Community 30 - "Community 30"
Cohesion: 0.38
Nodes (4): ClearPlugins(), GetInstance(), OnRegistrarDestroyed(), PluginRegistrar()

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (3): # TODO: Replace with actual Qwen-TTS generation, SynthesizeRequest, BaseModel

### Community 32 - "Community 32"
Cohesion: 0.29
Nodes (7): Rolling Vision Context Manager, Bidirectional Channel Integrations, VoiceClaw Emblem (Audio Claw Logo), Hierarchical Multi-Agent Graph, Model Context Protocol Modular Architecture, VoiceClaw Project, Reference Repositories

### Community 33 - "Community 33"
Cohesion: 0.33
Nodes (5): copyWith, ModelAuth, ModelCapabilities, ModelConfig, ProviderInfo

### Community 34 - "Community 34"
Cohesion: 0.73
Nodes (4): fetchHtml(), main(), testBing(), testGooglethisRaw()

### Community 35 - "Community 35"
Cohesion: 0.4
Nodes (2): RunnerTests, XCTestCase

### Community 36 - "Community 36"
Cohesion: 0.6
Nodes (3): downloadHref(), MediaDownloadButton(), MediaKindIcon()

### Community 37 - "Community 37"
Cohesion: 0.6
Nodes (3): SettingsCard(), SettingsRow(), SettingsSection()

### Community 38 - "Community 38"
Cohesion: 0.8
Nodes (3): handleDelete(), handlePromote(), showToast()

### Community 39 - "Community 39"
Cohesion: 0.6
Nodes (3): getSpeechRecognition(), matchesWakeWord(), useVoiceChat()

### Community 40 - "Community 40"
Cohesion: 0.83
Nodes (2): flattenCellText(), renderSignalCell()

### Community 41 - "Community 41"
Cohesion: 0.67
Nodes (2): formatAction(), formatTime()

### Community 42 - "Community 42"
Cohesion: 0.67
Nodes (2): AgentProfileFields(), modelHint()

### Community 43 - "Community 43"
Cohesion: 0.67
Nodes (2): getAgentName(), handleCreate()

### Community 44 - "Community 44"
Cohesion: 0.83
Nodes (2): executeTemplate(), parseSymbols()

### Community 45 - "Community 45"
Cohesion: 0.67
Nodes (2): formatSize(), handleDelete()

### Community 46 - "Community 46"
Cohesion: 0.67
Nodes (2): roleToSender(), useChat()

### Community 47 - "Community 47"
Cohesion: 0.67
Nodes (2): parseError(), useComfyUI()

### Community 48 - "Community 48"
Cohesion: 0.67
Nodes (2): parseError(), useLlamaCpp()

### Community 49 - "Community 49"
Cohesion: 0.83
Nodes (2): getClient(), getCollection()

### Community 50 - "Community 50"
Cohesion: 0.5
Nodes (1): ScreenReaderSkill

### Community 51 - "Community 51"
Cohesion: 0.5
Nodes (1): VoiceClawFinancialAnalystSkill

### Community 52 - "Community 52"
Cohesion: 0.83
Nodes (3): getAdb(), getClient(), getDevice()

### Community 53 - "Community 53"
Cohesion: 0.67
Nodes (4): Implementation Playbook, Dependency Rationale, Four-Phase Implementation Roadmap, Resilience-First Design Rationale

### Community 54 - "Community 54"
Cohesion: 0.67
Nodes (2): handleSaveEdits(), runReview()

### Community 55 - "Community 55"
Cohesion: 0.5
Nodes (4): Human Approval Gates, Digital Product Pipeline SOP, Graphify Knowledge Graph Section, Project Architecture Deep Dive

### Community 56 - "Community 56"
Cohesion: 0.67
Nodes (1): adminChatSpaFallback()

### Community 57 - "Community 57"
Cohesion: 0.67
Nodes (1): SystemLogs()

### Community 58 - "Community 58"
Cohesion: 0.67
Nodes (1): handleSubmit()

### Community 59 - "Community 59"
Cohesion: 0.67
Nodes (1): ChatHeader()

### Community 60 - "Community 60"
Cohesion: 0.67
Nodes (1): cn()

### Community 61 - "Community 61"
Cohesion: 0.67
Nodes (1): ApprovalsPanel()

### Community 62 - "Community 62"
Cohesion: 0.67
Nodes (1): handleRequest()

### Community 63 - "Community 63"
Cohesion: 0.67
Nodes (1): ToggleRow()

### Community 64 - "Community 64"
Cohesion: 0.67
Nodes (1): CompanySelector()

### Community 65 - "Community 65"
Cohesion: 0.67
Nodes (1): MarkdownField()

### Community 66 - "Community 66"
Cohesion: 0.67
Nodes (1): handleCreateCompany()

### Community 67 - "Community 67"
Cohesion: 0.67
Nodes (1): runAction()

### Community 68 - "Community 68"
Cohesion: 0.67
Nodes (1): toggle()

### Community 69 - "Community 69"
Cohesion: 0.67
Nodes (1): handleSend()

### Community 70 - "Community 70"
Cohesion: 0.67
Nodes (1): statusBadge()

### Community 71 - "Community 71"
Cohesion: 0.67
Nodes (1): WhatsAppQrDialog()

### Community 72 - "Community 72"
Cohesion: 0.67
Nodes (1): Badge()

### Community 73 - "Community 73"
Cohesion: 0.67
Nodes (1): useOrchestrationLive()

### Community 74 - "Community 74"
Cohesion: 0.67
Nodes (1): useSearxng()

### Community 75 - "Community 75"
Cohesion: 0.67
Nodes (1): useWebSocket()

### Community 76 - "Community 76"
Cohesion: 0.67
Nodes (1): isChatRoute()

### Community 77 - "Community 77"
Cohesion: 0.67
Nodes (1): isPipeClosedError()

### Community 78 - "Community 78"
Cohesion: 0.67
Nodes (1): resolvePeriodStart()

### Community 79 - "Community 79"
Cohesion: 0.67
Nodes (1): ensureWorkspace()

### Community 80 - "Community 80"
Cohesion: 0.67
Nodes (1): AndroidControllerSkill

### Community 81 - "Community 81"
Cohesion: 0.67
Nodes (1): OsEnvSkill

### Community 82 - "Community 82"
Cohesion: 0.67
Nodes (1): ShellSkill

### Community 83 - "Community 83"
Cohesion: 0.67
Nodes (1): formatGenerateResult()

### Community 84 - "Community 84"
Cohesion: 0.67
Nodes (1): getCcxtDisabledMessage()

### Community 87 - "Community 87"
Cohesion: 0.67
Nodes (1): runPowerShell()

### Community 88 - "Community 88"
Cohesion: 0.67
Nodes (3): Context Enrich Engine, Recommended Algorithms and Engines, Research Engine Planner

### Community 89 - "Community 89"
Cohesion: 1.0
Nodes (1): MainActivity

### Community 113 - "Community 113"
Cohesion: 1.0
Nodes (2): Macro Bypass Engine, Precision OS Controllers

### Community 191 - "Community 191"
Cohesion: 1.0
Nodes (1): Highly Agentic Target Architecture

### Community 192 - "Community 192"
Cohesion: 1.0
Nodes (1): Architecture Gaps G1-G10

## Knowledge Gaps
- **163 isolated node(s):** `MainActivity`, `Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages.`, `-registerWithRegistry`, `LocalVoiceApp`, `InitScreen` (+158 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 25`** (9 nodes): `voiceApi.ts`, `voiceApi.ts`, `AudioQueuePlayer`, `.abort()`, `.enqueue()`, `.isPlaying()`, `.processQueue()`, `.reset()`, `streamAudioChat()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (8 nodes): `getMcpVariant()`, `getQueueVariant()`, `App.tsx`, `ChatApp.tsx`, `main.tsx`, `App.tsx`, `ChatApp.tsx`, `main.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (7 nodes): `GeneratedPluginRegistrant.java`, `GeneratedPluginRegistrant.m`, `GeneratedPluginRegistrant.java`, `GeneratedPluginRegistrant.m`, `GeneratedPluginRegistrant`, `.registerWith()`, `-registerWithRegistry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (7 nodes): `AppDelegate`, `.application()`, `.applicationShouldTerminateAfterLastWindowClosed()`, `.applicationSupportsSecureRestorableState()`, `AppDelegate.swift`, `AppDelegate.swift`, `FlutterAppDelegate`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (5 nodes): `RunnerTests.swift`, `RunnerTests.swift`, `RunnerTests`, `.testExample()`, `XCTestCase`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (4 nodes): `ChatMarkdown.tsx`, `flattenCellText()`, `renderSignalCell()`, `ChatMarkdown.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (4 nodes): `formatAction()`, `formatTime()`, `ActivityLog.tsx`, `ActivityLog.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (4 nodes): `AgentProfileFields()`, `modelHint()`, `AgentProfileFields.tsx`, `AgentProfileFields.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (4 nodes): `RoutineList.tsx`, `getAgentName()`, `handleCreate()`, `RoutineList.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (4 nodes): `TradingDashboard.tsx`, `TradingDashboard.tsx`, `executeTemplate()`, `parseSymbols()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (4 nodes): `WorkspacePanel.tsx`, `WorkspacePanel.tsx`, `formatSize()`, `handleDelete()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (4 nodes): `useChat.ts`, `useChat.ts`, `roleToSender()`, `useChat()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (4 nodes): `useComfyUI.ts`, `useComfyUI.ts`, `parseError()`, `useComfyUI()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (4 nodes): `useLlamaCpp.ts`, `useLlamaCpp.ts`, `parseError()`, `useLlamaCpp()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (4 nodes): `index.ts`, `getClient()`, `getCollection()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (4 nodes): `screen-reader.ts`, `ScreenReaderSkill`, `.define()`, `screen-reader.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (4 nodes): `voiceclaw-financial-analyst.ts`, `voiceclaw-financial-analyst.ts`, `VoiceClawFinancialAnalystSkill`, `.define()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (4 nodes): `TaskDetailPanel.tsx`, `TaskDetailPanel.tsx`, `handleSaveEdits()`, `runReview()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (3 nodes): `vite.config.ts`, `vite.config.ts`, `adminChatSpaFallback()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (3 nodes): `SystemLogs.tsx`, `SystemLogs.tsx`, `SystemLogs()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (3 nodes): `ChatDashboard.tsx`, `handleSubmit()`, `ChatDashboard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (3 nodes): `ChatHeader.tsx`, `ChatHeader()`, `ChatHeader.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (3 nodes): `cn()`, `ApprovalRequestList.tsx`, `ApprovalRequestList.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (3 nodes): `ApprovalsPanel()`, `ApprovalsPanel.tsx`, `ApprovalsPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (3 nodes): `handleRequest()`, `BudgetDashboard.tsx`, `BudgetDashboard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (3 nodes): `CompanyPipelineSettings.tsx`, `ToggleRow()`, `CompanyPipelineSettings.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (3 nodes): `CompanySelector.tsx`, `CompanySelector()`, `CompanySelector.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (3 nodes): `MarkdownField.tsx`, `MarkdownField()`, `MarkdownField.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (3 nodes): `OrchestrationDashboard.tsx`, `handleCreateCompany()`, `OrchestrationDashboard.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (3 nodes): `TaskAdminActions.tsx`, `TaskAdminActions.tsx`, `runAction()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (3 nodes): `TaskDependencyPicker.tsx`, `TaskDependencyPicker.tsx`, `toggle()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (3 nodes): `ChannelTestDialog.tsx`, `handleSend()`, `ChannelTestDialog.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (3 nodes): `SearXngPanel.tsx`, `statusBadge()`, `SearXngPanel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (3 nodes): `WhatsAppQrDialog.tsx`, `WhatsAppQrDialog.tsx`, `WhatsAppQrDialog()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (3 nodes): `Badge()`, `badge.tsx`, `badge.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (3 nodes): `useOrchestrationLive.ts`, `useOrchestrationLive.ts`, `useOrchestrationLive()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (3 nodes): `useSearxng.ts`, `useSearxng.ts`, `useSearxng()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (3 nodes): `useWebSocket.ts`, `useWebSocket.ts`, `useWebSocket()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (3 nodes): `routes.ts`, `isChatRoute()`, `routes.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (3 nodes): `stdio-guard.ts`, `stdio-guard.ts`, `isPipeClosedError()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (3 nodes): `index.ts`, `resolvePeriodStart()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (3 nodes): `filesystem.ts`, `ensureWorkspace()`, `filesystem.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (3 nodes): `AndroidControllerSkill`, `.define()`, `android-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (3 nodes): `OsEnvSkill`, `.define()`, `os-env.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (3 nodes): `ShellSkill`, `.define()`, `shell-commander.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (3 nodes): `comfyui.ts`, `formatGenerateResult()`, `comfyui.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (3 nodes): `crypto-ccxt.ts`, `getCcxtDisabledMessage()`, `crypto-ccxt.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (3 nodes): `windows.ts`, `windows.ts`, `runPowerShell()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (2 nodes): `MainActivity.kt`, `MainActivity`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 113`** (2 nodes): `Macro Bypass Engine`, `Precision OS Controllers`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 191`** (1 nodes): `Highly Agentic Target Architecture`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 192`** (1 nodes): `Architecture Gaps G1-G10`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `push()` connect `Community 8` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 25`?**
  _High betweenness centrality (0.141) - this node is a cross-community bridge._
- **Why does `slice()` connect `Community 0` to `Community 2`, `Community 34`, `Community 3`, `Community 5`, `Community 6`, `Community 4`, `Community 8`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 17`, `Community 22`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **Why does `Text` connect `Community 13` to `Community 1`, `Community 10`, `Community 5`, `Community 14`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Are the 113 inferred relationships involving `push()` (e.g. with `main()` and `parseAmazonSearchHtml()`) actually correct?**
  _`push()` has 113 INFERRED edges - model-reasoned connections that need verification._
- **Are the 65 inferred relationships involving `slice()` (e.g. with `testBing()` and `testGooglethisRaw()`) actually correct?**
  _`slice()` has 65 INFERRED edges - model-reasoned connections that need verification._
- **Are the 61 inferred relationships involving `test()` (e.g. with `.log()` and `.transcribeBuffer()`) actually correct?**
  _`test()` has 61 INFERRED edges - model-reasoned connections that need verification._
- **Are the 49 inferred relationships involving `stringify()` (e.g. with `testGooglethisRaw()` and `broadcastAdminMessage()`) actually correct?**
  _`stringify()` has 49 INFERRED edges - model-reasoned connections that need verification._