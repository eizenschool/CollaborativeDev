import React from 'react';
import { createRoot } from 'react-dom/client';
import AdminConductReview from '../../../src/presentation/m1-profile/components/admin/AdminConductReview.jsx';
import { ReputationService } from '../../../src/business-logic/m1-profile/ReputationService.js';
import { MessageReportService } from '../../../src/business-logic/m3-messaging/MessageReportService.js';
import '../../../src/presentation/shared/styles/theme.css';

ReputationService.adminListSafetyReports = async () => [
  {
    id: 'message-report',
    messageEvidenceId: 'evidence-id',
    reporterName: 'Reporter',
    reportedName: 'Reported member',
    reportedUserId: 'reported-user',
    reason: 'Harassment',
    status: 'open',
    createdAt: '2026-09-16T04:00:00Z',
  },
  {
    id: 'profile-report',
    messageEvidenceId: null,
    reporterName: 'Another reporter',
    reportedName: 'Profile member',
    reportedUserId: 'profile-user',
    reason: 'Unsafe conduct outside chat',
    status: 'open',
    createdAt: '2026-09-16T05:00:00Z',
  },
];
ReputationService.adminGetSummary = async () => ({
  score: 100,
  standing: { label: 'Trusted' },
  events: [],
});
MessageReportService.evidence = async () => ({
  id: 'evidence-id',
  snapshot: {
    createdAt: '2026-09-16T04:00:00Z',
    text: 'Reported message evidence',
    attachments: [],
  },
});

createRoot(document.getElementById('root')).render(<AdminConductReview />);
