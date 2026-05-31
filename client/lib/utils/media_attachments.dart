enum MediaKind { image, video, pdf, file }

class MediaAttachment {
  final String url;
  final MediaKind kind;
  final String filename;

  const MediaAttachment({
    required this.url,
    required this.kind,
    required this.filename,
  });
}

const Set<String> _imageExtensions = {
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
};

const Set<String> _videoExtensions = {
  '.mp4',
  '.webm',
  '.mov',
  '.mkv',
  '.avi',
  '.m4v',
};

const Set<String> _pdfExtensions = {'.pdf'};

String _extensionFromUrl(String rawUrl) {
  final withoutQuery = rawUrl.split('?').first.split('#').first;
  final index = withoutQuery.lastIndexOf('.');
  if (index < 0) return '';
  return withoutQuery.substring(index).toLowerCase();
}

String filenameFromUrl(String rawUrl) {
  final withoutQuery = rawUrl.split('?').first.split('#').first;
  final parts = withoutQuery.split('/').where((part) => part.isNotEmpty).toList();
  if (parts.isEmpty) return 'download';
  return Uri.decodeComponent(parts.last);
}

MediaKind? classifyMediaUrl(String rawUrl) {
  final ext = _extensionFromUrl(rawUrl);
  if (ext.isEmpty) {
    if (rawUrl.contains('/comfyui/outputs/')) return MediaKind.image;
    return null;
  }
  if (_pdfExtensions.contains(ext)) return MediaKind.pdf;
  if (_videoExtensions.contains(ext)) return MediaKind.video;
  if (_imageExtensions.contains(ext)) return MediaKind.image;
  return null;
}

String normalizeMediaUrl(String raw, {String? baseUrl}) {
  var trimmed = raw.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    trimmed = trimmed.substring(1);
  }
  if (trimmed.endsWith('"') || trimmed.endsWith("'")) {
    trimmed = trimmed.substring(0, trimmed.length - 1);
  }
  if (trimmed.isEmpty) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('/')) {
    if (baseUrl == null || baseUrl.isEmpty) return trimmed;
    return '$baseUrl$trimmed';
  }
  if (trimmed.startsWith('workspace/')) {
    final path = '/workspace/download/${trimmed.substring('workspace/'.length)}';
    if (baseUrl == null || baseUrl.isEmpty) return path;
    return '$baseUrl$path';
  }
  return trimmed;
}

void _addAttachment(Map<String, MediaAttachment> found, String rawUrl, {String? baseUrl}) {
  final url = normalizeMediaUrl(rawUrl, baseUrl: baseUrl);
  if (url.isEmpty) return;
  final kind = classifyMediaUrl(url);
  if (kind == null) return;
  if (found.containsKey(url)) return;
  found[url] = MediaAttachment(url: url, kind: kind, filename: filenameFromUrl(url));
}

List<MediaAttachment> extractMediaAttachments(String text, {String? baseUrl}) {
  if (text.trim().isEmpty) return [];
  final found = <String, MediaAttachment>{};

  for (final RegExpMatch match in RegExp(r'\(url:\s*([^)\s]+)\)', caseSensitive: false).allMatches(text)) {
    _addAttachment(found, match.group(1) ?? '', baseUrl: baseUrl);
  }
  for (final RegExpMatch match in RegExp(r'!\[[^\]]*\]\(([^)]+)\)').allMatches(text)) {
    _addAttachment(found, match.group(1) ?? '', baseUrl: baseUrl);
  }
  for (final RegExpMatch match in RegExp(r'\[([^\]]+)\]\(([^)]+)\)').allMatches(text)) {
    _addAttachment(found, match.group(2) ?? '', baseUrl: baseUrl);
  }
  for (final RegExpMatch match in RegExp(r'https?://[^\s<>"]+').allMatches(text)) {
    _addAttachment(found, match.group(0) ?? '', baseUrl: baseUrl);
  }
  for (final RegExpMatch match in RegExp(r'/comfyui/outputs/[^\s<>"]+').allMatches(text)) {
    _addAttachment(found, match.group(0) ?? '', baseUrl: baseUrl);
  }
  for (final RegExpMatch match in RegExp(r'/workspace/download/[^\s<>"]+').allMatches(text)) {
    _addAttachment(found, match.group(0) ?? '', baseUrl: baseUrl);
  }
  for (final RegExpMatch match in RegExp(
    r'workspace/[^\s<>"]+\.(?:png|jpe?g|gif|webp|mp4|webm|mov|pdf)',
    caseSensitive: false,
  ).allMatches(text)) {
    _addAttachment(found, match.group(0) ?? '', baseUrl: baseUrl);
  }

  return found.values.toList();
}

bool isMarkdownImageUrl(String text, String url) {
  return text.contains('![') && text.contains(']($url)');
}

List<MediaAttachment> attachmentsNotInMarkdown(String text, List<MediaAttachment> attachments) {
  return attachments.where((attachment) => !isMarkdownImageUrl(text, attachment.url)).toList();
}
