export function isChatRoute(pathname: string = window.location.pathname): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  return normalized === '/admin/chat' || normalized === '/chat'
}

export const CHAT_PATH = '/admin/chat'
export const ADMIN_PATH = '/admin/'
