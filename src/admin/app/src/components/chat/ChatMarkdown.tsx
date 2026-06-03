import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { classifyMediaUrl, filenameFromUrl, normalizeMediaUrl } from '@/lib/mediaAttachments'
import { ChatMediaDownloadLink } from '@/components/chat/ChatMediaAttachments'

interface ChatMarkdownProps {
  content: string
  className?: string
}

function flattenCellText(children: ReactNode): string {
  if (children == null) return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(flattenCellText).join('')
  if (typeof children === 'object' && 'props' in children) {
    return flattenCellText((children as { props?: { children?: ReactNode } }).props?.children)
  }
  return String(children)
}

function renderSignalCell(children: ReactNode): ReactNode {
  const text = flattenCellText(children).trim()
  const match = text.match(/^(STRONG BUY|WEAK BUY|BUY|HOLD|SELL)\b\s*(.*)$/i)
  if (!match) return children

  const signal = match[1].toUpperCase()
  const detail = match[2]?.trim()
  const signalClass =
    signal.includes('BUY')
      ? 'chat-signal-buy'
      : signal === 'HOLD'
        ? 'chat-signal-hold'
        : signal.includes('SELL')
          ? 'chat-signal-sell'
          : ''

  return (
    <>
      <span className={cn('chat-signal-badge', signalClass)}>{signal}</span>
      {detail ? <span className="chat-signal-detail">{detail}</span> : null}
    </>
  )
}

export function ChatMarkdown({ content, className }: ChatMarkdownProps) {
  if (!content) return null

  return (
    <div className={cn('chat-markdown', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const normalizedHref = href ? normalizeMediaUrl(href) : href
            const mediaKind = normalizedHref ? classifyMediaUrl(normalizedHref) : null
            if (mediaKind === 'video') {
              return (
                <figure className="chat-media-card">
                  <video src={normalizedHref} controls className="chat-media-video" preload="metadata">
                    Your browser does not support embedded video.
                  </video>
                  <figcaption className="chat-media-caption">
                    <span>{children}</span>
                    <ChatMediaDownloadLink href={normalizedHref} filename={filenameFromUrl(normalizedHref ?? '')} />
                  </figcaption>
                </figure>
              )
            }
            if (mediaKind === 'pdf') {
              return (
                <figure className="chat-media-card">
                  <iframe src={normalizedHref} title={String(children)} className="chat-media-pdf-frame" />
                  <figcaption className="chat-media-caption">
                    <span>{children}</span>
                    <ChatMediaDownloadLink href={normalizedHref} filename={filenameFromUrl(normalizedHref ?? '')} />
                  </figcaption>
                </figure>
              )
            }
            if (mediaKind === 'image') {
              return (
                <figure className="chat-media-card">
                  <img src={normalizedHref} alt={String(children)} className="chat-media-image" loading="lazy" />
                  <figcaption className="chat-media-caption">
                    <span>{children}</span>
                    <ChatMediaDownloadLink href={normalizedHref} filename={filenameFromUrl(normalizedHref ?? '')} />
                  </figcaption>
                </figure>
              )
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {children}
              </a>
            )
          },
          img: ({ src, alt }) => {
            const normalizedSrc = src ? normalizeMediaUrl(src) : src
            return (
              <figure className="chat-media-card">
                <img src={normalizedSrc} alt={alt ?? 'image'} className="chat-media-image" loading="lazy" />
                <figcaption className="chat-media-caption">
                  <span>{alt ?? filenameFromUrl(normalizedSrc ?? '')}</span>
                  <ChatMediaDownloadLink
                    href={normalizedSrc}
                    filename={filenameFromUrl(normalizedSrc ?? '')}
                  />
                </figcaption>
              </figure>
            )
          },
          pre: ({ children }) => (
            <pre className="chat-code-block">{children}</pre>
          ),
          code: ({ className: codeClass, children, ...props }) => {
            const isBlock = codeClass?.includes('language-')
            if (isBlock) {
              return (
                <code className={codeClass} {...props}>
                  {children}
                </code>
              )
            }
            return (
              <code className="chat-inline-code" {...props}>
                {children}
              </code>
            )
          },
          table: ({ children }) => (
            <div className="chat-table-wrap" role="region" aria-label="Table — scroll horizontally">
              <table>{children}</table>
            </div>
          ),
          td: ({ children }) => <td>{renderSignalCell(children)}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
