import { Download, FileText, Film, ImageIcon } from 'lucide-react'
import type { MediaAttachment } from '@/lib/mediaAttachments'

interface ChatMediaAttachmentsProps {
  attachments: MediaAttachment[]
}

function downloadHref(url: string): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}download=1`
}

function MediaDownloadButton({ attachment }: { attachment: MediaAttachment }) {
  return (
    <a
      href={downloadHref(attachment.url)}
      download={attachment.filename}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
    >
      <Download className="h-3.5 w-3.5" />
      Download
    </a>
  )
}

function MediaKindIcon({ kind }: { kind: MediaAttachment['kind'] }) {
  if (kind === 'video') return <Film className="h-4 w-4 text-muted-foreground" />
  if (kind === 'pdf') return <FileText className="h-4 w-4 text-muted-foreground" />
  return <ImageIcon className="h-4 w-4 text-muted-foreground" />
}

function MediaAttachmentCard({ attachment }: { attachment: MediaAttachment }) {
  return (
    <div className="chat-media-card">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <MediaKindIcon kind={attachment.kind} />
          <span className="text-sm font-medium truncate">{attachment.filename}</span>
        </div>
        <MediaDownloadButton attachment={attachment} />
      </div>
      {attachment.kind === 'image' && (
        <img
          src={attachment.url}
          alt={attachment.filename}
          className="chat-media-image"
          loading="lazy"
        />
      )}
      {attachment.kind === 'video' && (
        <video src={attachment.url} controls className="chat-media-video" preload="metadata">
          Your browser does not support embedded video.
        </video>
      )}
      {attachment.kind === 'pdf' && (
        <div className="chat-media-pdf">
          <iframe
            src={attachment.url}
            title={attachment.filename}
            className="chat-media-pdf-frame"
          />
        </div>
      )}
    </div>
  )
}

export function ChatMediaAttachments({ attachments }: ChatMediaAttachmentsProps) {
  if (attachments.length === 0) return null
  return (
    <div className="mt-3 flex flex-col gap-3">
      {attachments.map((attachment) => (
        <MediaAttachmentCard key={attachment.url} attachment={attachment} />
      ))}
    </div>
  )
}

export function ChatMediaDownloadLink({ href, filename }: { href?: string; filename?: string }) {
  if (!href) return null
  return (
    <a
      href={downloadHref(href)}
      download={filename}
      target="_blank"
      rel="noopener noreferrer"
      className="chat-media-download-link"
    >
      <Download className="h-3.5 w-3.5" />
      Download
    </a>
  )
}
