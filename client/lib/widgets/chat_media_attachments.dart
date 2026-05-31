import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../utils/media_attachments.dart';

class ChatMediaAttachments extends StatelessWidget {
  final List<MediaAttachment> attachments;

  const ChatMediaAttachments({super.key, required this.attachments});

  @override
  Widget build(BuildContext context) {
    if (attachments.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: attachments.map((attachment) => _MediaAttachmentCard(attachment: attachment)).toList(),
    );
  }
}

class _MediaAttachmentCard extends StatelessWidget {
  final MediaAttachment attachment;

  const _MediaAttachmentCard({required this.attachment});

  Future<void> _openUrl(BuildContext context) async {
    final uri = Uri.tryParse(attachment.url);
    if (uri == null) return;
    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!launched && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open ${attachment.filename}')),
      );
    }
  }

  Future<void> _copyLink(BuildContext context) async {
    await Clipboard.setData(ClipboardData(text: attachment.url));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Link copied: ${attachment.filename}')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final bool canOpenExternally =
        attachment.kind == MediaKind.pdf || attachment.kind == MediaKind.video;
    return Container(
      margin: const EdgeInsets.only(top: 12),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.grey.shade300),
        borderRadius: BorderRadius.circular(10),
        color: Colors.white,
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (attachment.kind == MediaKind.image)
            Image.network(
              attachment.url,
              fit: BoxFit.contain,
              loadingBuilder: (context, child, progress) {
                if (progress == null) return child;
                return const SizedBox(
                  height: 180,
                  child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
                );
              },
              errorBuilder: (context, error, stackTrace) {
                return Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text('Could not load image: ${attachment.filename}'),
                );
              },
            ),
          if (attachment.kind == MediaKind.video)
            AspectRatio(
              aspectRatio: 16 / 9,
              child: ColoredBox(
                color: Colors.black,
                child: _VideoPlaceholder(attachment: attachment),
              ),
            ),
          if (attachment.kind == MediaKind.pdf)
            Container(
              height: 320,
              color: Colors.grey.shade100,
              alignment: Alignment.center,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.picture_as_pdf, size: 48, color: Colors.red.shade700),
                  const SizedBox(height: 8),
                  Text(attachment.filename, style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () => _openUrl(context),
                    icon: const Icon(Icons.open_in_new, size: 18),
                    label: const Text('Open PDF'),
                  ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    attachment.filename,
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (canOpenExternally)
                  TextButton.icon(
                    onPressed: () => _openUrl(context),
                    icon: const Icon(Icons.open_in_new, size: 16),
                    label: const Text('Open'),
                  ),
                TextButton.icon(
                  onPressed: () => _copyLink(context),
                  icon: const Icon(Icons.link, size: 16),
                  label: const Text('Copy link'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _VideoPlaceholder extends StatelessWidget {
  final MediaAttachment attachment;

  const _VideoPlaceholder({required this.attachment});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.movie, color: Colors.white70, size: 40),
          const SizedBox(height: 8),
          Text(
            attachment.filename,
            style: const TextStyle(color: Colors.white70),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            attachment.url,
            style: const TextStyle(color: Colors.white54, fontSize: 12),
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}
