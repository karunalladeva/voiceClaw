import { DynamicStructuredTool } from '@langchain/core/tools';
import { webSearchTool, webFetchTool } from '../tools/search';
import { yahooNewsTool, yahooOhlcvTool } from '../tools/market-data';
import { financeRecallMarketMemoryTool, financeStoreMarketMemoryTool } from '../tools/finance-memory';
import { comfyuiListWorkflowsTool, comfyuiGenerateTool, comfyuiCheckJobTool } from '../tools/comfyui';
import { pdfGenerateTool, pdfMergeFilesTool, pdfMergePipelineTool } from '../tools/pdf';
import { deliverToChannelTool, listChannelsTool } from '../tools/channel';
import { listFilesTool, readFileTool, writeFileTool } from './file-manager';
import { softenTools } from '../utils/soften-tool-schema';

const toolRegistry: Record<string, DynamicStructuredTool> = {
  web_search: webSearchTool,
  web_fetch: webFetchTool,
  yahoo_news: yahooNewsTool,
  yahoo_ohlcv: yahooOhlcvTool,
  finance_recall_market_memory: financeRecallMarketMemoryTool,
  finance_store_market_memory: financeStoreMarketMemoryTool,
  comfyui_list_workflows: comfyuiListWorkflowsTool,
  comfyui_generate: comfyuiGenerateTool,
  comfyui_check_job: comfyuiCheckJobTool,
  pdf_generate: pdfGenerateTool,
  pdf_merge_files: pdfMergeFilesTool,
  pdf_merge_pipeline: pdfMergePipelineTool,
  read_file: readFileTool,
  write_file: writeFileTool,
  list_files: listFilesTool,
  deliver_to_channel: deliverToChannelTool,
  list_channels: listChannelsTool,
};

export function resolveToolsByIds(ids: string[] = []): DynamicStructuredTool[] {
  const unique = Array.from(new Set(ids));
  return softenTools(unique.map((id: string) => toolRegistry[id]).filter(Boolean));
}

