import * as fsSync from 'fs';
import * as path from 'path';
import { comfyUIService } from '../services/comfyui-service';

export type MediaKind = 'image' | 'video' | 'pdf' | 'file';

export interface MediaAttachment {
  url: string;
  kind: MediaKind;
  filename: string;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v']);
const PDF_EXTENSIONS = new Set(['.pdf']);

function extensionFromUrl(rawUrl: string): string {
  const withoutQuery = rawUrl.split('?')[0].split('#')[0];
  return path.extname(withoutQuery).toLowerCase();
}

function filenameFromUrl(rawUrl: string): string {
  const withoutQuery = rawUrl.split('?')[0].split('#')[0];
  const parts = withoutQuery.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? 'download';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function classifyMediaUrl(rawUrl: string): MediaKind | null {
  const ext = extensionFromUrl(rawUrl);
  if (!ext) {
    if (rawUrl.includes('/comfyui/outputs/')) return 'image';
    return null;
  }
  if (PDF_EXTENSIONS.has(ext)) return 'pdf';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return null;
}

export function normalizeMediaUrl(raw: string): string {
  const trimmed = raw.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('/comfyui/') || trimmed.startsWith('/workspace/')) return trimmed;
  if (trimmed.startsWith('workspace/')) {
    return `/workspace/download/${trimmed.slice('workspace/'.length)}`;
  }
  return trimmed;
}

function addAttachment(map: Map<string, MediaAttachment>, rawUrl: string): void {
  const url = normalizeMediaUrl(rawUrl);
  if (!url) return;
  const kind = classifyMediaUrl(url);
  if (!kind) return;
  if (map.has(url)) return;
  map.set(url, { url, kind, filename: filenameFromUrl(url) });
}

export function extractMediaAttachments(text: string): MediaAttachment[] {
  if (!text?.trim()) return [];
  const found = new Map<string, MediaAttachment>();

  for (const match of text.matchAll(/\(url:\s*([^)\s]+)\)/gi)) {
    addAttachment(found, match[1]);
  }
  for (const match of text.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)) {
    addAttachment(found, match[1]);
  }
  for (const match of text.matchAll(/\[([^\]]+)]\(([^)]+)\)/g)) {
    addAttachment(found, match[2]);
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    addAttachment(found, match[0]);
  }
  for (const match of text.matchAll(/\/comfyui\/outputs\/[^\s<>"']+/gi)) {
    addAttachment(found, match[0]);
  }
  for (const match of text.matchAll(/\/workspace\/download\/[^\s<>"']+/gi)) {
    addAttachment(found, match[0]);
  }
  for (const match of text.matchAll(/workspace\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|mp4|webm|mov|pdf)/gi)) {
    addAttachment(found, match[0]);
  }

  return Array.from(found.values());
}

export function resolveMediaAttachmentPath(attachment: MediaAttachment, cwd = process.cwd()): string | null {
  const url = attachment.url;
  const comfyMatch = url.match(/\/comfyui\/outputs\/([^/]+)\/([^/?#]+)/);
  if (comfyMatch) {
    return comfyUIService.resolveOutputFilePath(
      decodeURIComponent(comfyMatch[1]),
      decodeURIComponent(comfyMatch[2]),
    );
  }

  const workspaceDownloadMatch = url.match(/\/workspace\/download\/([^?#]+)/);
  if (workspaceDownloadMatch) {
    const rel = decodeURIComponent(workspaceDownloadMatch[1]);
    return resolveWorkspaceRelativePath(rel, cwd);
  }

  if (url.startsWith('workspace/')) {
    return resolveWorkspaceRelativePath(url.slice('workspace/'.length), cwd);
  }

  if (path.isAbsolute(url) && fsSync.existsSync(url)) {
    return url;
  }

  try {
    const parsed = new URL(url);
    const nestedComfy = parsed.pathname.match(/\/comfyui\/outputs\/([^/]+)\/([^/?#]+)/);
    if (nestedComfy) {
      return comfyUIService.resolveOutputFilePath(
        decodeURIComponent(nestedComfy[1]),
        decodeURIComponent(nestedComfy[2]),
      );
    }
    const nestedWorkspace = parsed.pathname.match(/\/workspace\/download\/([^?#]+)/);
    if (nestedWorkspace) {
      return resolveWorkspaceRelativePath(decodeURIComponent(nestedWorkspace[1]), cwd);
    }
  } catch {
    // not a URL
  }

  return null;
}

function resolveWorkspaceRelativePath(relativePath: string, cwd: string): string | null {
  const workspaceRoot = path.join(cwd, 'workspace');
  const fullPath = path.resolve(workspaceRoot, relativePath);
  if (!fullPath.startsWith(workspaceRoot + path.sep) && fullPath !== workspaceRoot) {
    return null;
  }
  if (!fsSync.existsSync(fullPath)) return null;
  return fullPath;
}
