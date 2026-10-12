import type { SanitizedChatDraft } from './chat-draft-sanitizer';
import type { ChatAttachmentMetadata } from './chat-attachment-metadata';

export interface PartNumberProvenance {
  value: string;
  source: 'customer_text' | 'image_inferred';
  status: 'pending' | 'confirmed' | 'rejected';
  proposalId?: string;
  evidenceKey?: string;
  messageId?: string;
}

export interface ChatDraft extends SanitizedChatDraft {
  notes?: string;
  attachments?: string[];
  attachmentMetadata?: Record<string, ChatAttachmentMetadata>;
  partNumberProvenance?: PartNumberProvenance;
}
