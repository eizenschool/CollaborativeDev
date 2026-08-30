import { useState } from 'react';
import AdaptiveDialog from '../ui/AdaptiveDialog.jsx';
import { Button } from '../ui/Button.jsx';
import { IconCheckCircle, IconClock, IconShield } from '../icons.jsx';
import { guideCopy } from '../../../business-logic/guide/GuideLanguage.js';

const CORE_STEPS = {
  en: [
    ['Catalogue only', 'Every recommendation must match a current Place ID in our own database. No web-search places are invented.'],
    ['Private for 90 days', 'Guest chats are not saved. Signed-in conversations are private and automatically removed after 90 days.'],
    ['History is your choice', 'Trip History stays off. You can allow it for this session only, and switch it off again at any time.']
  ],
  'zh-CN': [['仅限目录', '每个推荐都必须对应我们数据库中的 Place ID，不会编造网络地点。'], ['90 天私人保存', '访客聊天不会保存。登入后的对话为私人资料，并会在 90 天后自动删除。'], ['历史记录由你选择', 'Trip History 默认关闭，只会在你为本次会话授权后使用。']],
  ms: [['Katalog sahaja', 'Setiap cadangan mesti mempunyai Place ID dalam pangkalan data kami.'], ['Peribadi selama 90 hari', 'Sembang tetamu tidak disimpan. Sembang berdaftar dipadam selepas 90 hari.'], ['Sejarah pilihan anda', 'Trip History dimatikan sehingga anda membenarkannya untuk sesi ini.']],
  ta: [['பட்டியல் மட்டும்', 'ஒவ்வொரு பரிந்துரையும் எங்கள் தரவுத்தளத்தில் உள்ள Place ID-ஐ கொண்டிருக்க வேண்டும்.'], ['90 நாட்கள் தனிப்பட்டது', 'விருந்தினர் உரையாடல்கள் சேமிக்கப்படாது; உள்நுழைந்த உரையாடல்கள் 90 நாட்களில் நீக்கப்படும்.'], ['வரலாறு உங்கள் விருப்பம்', 'Trip History இயல்பாக முடக்கப்பட்டுள்ளது; இந்த அமர்வுக்கு மட்டும் அனுமதிக்கலாம்.']]
};

export default function GuideOnboarding({ open, onClose, language, languagePack }) {
  const [step, setStep] = useState(0);
  const copy = guideCopy(language, languagePack);
  const steps = CORE_STEPS[language] || [
    [copy.onboardingCatalogueTitle, copy.onboardingCatalogueDescription],
    [copy.onboardingPrivacyTitle, copy.onboardingPrivacyDescription],
    [copy.onboardingHistoryTitle, copy.onboardingHistoryDescription]
  ];
  const icons = [IconShield, IconClock, IconCheckCircle];
  const safeStep = Math.min(step, steps.length - 1);
  const item = steps[safeStep]; const Icon = icons[safeStep]; const last = safeStep === steps.length - 1;
  return <AdaptiveDialog open={open} onClose={onClose} title={copy.onboardingTitle} description={copy.onboardingDescription} footer={<Button data-autofocus onClick={() => { if (last) onClose(); else setStep((value) => value + 1); }}>{last ? copy.onboardingStart : copy.onboardingNext}</Button>}><div className="guide-onboarding"><span className="guide-onboarding__icon" aria-hidden="true"><Icon size={30} /></span><p className="guide-onboarding__step">{safeStep + 1} / {steps.length}</p><h3>{item[0]}</h3><p>{item[1]}</p>{last && <p className="guide-data-note"><strong>{copy.onboardingFreeTier}</strong> {copy.onboardingFreeTierDescription}</p>}<div className="guide-onboarding__dots" aria-hidden="true">{steps.map((_, index) => <span key={index} className={index === safeStep ? 'active' : ''} />)}</div></div></AdaptiveDialog>;
}
