import { Route, Routes } from 'react-router-dom';
import TumpangGuidePage from './TumpangGuidePage.jsx';
import GuidePastPlans from './GuidePastPlans.jsx';
import GuideQaPage from './GuideQaPage.jsx';
import '../../styles/guide.css';

export default function GuideRoutes() {
  return <Routes><Route index element={<TumpangGuidePage />} /><Route path="history" element={<GuidePastPlans />} /><Route path="session/:sessionId" element={<TumpangGuidePage />} /><Route path="qa" element={<GuideQaPage />} /></Routes>;
}
