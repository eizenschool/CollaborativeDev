import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import MessageReportReview from '../../../src/presentation/m1-profile/components/admin/MessageReportReview.jsx';
import { MessageReportService } from '../../../src/business-logic/m3-messaging/MessageReportService.js';
import { ReputationService } from '../../../src/business-logic/m1-profile/ReputationService.js';
import '../../../src/presentation/shared/styles/theme.css';

MessageReportService.evidence = async () => ({ id: 'evidence', snapshot: { createdAt: '2026-09-16T04:00:00Z', text: 'Reported message evidence', attachments: [
  { kind: 'video', name: 'clip.mp4', url: '' }, { kind: 'audio', name: 'voice.wav', url: '' },
] } });
ReputationService.adminGetSummary = async () => ({ score: 100, standing: { label: 'Trusted' }, events: [] });
MessageReportService.review = async (...args) => { window.reviewDecision = args; };
function Fixture() {
  const [report, setReport] = useState({ id: 'report', messageEvidenceId: 'evidence', reportedUserId: 'sender', status: 'open' });
  return <main className="card" style={{ maxWidth: 700, margin: '16px auto', padding: 16 }}><h1>Message report</h1><MessageReportReview report={report} onResolved={() => setReport({ ...report, status: 'resolved', resolutionNote: 'Reviewed' })} /></main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
