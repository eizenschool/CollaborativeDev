import { messageReportRepository } from '../../data-access/m3-messaging/messageReportRepository.js';

export function canReportMessage(message, currentUserId) {
  return Boolean(currentUserId && message?.kind === 'user' && message.senderId !== currentUserId
    && !message.deletedAt && !message.pendingAction && !message.id?.startsWith('optimistic-')
    && (message.text?.trim() || message.attachments?.some((a) => ['image', 'video', 'audio'].includes(a.kind))));
}

export function createMessageReportService(repository = messageReportRepository) {
  return {
    submit(messageId, reason) {
      const normalized = reason?.trim();
      if (!normalized || normalized.length > 500) throw new Error('Enter a reason of 1–500 characters.');
      return repository.invoke({ action: 'submit', messageId, reason: normalized });
    },
    evidence(evidenceId) { return repository.invoke({ action: 'evidence', evidenceId }); },
    review(evidenceId, outcome, reason, remove) {
      if (!reason?.trim() || reason.trim().length > 500) throw new Error('Enter a review reason of 1–500 characters.');
      return repository.invoke({ action: 'review', evidenceId, outcome, reason: reason.trim(), remove });
    },
  };
}
export const MessageReportService = createMessageReportService();
