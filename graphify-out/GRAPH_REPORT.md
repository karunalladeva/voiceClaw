# Graph Report - voice-to-voice  (2026-05-05)

## Corpus Check
- 196 files · ~412,373 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1432 nodes · 3112 edges · 36 communities detected
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 470 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
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
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 80|Community 80]]

## God Nodes (most connected - your core abstractions)
1. `i()` - 71 edges
2. `mc()` - 44 edges
3. `sc()` - 33 edges
4. `l()` - 32 edges
5. `Rc()` - 31 edges
6. `wd()` - 27 edges
7. `c()` - 26 edges
8. `ReactAgent` - 26 edges
9. `Z()` - 24 edges
10. `EvolutionService` - 24 edges

## Surprising Connections (you probably didn't know these)
- `VoiceClaw Project` --conceptually_related_to--> `VoiceClaw Emblem (Audio Claw Logo)`  [INFERRED]
  README.md → logo.png
- `test()` --calls--> `kt()`  [INFERRED]
  test_api.ts → src\admin\public\assets\index-VXV3z0SW.js
- `test()` --calls--> `qt()`  [INFERRED]
  test_api.ts → src\admin\public\assets\index-VXV3z0SW.js
- `test()` --calls--> `inferFromName()`  [INFERRED]
  test_api.ts → src\models\capability-detector.ts
- `test()` --calls--> `containsPII()`  [INFERRED]
  test_api.ts → src\services\pii-sanitizer.ts

## Hyperedges (group relationships)
- **VoiceClaw Core Runtime Loop** — readme_voiceclaw_project, architecture_macro_bypass_engine, readme_hierarchical_multi_agent_graph, architecture_precision_os_controllers, channels_bidirectional_channels [EXTRACTED 0.75]
- **Design To Implementation Trace** — plan_four_phase_roadmap, plan_resilience_first_design_rationale, implementation_execution_playbook, library_dependency_rationale [EXTRACTED 0.75]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (315): $(), a(), ac(), ad(), ae(), af(), Ai(), al() (+307 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (200): build, InitScreen, _InitScreenState, initState, LocalVoiceApp, main, MaterialApp, Scaffold (+192 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (19): AgentRegistry, BasicAgent, BudgetTracker, CompanyManager, generateId(), askQuestion(), main(), GovernanceEngine (+11 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (37): handleClientMessage(), setupAdminRoutes(), setupAdminWebSocket(), AgentEventEmitter, AgentFactory, CacheManager, MemoryStore, RedisStore (+29 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (19): AgentHistoryManager, HistoryProvider, handle_new_rx_page(), Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages., TTSModule, LearningEngine, slugify(), MCPClientManager (+11 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (67): build, _buildCardGroup, _buildDropdownBlock, _buildNavigationTile, _buildSectionHeader, _buildSliderBlock, _buildSwitchBlock, _buildTextFieldBlock (+59 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (30): flutter(), ForwardToHandler(), ResizeChannel(), SendResponseData(), SetChannelWarnsOnOverflow(), SetMessageHandler(), flutter(), flutter() (+22 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (12): detectCapabilities(), detectCapabilitiesOffline(), inferFromName(), matchKnown(), probe(), buildDefaultModels(), ModelRegistry, ModelRouter (+4 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (8): appendJsonl(), EvolutionService, hashContent(), shouldSkip(), writeJsonl(), TTSSwitcher, callMarketTool(), getMarketMcpClient()

### Community 9 - "Community 9"
Cohesion: 0.25
Nodes (17): bl(), Cl(), dl(), El(), fl(), Il(), Ja(), ml() (+9 more)

### Community 10 - "Community 10"
Cohesion: 0.2
Nodes (9): AgentConfig, AppConfig, CacheConfig, LearningConfig, LlmConfig, MemoryConfig, SttConfig, TtsConfig (+1 more)

### Community 11 - "Community 11"
Cohesion: 0.29
Nodes (6): appendHistory(), computeNextRun(), loadHistory(), parseScheduleMs(), runPipeline(), startPipelineTicker()

### Community 13 - "Community 13"
Cohesion: 0.25
Nodes (4): AgentCard(), StatCard(), formatDuration(), formatNumber()

### Community 14 - "Community 14"
Cohesion: 0.29
Nodes (2): AppDelegate, FlutterAppDelegate

### Community 15 - "Community 15"
Cohesion: 0.38
Nodes (4): ClearPlugins(), GetInstance(), OnRegistrarDestroyed(), PluginRegistrar()

### Community 16 - "Community 16"
Cohesion: 0.29
Nodes (3): # TODO: Replace with actual Qwen-TTS generation, SynthesizeRequest, BaseModel

### Community 17 - "Community 17"
Cohesion: 0.29
Nodes (7): Rolling Vision Context Manager, Bidirectional Channel Integrations, VoiceClaw Emblem (Audio Claw Logo), Hierarchical Multi-Agent Graph, Model Context Protocol Modular Architecture, VoiceClaw Project, Reference Repositories

### Community 18 - "Community 18"
Cohesion: 0.33
Nodes (5): copyWith, ModelAuth, ModelCapabilities, ModelConfig, ProviderInfo

### Community 19 - "Community 19"
Cohesion: 0.47
Nodes (5): load_samples(), main(), parse_args(), VoiceClaw Self-Evolution — Unsloth QLoRA Fine-Tuning Script.  This script is spa, Load JSONL training samples and format into Alpaca instruction template.

### Community 21 - "Community 21"
Cohesion: 0.4
Nodes (2): makeTools(), SchedulerSkill

### Community 22 - "Community 22"
Cohesion: 0.4
Nodes (2): GeneratedPluginRegistrant, -registerWithRegistry

### Community 23 - "Community 23"
Cohesion: 0.4
Nodes (2): RunnerTests, XCTestCase

### Community 27 - "Community 27"
Cohesion: 0.83
Nodes (3): getAdb(), getClient(), getDevice()

### Community 28 - "Community 28"
Cohesion: 0.67
Nodes (4): Implementation Playbook, Dependency Rationale, Four-Phase Implementation Roadmap, Resilience-First Design Rationale

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (2): getClient(), getCollection()

### Community 33 - "Community 33"
Cohesion: 0.67
Nodes (1): AndroidControllerSkill

### Community 34 - "Community 34"
Cohesion: 0.67
Nodes (1): BrowserControllerSkill

### Community 35 - "Community 35"
Cohesion: 0.67
Nodes (1): FileManagerSkill

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (1): OsControllerSkill

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (1): OsEnvSkill

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (1): ScreenReaderSkill

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (1): ShellSkill

### Community 40 - "Community 40"
Cohesion: 0.67
Nodes (1): VoiceClawFinancialAnalystSkill

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (2): callChromaTool(), getChromaMcpClient()

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (1): MainActivity

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (2): Macro Bypass Engine, Precision OS Controllers

## Knowledge Gaps
- **233 isolated node(s):** `MainActivity`, `Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages.`, `-registerWithRegistry`, `LocalVoiceApp`, `InitScreen` (+228 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 14`** (7 nodes): `AppDelegate`, `.application()`, `.applicationShouldTerminateAfterLastWindowClosed()`, `.applicationSupportsSecureRestorableState()`, `AppDelegate.swift`, `AppDelegate.swift`, `FlutterAppDelegate`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (6 nodes): `describeSchedule()`, `makeTools()`, `SchedulerSkill`, `.define()`, `tryParseRRule()`, `scheduler.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (5 nodes): `GeneratedPluginRegistrant.java`, `GeneratedPluginRegistrant.m`, `GeneratedPluginRegistrant`, `.registerWith()`, `-registerWithRegistry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (5 nodes): `RunnerTests.swift`, `RunnerTests.swift`, `RunnerTests`, `.testExample()`, `XCTestCase`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (3 nodes): `getClient()`, `getCollection()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (3 nodes): `AndroidControllerSkill`, `.define()`, `android-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (3 nodes): `BrowserControllerSkill`, `.define()`, `browser-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (3 nodes): `FileManagerSkill`, `.define()`, `file-manager.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (3 nodes): `OsControllerSkill`, `.define()`, `os-controller.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (3 nodes): `OsEnvSkill`, `.define()`, `os-env.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (3 nodes): `ScreenReaderSkill`, `.define()`, `screen-reader.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (3 nodes): `ShellSkill`, `.define()`, `shell-commander.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (3 nodes): `voiceclaw-financial-analyst.ts`, `VoiceClawFinancialAnalystSkill`, `.define()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (3 nodes): `callChromaTool()`, `getChromaMcpClient()`, `finance-memory.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `MainActivity.kt`, `MainActivity`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (2 nodes): `Macro Bypass Engine`, `Precision OS Controllers`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `abort` connect `Community 1` to `Community 9`, `Community 3`?**
  _High betweenness centrality (0.215) - this node is a cross-community bridge._
- **Why does `handleStreamingChat()` connect `Community 3` to `Community 1`, `Community 2`, `Community 4`, `Community 5`, `Community 7`, `Community 8`?**
  _High betweenness centrality (0.209) - this node is a cross-community bridge._
- **Why does `on()` connect `Community 3` to `Community 0`, `Community 8`, `Community 2`, `Community 7`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **What connects `MainActivity`, `Intercept NOTIFY_DEBUGGER_ABOUT_RX_PAGES and touch the pages.`, `-registerWithRegistry` to the rest of the system?**
  _233 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._