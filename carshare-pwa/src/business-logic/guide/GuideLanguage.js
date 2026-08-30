// ===== BUSINESS LOGIC LAYER (Tumpang Guide language support) =====
import {
  GUIDE_CORE_LANGUAGES, GUIDE_LANGUAGE, GUIDE_LANGUAGES, GUIDE_REASON,
  GUIDE_ROLE, GUIDE_TRADEOFF
} from './constants.js';

export const GUIDE_PACK_VERSION = 'm6-guide-pack-v2';

export const GUIDE_LOCALE = Object.freeze({
  en: 'en-MY', 'zh-CN': 'zh-CN', ms: 'ms-MY', ta: 'ta-MY',
  id: 'id-ID', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE',
  es: 'es-ES', 'pt-BR': 'pt-BR', it: 'it-IT', nl: 'nl-NL', ar: 'ar-SA',
  hi: 'hi-IN', th: 'th-TH', vi: 'vi-VN', bn: 'bn-BD', ur: 'ur-PK'
});

export const GUIDE_LANGUAGE_OPTIONS = Object.freeze([
  { value: 'en', label: 'English' }, { value: 'zh-CN', label: '简体中文' },
  { value: 'ms', label: 'Bahasa Melayu' }, { value: 'ta', label: 'தமிழ்' },
  { value: 'id', label: 'Bahasa Indonesia' }, { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' }, { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' }, { value: 'es', label: 'Español' },
  { value: 'pt-BR', label: 'Português (Brasil)' }, { value: 'it', label: 'Italiano' },
  { value: 'nl', label: 'Nederlands' }, { value: 'ar', label: 'العربية' },
  { value: 'hi', label: 'हिन्दी' }, { value: 'th', label: 'ไทย' },
  { value: 'vi', label: 'Tiếng Việt' }, { value: 'bn', label: 'বাংলা' },
  { value: 'ur', label: 'اردو' }
]);

const CORE = {
  en: {
    welcome: "Tell me the kind of day you want, and I'll only suggest places already in Let's Tumpang.",
    askDate: 'When would you like to go?', askOrigin: 'Where will you be starting from?',
    askParty: 'How many people are travelling?', askPreference: 'What matters most: food, heritage, nature, or an event?',
    recommend: 'I found three database-verified options for your plan.',
    noCandidates: "I couldn't find a catalogue place that safely fits those conditions. Try another date or preference.",
    helpMissing: "I couldn't find a verified Help section for that. I can explain Discover, Search, shared-ride alerts, favourites, or profile preferences.",
    emergency: 'This sounds urgent. I am stopping travel recommendations. Call 999 if anyone is in immediate danger, and use the app’s Trusted Family/SOS tools where available.',
    offline: 'Smart recommendations are using verified catalogue rules while the AI service is unavailable.',
    retryGemini: 'Retry Gemini', newChat: 'New chat', pastPlans: 'Past plans',
    guideLanguage: 'Guide language', livePlan: 'LIVE PLAN', travelBrief: 'Your travel brief', startingPoint: 'Starting point',
    from: 'From', until: 'Until', people: 'People', categoryQuestion: 'What sounds good?',
    useLocation: 'Use my location once', locating: 'Locating…', savePreferences: 'Save these preferences',
    signInSave: 'Sign in to save preferences', historyConsent: 'Use my Trip History this session',
    historyNote: 'Off by default. Account IDs, contacts and precise coordinates are never sent to Gemini.',
    composerLabel: 'Message Tumpang Guide', composerPlaceholder: 'e.g. Two of us want nature near KL this weekend…',
    voiceNote: 'Voice only fills this editable text box. Audio is never uploaded or saved.',
    thinking: 'Checking catalogue, weather and shared-ride fit…', databaseOnly: 'Database places only',
    timeoutFallback: '10-second fallback', privacy: 'No precise location sent', smart: 'Smart recommendations',
    verifiedRules: 'Verified rules', sourceGemini: 'Gemini guide', sourceRules: 'Verified rules',
    details: 'View full destination details', whyThis: 'Why this', findRide: 'Find a ride', saveInterest: 'Save interest',
    interestSaved: 'Interest saved', cancelInterest: 'Cancel interest', rideAlert: 'Ride alert', alertSaved: 'Ride alert saved',
    cancelAlert: 'Cancel ride alert', tradeoff: 'Trade-off', showPhoto: 'Show photo', previouslyShown: 'Shown earlier in this chat',
    helpful: 'Helpful', notRelevant: 'Not relevant', feedbackSaved: 'Feedback saved', feedbackRemoved: 'Feedback removed',
    rulesFallback: 'Rules fallback', retryNotice: 'The Guide could not reach Gemini. Your plan is still here—please retry.',
    actionConfirm: 'Nothing is changed until you confirm.', cancel: 'Cancel', confirm: 'Confirm',
    saveInterestConfirm: (name, date) => `This records ${name} as a place you considered for ${date}.`,
    rideAlertConfirm: (name, date) => `We will notify you if a shared ride is published for ${name} on ${date}.`,
    preferenceConfirm: (categories) => `Save ${categories.join(', ')} as your reusable destination preferences.`,
    sourceLabel: 'Source', remaining: (n) => `${n} smart turn${n === 1 ? '' : 's'} remaining`,
    roles: { best_match: 'Best match', practical_alternative: 'Practical alternative', wildcard: 'Wildcard' },
    categories: { culinary: 'Culinary', heritage: 'Heritage', nature: 'Nature', event: 'Event' },
     tradeoffs: { none: 'Strong all-round fit', no_ride_yet: 'No shared ride is serving it yet', farther_away: 'A little farther away', busier_choice: 'More popular than the quieter options', thin_reviews: 'Still building review confidence', lower_personal_match: 'More practical, but less tailored' },
     reasons: { affinity: 'It matches your interest in {{category}}.', season: 'Your selected date falls in a stronger seasonal window.', quality: 'Visitors consistently rate {{name}} well.', headroom: 'It can be quieter than the busiest {{category}} choices nearby.', local: 'It supports an independently run local destination.', seat_headroom: 'An existing shared ride may have room for {{party}}.', journey_cost: 'It is one of the more practical options from {{origin}}.', demand_convergence: 'Other travellers are showing interest in going too.', weather_checked: 'The weather gate was checked for your selected date.', date_range_consistency: 'It stayed competitive across your selected date range.' }
  },
  'zh-CN': {
    welcome: "告诉我你想要怎样的一天，我只会推荐 Let's Tumpang 资料库里已有的地点。", askDate: '你想哪一天出发？', askOrigin: '你会从哪里出发？', askParty: '一共有几位同行？', askPreference: '你最在意什么：美食、文化遗产、大自然，还是活动？', recommend: '我找到了三个已经通过资料库验证的选择。', noCandidates: '目前没有安全符合条件的资料库地点。你可以换一个日期或偏好。', helpMissing: '我没有找到已验证的相关指引。我可以说明探索、搜寻、共乘提醒、收藏或个人偏好。', emergency: '这听起来可能是紧急情况。我会停止旅游推荐。如有人处于即时危险，请拨打 999，并在可用时使用 Trusted Family／SOS。', offline: 'AI 服务不可用，智能推荐正使用已验证的目录规则。', retryGemini: '重试 Gemini', newChat: '新聊天', pastPlans: '历史计划', guideLanguage: '助手语言', livePlan: '当前计划', travelBrief: '你的旅行概要', startingPoint: '出发地点', from: '出发日期', until: '结束日期', people: '人数', categoryQuestion: '你想要什么？', useLocation: '使用一次我的位置', locating: '正在定位…', savePreferences: '保存这些偏好', signInSave: '登入后保存偏好', historyConsent: '本次使用我的 Trip History', historyNote: '默认关闭。帐户 ID、联系人和精确坐标不会发送给 Gemini。', composerLabel: '发送给 Tumpang Guide', composerPlaceholder: '例如：我们两个人想这周末在吉隆坡附近亲近自然……', voiceNote: '语音只会填入可编辑文字框，不会上传或保存录音。', thinking: '正在检查目录、天气和共乘实用性…', databaseOnly: '仅限资料库地点', timeoutFallback: '10 秒后自动降级', privacy: '不会发送精确位置', smart: '智能推荐', verifiedRules: '已验证规则', sourceGemini: 'Gemini 助手', sourceRules: '已验证规则', details: '查看完整目的地详情', whyThis: '为什么推荐', findRide: '寻找共乘', saveInterest: '保存兴趣', interestSaved: '已保存兴趣', cancelInterest: '取消兴趣', rideAlert: '共乘提醒', alertSaved: '共乘提醒已保存', cancelAlert: '取消共乘提醒', tradeoff: '取舍', showPhoto: '显示照片', previouslyShown: '本聊天之前已展示', helpful: '有帮助', notRelevant: '不相关', feedbackSaved: '反馈已保存', feedbackRemoved: '反馈已取消', rulesFallback: '规则降级', retryNotice: '暂时无法连接 Gemini。你的计划仍在这里，请重试。', actionConfirm: '确认前不会更改任何内容。', cancel: '取消', confirm: '确认', sourceLabel: '来源', saveInterestConfirm: (name, date) => `将 ${name} 记录为你在 ${date} 考虑过的地点。`, rideAlertConfirm: (name, date) => `如果 ${date} 有共乘前往 ${name}，我们会通知你。`, preferenceConfirm: (categories) => `保存 ${categories.join('、')} 作为可重复使用的旅行偏好。`, remaining: (n) => `本工作阶段还可使用 ${n} 次智能对话`, roles: { best_match: '最符合', practical_alternative: '实用替代', wildcard: '惊喜选择' }, categories: { culinary: '美食', heritage: '文化遗产', nature: '自然', event: '活动' }, tradeoffs: { none: '整体非常合适', no_ride_yet: '目前还没有共乘前往', farther_away: '距离稍远', busier_choice: '比安静选项更热门', thin_reviews: '评论可信度仍在累积', lower_personal_match: '更实用，但个人化程度较低' }, reasons: { affinity: '它符合你对 {{category}} 类地点的偏好。', season: '你选择的日期处于更合适的季节时段。', quality: '{{name}}持续获得较好的访客评价。', headroom: '它可能比附近最热门的 {{category}} 选择更安静。', local: '它能支持独立经营的本地目的地。', seat_headroom: '现有共乘可能有足够座位容纳 {{party}} 人。', journey_cost: '从 {{origin}} 出发，这是较实际的选择之一。', demand_convergence: '其他旅客也正表达前往这里的兴趣。', weather_checked: '系统已针对所选日期检查天气闸门。', date_range_consistency: '它在你选择的整个日期范围内都保持竞争力。' }
  },
  ms: {
    welcome: 'Beritahu saya hari yang anda inginkan. Saya hanya mencadangkan tempat yang sudah ada dalam pangkalan data Let\'s Tumpang.', askDate: 'Bilakah anda mahu pergi?', askOrigin: 'Dari mana anda akan bertolak?', askParty: 'Berapa orang akan pergi?', askPreference: 'Apa yang paling penting: makanan, warisan, alam semula jadi atau acara?', recommend: 'Saya menemui tiga pilihan yang telah disahkan dalam pangkalan data.', noCandidates: 'Tiada tempat dalam katalog yang selamat dan sesuai. Cuba tarikh atau pilihan lain.', helpMissing: 'Saya tidak menemui panduan yang disahkan. Saya boleh terangkan Discover, Search, amaran tumpangan, kegemaran atau profil.', emergency: 'Ini kedengaran seperti kecemasan. Saya menghentikan cadangan perjalanan. Hubungi 999 jika sesiapa dalam bahaya dan gunakan Trusted Family/SOS jika tersedia.', offline: 'Perkhidmatan AI tidak tersedia. Cadangan menggunakan peraturan katalog yang disahkan.', retryGemini: 'Cuba Gemini lagi', newChat: 'Sembang baharu', pastPlans: 'Pelan terdahulu', guideLanguage: 'Bahasa Guide', livePlan: 'PELAN SEMASA', travelBrief: 'Ringkasan perjalanan anda', startingPoint: 'Tempat mula', from: 'Dari', until: 'Hingga', people: 'Orang', categoryQuestion: 'Apa yang menarik?', useLocation: 'Gunakan lokasi saya sekali', locating: 'Mencari lokasi…', savePreferences: 'Simpan pilihan ini', signInSave: 'Log masuk untuk simpan pilihan', historyConsent: 'Gunakan Trip History saya untuk sesi ini', historyNote: 'Dimatikan secara lalai. ID akaun, kenalan dan koordinat tepat tidak dihantar kepada Gemini.', composerLabel: 'Mesej Tumpang Guide', composerPlaceholder: 'contoh: Dua orang mahu alam semula jadi dekat KL hujung minggu ini…', voiceNote: 'Suara hanya mengisi kotak teks yang boleh disunting. Audio tidak dimuat naik atau disimpan.', thinking: 'Menyemak katalog, cuaca dan kesesuaian tumpangan…', databaseOnly: 'Tempat katalog sahaja', timeoutFallback: 'Fallback 10 saat', privacy: 'Lokasi tepat tidak dihantar', smart: 'Cadangan pintar', verifiedRules: 'Peraturan disahkan', sourceGemini: 'Guide Gemini', sourceRules: 'Peraturan disahkan', details: 'Lihat butiran destinasi penuh', whyThis: 'Mengapa ini', findRide: 'Cari tumpangan', saveInterest: 'Simpan minat', interestSaved: 'Minat disimpan', cancelInterest: 'Batalkan minat', rideAlert: 'Amaran tumpangan', alertSaved: 'Amaran tumpangan disimpan', cancelAlert: 'Batalkan amaran tumpangan', tradeoff: 'Pertukaran', showPhoto: 'Tunjukkan foto', previouslyShown: 'Telah dipaparkan dalam sembang ini', helpful: 'Membantu', notRelevant: 'Tidak berkaitan', feedbackSaved: 'Maklum balas disimpan', feedbackRemoved: 'Maklum balas dibatalkan', rulesFallback: 'Fallback peraturan', retryNotice: 'Gemini tidak dapat dicapai. Pelan anda masih ada—cuba lagi.', actionConfirm: 'Tiada perubahan sehingga anda mengesahkan.', cancel: 'Batal', confirm: 'Sahkan', sourceLabel: 'Sumber', saveInterestConfirm: (name, date) => `Ini merekodkan ${name} sebagai tempat yang anda pertimbangkan pada ${date}.`, rideAlertConfirm: (name, date) => `Kami akan memberitahu anda jika tumpangan diterbitkan ke ${name} pada ${date}.`, preferenceConfirm: (categories) => `Simpan ${categories.join(', ')} sebagai pilihan perjalanan anda.`, remaining: (n) => `${n} pusingan pintar lagi`, roles: { best_match: 'Padanan terbaik', practical_alternative: 'Alternatif praktikal', wildcard: 'Pilihan kejutan' }, categories: { culinary: 'Makanan', heritage: 'Warisan', nature: 'Alam semula jadi', event: 'Acara' }, tradeoffs: { none: 'Sesuai secara menyeluruh', no_ride_yet: 'Belum ada tumpangan ke sana', farther_away: 'Sedikit lebih jauh', busier_choice: 'Lebih popular daripada pilihan tenang', thin_reviews: 'Keyakinan ulasan masih berkembang', lower_personal_match: 'Lebih praktikal, kurang diperibadikan' }, reasons: { affinity: 'Ia sepadan dengan minat anda terhadap {{category}}.', season: 'Tarikh pilihan anda berada dalam musim yang lebih sesuai.', quality: 'Pelawat memberi penilaian baik kepada {{name}}.', headroom: 'Ia mungkin lebih tenang daripada pilihan {{category}} paling sibuk.', local: 'Ia menyokong destinasi tempatan yang dikendalikan secara bebas.', seat_headroom: 'Tumpangan sedia ada mungkin mempunyai ruang untuk {{party}} orang.', journey_cost: 'Ia antara pilihan yang lebih praktikal dari {{origin}}.', demand_convergence: 'Pelancong lain juga menunjukkan minat untuk ke sana.', weather_checked: 'Weather Gate telah diperiksa untuk tarikh pilihan anda.', date_range_consistency: 'Ia kekal kompetitif sepanjang julat tarikh pilihan anda.' }
  },
  ta: {
    welcome: 'நீங்கள் விரும்பும் நாளைப் பற்றி சொல்லுங்கள். Let\'s Tumpang தரவுத்தளத்தில் உள்ள இடங்களை மட்டுமே பரிந்துரைப்பேன்.', askDate: 'நீங்கள் எப்போது செல்ல விரும்புகிறீர்கள்?', askOrigin: 'எங்கிருந்து புறப்படுவீர்கள்?', askParty: 'எத்தனை பேர் பயணம் செய்கிறீர்கள்?', askPreference: 'உணவு, பாரம்பரியம், இயற்கை அல்லது நிகழ்வு — எது முக்கியம்?', recommend: 'தரவுத்தளத்தில் சரிபார்க்கப்பட்ட மூன்று தேர்வுகள் கிடைத்தன.', noCandidates: 'இந்த நிபந்தனைகளுக்கு பொருந்தும் பட்டியல் இடம் இல்லை. வேறு தேதி அல்லது விருப்பத்தை முயற்சிக்கவும்.', helpMissing: 'சரிபார்க்கப்பட்ட உதவி பகுதி கிடைக்கவில்லை. Discover, Search, பகிர்ந்து பயண அறிவிப்புகள், favourites அல்லது profile பற்றி விளக்கலாம்.', emergency: 'இது அவசரநிலை போல உள்ளது. பயண பரிந்துரைகளை நிறுத்துகிறேன். உடனடி ஆபத்து இருந்தால் 999 அழைக்கவும்; கிடைத்தால் Trusted Family/SOS பயன்படுத்தவும்.', offline: 'AI சேவை கிடைக்கவில்லை. சரிபார்க்கப்பட்ட பட்டியல் விதிகள் பயன்படுத்தப்படுகின்றன.', retryGemini: 'Gemini-யை மீண்டும் முயற்சி', newChat: 'புதிய உரையாடல்', pastPlans: 'முந்தைய திட்டங்கள்', guideLanguage: 'Guide மொழி', livePlan: 'நடப்பு திட்டம்', travelBrief: 'உங்கள் பயண சுருக்கம்', startingPoint: 'தொடக்க இடம்', from: 'முதல்', until: 'வரை', people: 'பயணிகள்', categoryQuestion: 'எது பிடிக்கும்?', useLocation: 'என் இருப்பிடத்தை ஒருமுறை பயன்படுத்து', locating: 'இருப்பிடம் தேடுகிறது…', savePreferences: 'இந்த விருப்பங்களைச் சேமி', signInSave: 'விருப்பங்களைச் சேமிக்க உள்நுழைக', historyConsent: 'இந்த அமர்வில் Trip History பயன்படுத்தவும்', historyNote: 'இயல்பாக முடக்கப்பட்டுள்ளது. கணக்கு ID, தொடர்புகள் மற்றும் துல்லியமான இருப்பிடம் Gemini-க்கு அனுப்பப்படாது.', composerLabel: 'Tumpang Guide-க்கு செய்தி', composerPlaceholder: 'உதாரணம்: இந்த வார இறுதியில் KL அருகே இயற்கை இடம் இருவருக்கு வேண்டும்…', voiceNote: 'குரல் திருத்தக்கூடிய உரைப் பெட்டியை மட்டும் நிரப்பும். ஆடியோ பதிவேற்றமோ சேமிப்போ இல்லை.', thinking: 'பட்டியல், வானிலை மற்றும் பகிர்ந்து பயணிக்கும் வசதியைச் சரிபார்க்கிறது…', databaseOnly: 'பட்டியல் இடங்கள் மட்டும்', timeoutFallback: '10 விநாடி fallback', privacy: 'துல்லியமான இருப்பிடம் அனுப்பப்படாது', smart: 'Smart பரிந்துரைகள்', verifiedRules: 'சரிபார்க்கப்பட்ட விதிகள்', sourceGemini: 'Gemini Guide', sourceRules: 'சரிபார்க்கப்பட்ட விதிகள்', details: 'முழு இட விவரங்களைப் பார்க்க', whyThis: 'ஏன் இது', findRide: 'பகிர்ந்து பயணம் தேடு', saveInterest: 'ஆர்வத்தைச் சேமி', interestSaved: 'ஆர்வம் சேமிக்கப்பட்டது', cancelInterest: 'ஆர்வத்தை ரத்து செய்', rideAlert: 'பகிர்ந்து பயண அறிவிப்பு', alertSaved: 'பகிர்ந்து பயண அறிவிப்பு சேமிக்கப்பட்டது', cancelAlert: 'பகிர்ந்து பயண அறிவிப்பை ரத்து செய்', tradeoff: 'சமரசம்', showPhoto: 'படத்தைக் காட்டு', previouslyShown: 'இந்த உரையாடலில் முன்பே காட்டப்பட்டது', helpful: 'பயனுள்ளது', notRelevant: 'பொருந்தவில்லை', feedbackSaved: 'கருத்து சேமிக்கப்பட்டது', feedbackRemoved: 'கருத்து ரத்து செய்யப்பட்டது', rulesFallback: 'விதி fallback', retryGemini: 'Gemini-யை மீண்டும் முயற்சி', retryNotice: 'Gemini-யை அணுக முடியவில்லை. உங்கள் திட்டம் உள்ளது—மீண்டும் முயற்சிக்கவும்.', actionConfirm: 'உறுதிப்படுத்தும் வரை எதுவும் மாற்றப்படாது.', cancel: 'ரத்து', confirm: 'உறுதிப்படுத்து', sourceLabel: 'ஆதாரம்', saveInterestConfirm: (name, date) => `${date} அன்று நீங்கள் பரிசீலித்த இடமாக ${name} பதிவு செய்யப்படும்.`, rideAlertConfirm: (name, date) => `${date} அன்று ${name}-க்கு பகிர்ந்து பயணம் வெளியானால் உங்களுக்குத் தெரிவிப்போம்.`, preferenceConfirm: (categories) => `${categories.join(', ')} உங்கள் பயண விருப்பங்களாகச் சேமிக்கப்படும்.`, remaining: (n) => `${n} smart சுற்றுகள் மீதம்`, roles: { best_match: 'சிறந்த பொருத்தம்', practical_alternative: 'நடைமுறை மாற்று', wildcard: 'புதிய தேர்வு' }, categories: { culinary: 'உணவு', heritage: 'பாரம்பரியம்', nature: 'இயற்கை', event: 'நிகழ்வு' }, tradeoffs: { none: 'மொத்தத்தில் நல்ல பொருத்தம்', no_ride_yet: 'இன்னும் பகிர்ந்து பயணம் இல்லை', farther_away: 'சற்று தொலைவு', busier_choice: 'அமைதியான இடங்களை விட பிரபலமானது', thin_reviews: 'மதிப்புரைகள் இன்னும் குறைவு', lower_personal_match: 'நடைமுறை, ஆனால் தனிப்பயன் குறைவு' }, reasons: { affinity: '{{category}} இடங்களுக்கான உங்கள் விருப்பத்துடன் இது பொருந்துகிறது.', season: 'நீங்கள் தேர்ந்தெடுத்த தேதி சிறந்த பருவ காலத்தில் வருகிறது.', quality: '{{name}} தொடர்ந்து நல்ல மதிப்பீடுகளைப் பெறுகிறது.', headroom: 'அருகிலுள்ள பரபரப்பான {{category}} இடங்களை விட இது அமைதியாக இருக்கலாம்.', local: 'இது சுயமாக நடத்தப்படும் உள்ளூர் இடத்தை ஆதரிக்கிறது.', seat_headroom: 'தற்போதுள்ள பகிர்ந்து பயணத்தில் {{party}} பேருக்கு இடம் இருக்கலாம்.', journey_cost: '{{origin}} இலிருந்து இது நடைமுறைக்கு ஏற்ற தேர்வுகளில் ஒன்று.', demand_convergence: 'மற்ற பயணிகளும் இங்கு செல்ல ஆர்வம் காட்டுகின்றனர்.', weather_checked: 'தேர்ந்தெடுத்த தேதிக்கான Weather Gate சரிபார்க்கப்பட்டது.', date_range_consistency: 'தேர்ந்தெடுத்த முழுத் தேதி வரம்பிலும் இது நல்ல தேர்வாக இருந்தது.' }
  }
};

const REQUIRED_PACK_PATHS = Object.freeze([
  'welcome', 'askDate', 'askOrigin', 'askParty', 'askPreference', 'recommend', 'noCandidates',
  'helpMissing', 'emergency', 'offline', 'retryGemini', 'newChat', 'pastPlans', 'guideLanguage',
  'livePlan', 'travelBrief', 'startingPoint', 'from', 'until', 'people', 'categoryQuestion',
  'useLocation', 'locating', 'savePreferences', 'signInSave', 'historyConsent', 'historyNote',
  'composerLabel', 'composerPlaceholder', 'voiceNote', 'thinking', 'databaseOnly', 'timeoutFallback',
  'privacy', 'smart', 'verifiedRules', 'sourceGemini', 'sourceRules', 'details', 'whyThis', 'findRide',
  'saveInterest', 'interestSaved', 'cancelInterest', 'rideAlert', 'alertSaved', 'cancelAlert', 'tradeoff',
  'showPhoto', 'previouslyShown', 'helpful', 'notRelevant', 'feedbackSaved', 'feedbackRemoved',
  'rulesFallback', 'retryNotice', 'actionConfirm', 'cancel', 'confirm', 'sourceLabel',
  'preferencesSaved', 'catalogueRequestSaved', 'actionFailed', 'feedbackError', 'feedbackUnavailable', 'persistenceWarning', 'languageUnavailable',
  'voiceUnsupported', 'voicePermissionDenied', 'voiceNoSpeech', 'voiceLanguageUnsupported', 'voiceStopped', 'voiceStartFailed',
  'heroTitle', 'heroDescription', 'onboardingTitle', 'onboardingDescription',
  'onboardingNext', 'onboardingStart', 'onboardingFreeTier', 'loadingLanguage',
  'suggestedReplies', 'quickNature', 'quickFood', 'quickHelp', 'quickPractical', 'quickDifferent', 'quickDate', 'callEmergency', 'trustedFamily', 'feedbackReason', 'chooseFeedbackReason', 'feedbackBadTradeoff', 'feedbackWrongLanguage', 'feedbackOther', 'openConversation',
  'requestCatalogue', 'catalogueQueued', 'savedPlanDescription', 'delete', 'deleteAll', 'backToGuide', 'signIn', 'guestNotSaved',
  'accountRequiredTitle', 'loadingPlans', 'plansUnavailable', 'retry', 'noSavedPlans', 'noSavedPlansDescription',
  'dateNotDecided', 'originNotDecided', 'privateRetention', 'startingPointPlaceholder', 'startVoice', 'stopVoice', 'sendMessage', 'showMore',
  'onboardingCatalogueTitle', 'onboardingCatalogueDescription', 'onboardingPrivacyTitle',
  'onboardingPrivacyDescription', 'onboardingHistoryTitle', 'onboardingHistoryDescription',
  'onboardingFreeTierDescription', 'heroMediaTitle', 'heroMediaDescription', 'batchLabel', 'photoCredit'
]);

const EXTRA_CORE_COPY = Object.freeze({
  en: {
    heroTitle: 'Your local friend for the next good day out.',
    heroDescription: "Talk naturally. I retrieve from our own Malaysian place catalogue, check your date, weather and shared-ride practicality, then explain three honest choices.",
    onboardingTitle: 'Meet Tumpang Guide', onboardingDescription: 'A controlled travel assistant, not an open-web chatbot.',
    onboardingNext: 'Next', onboardingStart: 'Start planning', onboardingFreeTier: 'Free-tier disclosure:',
    loadingLanguage: 'Loading language…', suggestedReplies: 'Suggested replies', quickNature: 'A nature day tomorrow', quickFood: 'Food this weekend', quickHelp: 'How does this work?', quickPractical: 'Make it more practical', quickDifferent: 'Recommend other places', quickDate: 'Change the date', callEmergency: 'Call 999', trustedFamily: 'Trusted Family', feedbackReason: 'Feedback reason',
    chooseFeedbackReason: 'Choose a reason', feedbackBadTradeoff: 'The trade-off was unclear', feedbackWrongLanguage: 'The language was wrong', feedbackOther: 'Another issue', openConversation: 'Open this conversation →', requestCatalogue: 'Request catalogue review',
    catalogueQueued: 'Your request has been queued for catalogue verification.', catalogueMissing: 'That place is not in our catalogue yet.', savedPlanDescription: 'Your signed-in conversations stay separate from Module 3 messages.',
    delete: 'Delete', deleteAll: 'Delete all', backToGuide: 'Back to Tumpang Guide', signIn: 'Sign in',
    guestNotSaved: 'Guest conversations are never saved.', accountRequiredTitle: 'Past plans need an account',
    loadingPlans: 'Loading saved plans…', plansUnavailable: 'Past plans are unavailable', retry: 'Retry',
    noSavedPlans: 'No saved plans yet', noSavedPlansDescription: 'Start a Guide conversation and it will appear here.',
    dateNotDecided: 'Date not decided', originNotDecided: 'Origin not decided', privateRetention: 'Private · 90-day retention', startingPointPlaceholder: 'e.g. Kuala Lumpur', startVoice: 'Start voice input', stopVoice: 'Stop voice input', sendMessage: 'Send message', showMore: 'Show more catalogue choices',
    onboardingCatalogueTitle: 'Catalogue only', onboardingCatalogueDescription: 'Every recommendation must match a current Place ID in our own database. No web-search places are invented.',
    onboardingPrivacyTitle: 'Private for 90 days', onboardingPrivacyDescription: 'Guest chats are not saved. Signed-in conversations are private and automatically removed after 90 days.',
    onboardingHistoryTitle: 'History is your choice', onboardingHistoryDescription: 'Trip History stays off. You can allow it for this session only, and switch it off again at any time.',
    onboardingFreeTierDescription: 'When Gemini is enabled, provider terms may allow prompts and responses to be used to improve its products. Contact details, account IDs and precise coordinates are not sent.',
    heroMediaTitle: 'Malaysia, your way', heroMediaDescription: 'verified places · honest trade-offs', batchLabel: 'Recommendation batch', photoCredit: 'Photo',
    reviewsHeading: 'What travellers say', gettingThere: 'Getting there', whyGuide: 'Why we suggested this', previousPhoto: 'Previous photo', nextPhoto: 'Next photo',
    preferencesSaved: 'Travel preferences saved.', catalogueRequestSaved: 'Catalogue review requested.', actionFailed: 'This action could not be completed.', feedbackError: 'Feedback could not be saved.', feedbackUnavailable: 'Feedback is available after a saved Guide session is created.', persistenceWarning: 'Gemini replied, but this turn could not be saved. Please try again before leaving this chat.', languageUnavailable: 'This language pack is temporarily unavailable. The Guide is using complete English copy.',
    voiceUnsupported: 'Voice input is not supported by this browser.', voicePermissionDenied: 'Microphone permission was denied.', voiceNoSpeech: 'No speech was recognised. You can keep typing.', voiceLanguageUnsupported: 'This language is not supported for voice input. You can keep typing.', voiceStopped: 'Voice input stopped. You can keep typing.', voiceStartFailed: 'Voice input could not start. You can keep typing.'
  },
  'zh-CN': {
    heroTitle: '为下一次美好出行找到本地好伙伴。',
    heroDescription: '自然地告诉我你的想法。我会从马来西亚地点目录中检索，检查日期、天气和共乘实用性，再解释三个诚实的选择。',
    onboardingTitle: '认识 Tumpang Guide', onboardingDescription: '这是受控的旅行助手，不是开放网络聊天机器人。',
    onboardingNext: '下一步', onboardingStart: '开始规划', onboardingFreeTier: '免费层说明：',
    loadingLanguage: '正在加载语言…', suggestedReplies: '建议回复', quickNature: '明天的自然日', quickFood: '这个周末吃美食', quickHelp: '这个助手怎么用？', quickPractical: '更实用一点', quickDifferent: '推荐其他地点', quickDate: '更改日期', callEmergency: '拨打 999', trustedFamily: 'Trusted Family', feedbackReason: '反馈原因',
    chooseFeedbackReason: '选择原因', feedbackBadTradeoff: '取舍说明不清楚', feedbackWrongLanguage: '语言不正确', feedbackOther: '其他问题', openConversation: '打开这段对话 →', requestCatalogue: '申请审核地点',
    catalogueQueued: '你的申请已加入目录审核队列。', catalogueMissing: '这个地点目前还不在我们的目录中。', savedPlanDescription: '你登入后的对话与 Module 3 真人聊天分开保存。',
    delete: '删除', deleteAll: '全部删除', backToGuide: '返回 Tumpang Guide', signIn: '登入',
    guestNotSaved: '访客对话不会保存。', accountRequiredTitle: '需要帐户才能查看历史计划',
    loadingPlans: '正在加载已保存计划…', plansUnavailable: '历史计划暂时无法使用', retry: '重试',
    noSavedPlans: '还没有历史计划', noSavedPlansDescription: '开始一次 Guide 对话，它就会显示在这里。',
    dateNotDecided: '尚未决定日期', originNotDecided: '尚未决定出发地', privateRetention: '私人保存 · 90 天', startingPointPlaceholder: '例如：吉隆坡', startVoice: '开始语音输入', stopVoice: '停止语音输入', sendMessage: '发送消息', showMore: '显示更多目录地点',
    onboardingCatalogueTitle: '仅限目录', onboardingCatalogueDescription: '每个推荐都必须对应我们数据库中的 Place ID，不会编造网络地点。', onboardingPrivacyTitle: '90 天私人保存', onboardingPrivacyDescription: '访客聊天不会保存。登入后的对话为私人资料，并会在 90 天后自动删除。', onboardingHistoryTitle: '历史记录由你选择', onboardingHistoryDescription: 'Trip History 默认关闭，只会在你为本次会话授权后使用。', onboardingFreeTierDescription: '启用 Gemini 后，服务商条款可能允许使用提示和回复来改进产品。我们不会发送联系人、帐户 ID 或精确坐标。', heroMediaTitle: '按你的方式探索马来西亚', heroMediaDescription: '已验证地点 · 诚实取舍', batchLabel: '推荐批次', photoCredit: '照片',
    preferencesSaved: '旅行偏好已保存。', catalogueRequestSaved: '地点审核申请已提交。', actionFailed: '此操作无法完成。', feedbackError: '反馈无法保存。', feedbackUnavailable: '建立并保存 Guide 会话后才能提交反馈。', persistenceWarning: 'Gemini 已回复，但这次对话未能保存。离开前请再试一次。', languageUnavailable: '此语言包暂时不可用，Guide 正在使用完整的英文内容。',
    reviewsHeading: '旅客评价', gettingThere: '如何前往', whyGuide: '为什么推荐这个地点', previousPhoto: '上一张照片', nextPhoto: '下一张照片',
    voiceUnsupported: '此浏览器不支持语音输入。', voicePermissionDenied: '麦克风权限被拒绝。', voiceNoSpeech: '没有识别到语音，你可以继续输入。', voiceLanguageUnsupported: '此语言不支持语音输入，你可以继续输入。', voiceStopped: '语音输入已停止，你可以继续输入。', voiceStartFailed: '语音输入无法启动，你可以继续输入。'
  },
  ms: {
    heroTitle: 'Rakan tempatan anda untuk hari yang baik seterusnya.',
    heroDescription: 'Bercakap secara semula jadi. Saya mencari daripada katalog tempat Malaysia kami, menyemak tarikh, cuaca dan kesesuaian tumpangan, kemudian menerangkan tiga pilihan yang jujur.',
    onboardingTitle: 'Kenali Tumpang Guide', onboardingDescription: 'Pembantu perjalanan terkawal, bukan chatbot web terbuka.',
    onboardingNext: 'Seterusnya', onboardingStart: 'Mula merancang', onboardingFreeTier: 'Pendedahan pelan percuma:',
    loadingLanguage: 'Memuatkan bahasa…', suggestedReplies: 'Balasan dicadangkan', quickNature: 'Hari alam esok', quickFood: 'Makanan hujung minggu ini', quickHelp: 'Bagaimana ini berfungsi?', quickPractical: 'Jadikan lebih praktikal', quickDifferent: 'Cadangkan tempat lain', quickDate: 'Tukar tarikh', callEmergency: 'Hubungi 999', trustedFamily: 'Trusted Family', feedbackReason: 'Sebab maklum balas',
    chooseFeedbackReason: 'Pilih sebab', feedbackBadTradeoff: 'Pertukaran tidak jelas', feedbackWrongLanguage: 'Bahasa tidak betul', feedbackOther: 'Isu lain', openConversation: 'Buka sembang ini →', requestCatalogue: 'Minta semakan katalog',
    catalogueQueued: 'Permintaan anda telah dimasukkan ke dalam barisan semakan katalog.', catalogueMissing: 'Tempat itu belum ada dalam katalog kami.', savedPlanDescription: 'Sembang anda yang berdaftar berasingan daripada mesej Modul 3.',
    delete: 'Padam', deleteAll: 'Padam semua', backToGuide: 'Kembali ke Tumpang Guide', signIn: 'Log masuk',
    guestNotSaved: 'Sembang tetamu tidak disimpan.', accountRequiredTitle: 'Pelan terdahulu memerlukan akaun',
    loadingPlans: 'Memuatkan pelan tersimpan…', plansUnavailable: 'Pelan terdahulu tidak tersedia', retry: 'Cuba lagi',
    noSavedPlans: 'Belum ada pelan tersimpan', noSavedPlansDescription: 'Mulakan sembang Guide dan ia akan muncul di sini.',
    dateNotDecided: 'Tarikh belum diputuskan', originNotDecided: 'Tempat mula belum diputuskan', privateRetention: 'Peribadi · simpan 90 hari', startingPointPlaceholder: 'contoh: Kuala Lumpur', startVoice: 'Mulakan input suara', stopVoice: 'Hentikan input suara', sendMessage: 'Hantar mesej', showMore: 'Tunjukkan lebih banyak tempat katalog', onboardingCatalogueTitle: 'Katalog sahaja', onboardingCatalogueDescription: 'Setiap cadangan mesti mempunyai Place ID dalam pangkalan data kami.', onboardingPrivacyTitle: 'Peribadi selama 90 hari', onboardingPrivacyDescription: 'Sembang tetamu tidak disimpan. Sembang berdaftar dipadam selepas 90 hari.', onboardingHistoryTitle: 'Sejarah pilihan anda', onboardingHistoryDescription: 'Trip History dimatikan sehingga anda membenarkannya untuk sesi ini.', onboardingFreeTierDescription: 'Apabila Gemini diaktifkan, terma penyedia mungkin membenarkan arahan dan balasan digunakan untuk menambah baik produk. Kenalan, ID akaun dan koordinat tepat tidak dihantar.', heroMediaTitle: 'Malaysia, cara anda', heroMediaDescription: 'tempat disahkan · pertukaran yang jujur', batchLabel: 'Kumpulan cadangan', photoCredit: 'Foto',
    preferencesSaved: 'Pilihan perjalanan disimpan.', catalogueRequestSaved: 'Permintaan semakan katalog dihantar.', actionFailed: 'Tindakan ini tidak dapat diselesaikan.', feedbackError: 'Maklum balas tidak dapat disimpan.', feedbackUnavailable: 'Maklum balas tersedia selepas sesi Guide disimpan.', persistenceWarning: 'Gemini telah membalas, tetapi giliran ini tidak dapat disimpan. Cuba lagi sebelum meninggalkan sembang ini.', languageUnavailable: 'Pek bahasa ini buat sementara tidak tersedia. Guide menggunakan salinan Bahasa Inggeris yang lengkap.',
    reviewsHeading: 'Kata pengunjung', gettingThere: 'Cara ke sana', whyGuide: 'Mengapa kami mencadangkan tempat ini', previousPhoto: 'Foto sebelumnya', nextPhoto: 'Foto seterusnya',
    voiceUnsupported: 'Input suara tidak disokong oleh pelayar ini.', voicePermissionDenied: 'Kebenaran mikrofon ditolak.', voiceNoSpeech: 'Tiada pertuturan dikenal pasti. Anda boleh terus menaip.', voiceLanguageUnsupported: 'Bahasa ini tidak disokong untuk input suara. Anda boleh terus menaip.', voiceStopped: 'Input suara dihentikan. Anda boleh terus menaip.', voiceStartFailed: 'Input suara tidak dapat dimulakan. Anda boleh terus menaip.'
  },
  ta: {
    heroTitle: 'அடுத்த சிறந்த நாளுக்கான உங்கள் உள்ளூர் நண்பர்.',
    heroDescription: 'இயல்பாகப் பேசுங்கள். எங்கள் மலேசிய இடப் பட்டியலில் இருந்து தேடி, தேதி, வானிலை மற்றும் பகிர்ந்து பயணிக்கும் வசதியைச் சரிபார்த்து, மூன்று நேர்மையான தேர்வுகளை விளக்குகிறேன்.',
    onboardingTitle: 'Tumpang Guide-ஐ அறிமுகப்படுத்துகிறோம்', onboardingDescription: 'இது கட்டுப்படுத்தப்பட்ட பயண உதவியாளர்; திறந்த இணைய chatbot அல்ல.',
    onboardingNext: 'அடுத்து', onboardingStart: 'திட்டமிடத் தொடங்கு', onboardingFreeTier: 'இலவச அடுக்கு விளக்கம்:',
    loadingLanguage: 'மொழி ஏற்றப்படுகிறது…', suggestedReplies: 'பரிந்துரைக்கப்பட்ட பதில்கள்', quickNature: 'நாளை இயற்கை நாள்', quickFood: 'இந்த வார இறுதி உணவு', quickHelp: 'இது எப்படி செயல்படும்?', quickPractical: 'இன்னும் நடைமுறையான இடம்', quickDifferent: 'வேறு இடங்களைப் பரிந்துரைக்கவும்', quickDate: 'தேதியை மாற்றவும்', callEmergency: '999 அழைக்கவும்', trustedFamily: 'Trusted Family', feedbackReason: 'கருத்து காரணம்',
    chooseFeedbackReason: 'காரணத்தைத் தேர்ந்தெடுக்கவும்', feedbackBadTradeoff: 'சமரசம் தெளிவாக இல்லை', feedbackWrongLanguage: 'மொழி தவறாக உள்ளது', feedbackOther: 'மற்றொரு சிக்கல்', openConversation: 'இந்த உரையாடலைத் திறக்கவும் →', requestCatalogue: 'பட்டியல் மதிப்பாய்வைக் கோருங்கள்',
    catalogueQueued: 'உங்கள் கோரிக்கை பட்டியல் சரிபார்ப்பு வரிசையில் சேர்க்கப்பட்டது.', catalogueMissing: 'அந்த இடம் இன்னும் எங்கள் பட்டியலில் இல்லை.', savedPlanDescription: 'உள்நுழைந்த உரையாடல்கள் Module 3 செய்திகளிலிருந்து தனியாக இருக்கும்.',
    delete: 'நீக்கு', deleteAll: 'அனைத்தையும் நீக்கு', backToGuide: 'Tumpang Guide-க்கு திரும்பு', signIn: 'உள்நுழைக',
    guestNotSaved: 'விருந்தினர் உரையாடல்கள் சேமிக்கப்படாது.', accountRequiredTitle: 'முந்தைய திட்டங்களுக்கு கணக்கு தேவை',
    loadingPlans: 'சேமித்த திட்டங்கள் ஏற்றப்படுகின்றன…', plansUnavailable: 'முந்தைய திட்டங்கள் கிடைக்கவில்லை', retry: 'மீண்டும் முயற்சி',
    noSavedPlans: 'சேமித்த திட்டங்கள் இல்லை', noSavedPlansDescription: 'Guide உரையாடலைத் தொடங்குங்கள்; அது இங்கே தோன்றும்.',
    dateNotDecided: 'தேதி முடிவு செய்யப்படவில்லை', originNotDecided: 'தொடக்க இடம் முடிவு செய்யப்படவில்லை', privateRetention: 'தனிப்பட்டது · 90 நாள் சேமிப்பு', startingPointPlaceholder: 'உதாரணம்: கோலாலம்பூர்', startVoice: 'குரல் உள்ளீட்டைத் தொடங்கு', stopVoice: 'குரல் உள்ளீட்டை நிறுத்து', sendMessage: 'செய்தி அனுப்பு', showMore: 'மேலும் பட்டியல் இடங்களைக் காட்டு', onboardingCatalogueTitle: 'பட்டியல் மட்டும்', onboardingCatalogueDescription: 'ஒவ்வொரு பரிந்துரையும் எங்கள் தரவுத்தளத்தில் உள்ள Place ID-ஐ கொண்டிருக்க வேண்டும்.', onboardingPrivacyTitle: '90 நாட்கள் தனிப்பட்டது', onboardingPrivacyDescription: 'விருந்தினர் உரையாடல்கள் சேமிக்கப்படாது; உள்நுழைந்த உரையாடல்கள் 90 நாட்களில் நீக்கப்படும்.', onboardingHistoryTitle: 'வரலாறு உங்கள் விருப்பம்', onboardingHistoryDescription: 'Trip History இயல்பாக முடக்கப்பட்டுள்ளது; இந்த அமர்வுக்கு மட்டும் அனுமதிக்கலாம்.', onboardingFreeTierDescription: 'Gemini இயக்கப்பட்டால், வழங்குநரின் விதிமுறைகள் குறிப்புகளையும் பதில்களையும் தயாரிப்புகளை மேம்படுத்த பயன்படுத்த அனுமதிக்கலாம். தொடர்புகள், கணக்கு ID மற்றும் துல்லியமான இருப்பிடம் அனுப்பப்படாது.', heroMediaTitle: 'மலேசியா, உங்கள் வழியில்', heroMediaDescription: 'சரிபார்க்கப்பட்ட இடங்கள் · நேர்மையான சமரசங்கள்', batchLabel: 'பரிந்துரை தொகுப்பு', photoCredit: 'புகைப்படம்',
    preferencesSaved: 'பயண விருப்பங்கள் சேமிக்கப்பட்டன.', catalogueRequestSaved: 'பட்டியல் மதிப்பாய்வு கோரிக்கை அனுப்பப்பட்டது.', actionFailed: 'இந்தச் செயலை முடிக்க முடியவில்லை.', feedbackError: 'கருத்தைச் சேமிக்க முடியவில்லை.', feedbackUnavailable: 'Guide உரையாடல் சேமிக்கப்பட்ட பிறகு கருத்து கிடைக்கும்.', persistenceWarning: 'Gemini பதிலளித்தது, ஆனால் இந்தத் திருப்பம் சேமிக்கப்படவில்லை. இந்த உரையாடலை விட்டு வெளியேறும் முன் மீண்டும் முயற்சிக்கவும்.', languageUnavailable: 'இந்த மொழிப் பொதி தற்காலிகமாக கிடைக்கவில்லை. Guide முழுமையான ஆங்கில உரையைப் பயன்படுத்துகிறது.',
    reviewsHeading: 'பயணிகள் கூறுவது', gettingThere: 'அங்கு செல்வது எப்படி', whyGuide: 'இந்த இடத்தை ஏன் பரிந்துரைத்தோம்', previousPhoto: 'முந்தைய படம்', nextPhoto: 'அடுத்த படம்',
    voiceUnsupported: 'இந்த உலாவியில் குரல் உள்ளீடு ஆதரிக்கப்படவில்லை.', voicePermissionDenied: 'மைக்ரோஃபோன் அனுமதி மறுக்கப்பட்டது.', voiceNoSpeech: 'பேச்சு அடையாளம் காணப்படவில்லை. தொடர்ந்து தட்டச்சு செய்யலாம்.', voiceLanguageUnsupported: 'இந்த மொழியில் குரல் உள்ளீடு ஆதரிக்கப்படவில்லை. தொடர்ந்து தட்டச்சு செய்யலாம்.', voiceStopped: 'குரல் உள்ளீடு நிறுத்தப்பட்டது. தொடர்ந்து தட்டச்சு செய்யலாம்.', voiceStartFailed: 'குரல் உள்ளீட்டைத் தொடங்க முடியவில்லை. தொடர்ந்து தட்டச்சு செய்யலாம்.'
  }
});

export function isCompleteGuideLanguagePack(pack) {
  const copy = pack?.copy || pack;
  return Boolean(copy && REQUIRED_PACK_PATHS.every((key) => typeof copy[key] === 'string')
    && ['best_match', 'practical_alternative', 'wildcard'].every((key) => typeof copy.roles?.[key] === 'string')
    && ['culinary', 'heritage', 'nature', 'event'].every((key) => typeof copy.categories?.[key] === 'string')
    && Object.values(GUIDE_TRADEOFF).every((key) => typeof copy.tradeoffs?.[key] === 'string')
    && Object.values(GUIDE_REASON).every((key) => typeof copy.reasons?.[key] === 'string'));
}

function withExtraCoreCopy(language, copy) {
  return { ...EXTRA_CORE_COPY.en, ...(EXTRA_CORE_COPY[normalizeGuideLanguage(language)] || {}), ...copy };
}

export function normalizeGuideLanguage(value) {
  const raw = String(value || '').trim();
  if (GUIDE_LANGUAGES.includes(raw)) return raw;
  const compact = raw.toLowerCase();
  const direct = GUIDE_LANGUAGES.find((tag) => tag.toLowerCase() === compact);
  if (direct) return direct;
  if (compact.startsWith('zh')) return GUIDE_LANGUAGE.CHINESE;
  if (compact.startsWith('ms') || compact.startsWith('bm')) return GUIDE_LANGUAGE.MALAY;
  if (compact.startsWith('ta')) return GUIDE_LANGUAGE.TAMIL;
  if (compact.startsWith('id')) return 'id';
  if (compact.startsWith('ja')) return 'ja';
  if (compact.startsWith('ko')) return 'ko';
  if (/^[a-z]{2,3}(?:-[a-z]{2,8})?$/i.test(raw)) return raw;
  return GUIDE_LANGUAGE.ENGLISH;
}

export function isCoreGuideLanguage(language) {
  return GUIDE_CORE_LANGUAGES.includes(normalizeGuideLanguage(language));
}

export function detectGuideLanguage(text, fallback = GUIDE_LANGUAGE.ENGLISH) {
  const value = String(text || '');
  if (/[஀-௿]/u.test(value)) return GUIDE_LANGUAGE.TAMIL;
  if (/[㐀-鿿]/u.test(value)) return GUIDE_LANGUAGE.CHINESE;
  if (/\b(?:saya|kami|nak|mahu|pergi|tempat|makanan|warisan|cuaca|tolong)\b/i.test(value)) return GUIDE_LANGUAGE.MALAY;
  return normalizeGuideLanguage(fallback);
}

export function getInitialGuideLanguage() {
  if (typeof localStorage !== 'undefined') {
    try { const saved = localStorage.getItem('letstumpang_m6_guide_language_v1'); if (saved) return normalizeGuideLanguage(saved); } catch { /* no-op */ }
  }
  const browser = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return normalizeGuideLanguage(browser);
}

export function guideLanguageLabel(language) {
  return GUIDE_LANGUAGE_OPTIONS.find((option) => option.value === normalizeGuideLanguage(language))?.label
    || normalizeGuideLanguage(language);
}

function dynamicCopy(language, pack) {
  const copy = pack?.copy || pack;
  if (!isCompleteGuideLanguagePack({ copy })) return null;
  if (pack?.language && normalizeGuideLanguage(pack.language) !== normalizeGuideLanguage(language)) return null;
  const remainingTemplate = copy.remaining;
  return withExtraCoreCopy(language, { ...copy, remaining: (n) => String(remainingTemplate).replace('{n}', String(n)) });
}

export function guideCopy(language, pack = null) {
  const normalized = normalizeGuideLanguage(language);
  return dynamicCopy(normalized, pack) || withExtraCoreCopy(normalized, CORE[normalized] || CORE.en);
}

export function guideCategoryLabel(category, language, pack) {
  const normalized = String(category || '').trim().toLocaleLowerCase();
  return guideCopy(language, pack).categories?.[normalized] || category;
}

export function guideRoleLabel(role, language, pack) {
  const copy = guideCopy(language, pack);
  const normalized = String(role || '').trim().toLowerCase();
  return copy.roles?.[normalized] || copy.roles?.[GUIDE_ROLE.WILDCARD] || role;
}

export function guideTradeoffLabel(code, language, pack) {
  const copy = guideCopy(language, pack);
  const normalized = String(code || '').trim().toLowerCase();
  return copy.tradeoffs?.[normalized] || copy.tradeoffs?.[GUIDE_TRADEOFF.NONE] || code;
}

export function guideReasonText(code, place = {}, plan = {}, language = GUIDE_LANGUAGE.ENGLISH, pack = null) {
  const copy = guideCopy(language, pack);
  const template = copy.reasons?.[code];
  if (typeof template !== 'string') return null;
  const normalized = normalizeGuideLanguage(language);
  const missingPlace = normalized === GUIDE_LANGUAGE.CHINESE ? '这个地点'
    : normalized === GUIDE_LANGUAGE.MALAY ? 'tempat ini'
      : normalized === GUIDE_LANGUAGE.TAMIL ? 'இந்த இடம்' : 'this place';
  const missingOrigin = plan.origin?.label || copy.startingPoint || (normalized === GUIDE_LANGUAGE.CHINESE ? '你的出发地' : normalized === GUIDE_LANGUAGE.MALAY ? 'tempat mula anda' : normalized === GUIDE_LANGUAGE.TAMIL ? 'உங்கள் தொடக்க இடம்' : 'your starting point');
  const missingParty = String(plan.partySize || copy.people || (normalized === GUIDE_LANGUAGE.CHINESE ? '你的同行人数' : normalized === GUIDE_LANGUAGE.MALAY ? 'kumpulan anda' : normalized === GUIDE_LANGUAGE.TAMIL ? 'உங்கள் குழு' : 'your group'));
  return template.replaceAll('{{category}}', guideCategoryLabel(place.category || 'destination', language, pack))
    .replaceAll('{{name}}', place.name || missingPlace)
    .replaceAll('{{origin}}', missingOrigin)
    .replaceAll('{{party}}', missingParty);
}

export function guideFeedbackReasons(language, pack = null) {
  const copy = guideCopy(language, pack);
  return [
    { value: 'not_relevant', label: copy.notRelevant },
    { value: 'bad_tradeoff', label: copy.feedbackBadTradeoff || EXTRA_CORE_COPY.en.feedbackBadTradeoff },
    { value: 'wrong_language', label: copy.feedbackWrongLanguage || EXTRA_CORE_COPY.en.feedbackWrongLanguage },
    { value: 'other', label: copy.feedbackOther || EXTRA_CORE_COPY.en.feedbackOther }
  ];
}

export function guideHelpSourceLabel(source, language, pack = null) {
  return source === 'vector' ? guideCopy(language, pack).verifiedRules : guideCopy(language, pack).sourceRules;
}

const FALLBACK_REASON_LABELS = Object.freeze({
  en: {
    timeout: 'request timeout', provider_429: 'provider limit', provider_unavailable: 'provider unavailable',
    gemini_disabled: 'Gemini is not enabled', invalid_json_shape: 'invalid provider response',
    provider_changed_rule_batch: 'provider changed the verified batch', duplicate_shown_place: 'a previously shown place was rejected', offline: 'offline',
    response_language_mismatch: 'provider returned the wrong language', quota_unavailable: 'server quota is unavailable', no_verified_candidates: 'no verified candidates', catalogue_unavailable: 'catalogue unavailable', live_catalogue_not_configured: 'live catalogue is not configured',
    help_source_missing: 'help source unavailable', rate_limit: 'turn limit reached'
  },
  'zh-CN': {
    timeout: '请求超时', provider_429: '服务额度限制', provider_unavailable: '服务暂时不可用',
    gemini_disabled: 'Gemini 尚未启用', invalid_json_shape: '服务回复格式无效',
    provider_changed_rule_batch: '服务更改了已验证推荐批次', duplicate_shown_place: '已阻止重复展示之前的地点', offline: '目前离线',
    response_language_mismatch: '服务返回了错误的语言', quota_unavailable: '服务器额度服务暂时不可用', no_verified_candidates: '没有符合条件的已验证地点', catalogue_unavailable: '地点目录暂时不可用', live_catalogue_not_configured: '尚未配置实时地点目录',
    help_source_missing: '帮助内容暂时不可用', rate_limit: '对话额度已用完'
  },
  ms: {
    timeout: 'permintaan tamat masa', provider_429: 'had penyedia dicapai', provider_unavailable: 'penyedia tidak tersedia',
    gemini_disabled: 'Gemini belum diaktifkan', invalid_json_shape: 'jawapan penyedia tidak sah',
    provider_changed_rule_batch: 'penyedia mengubah kumpulan disahkan', duplicate_shown_place: 'tempat yang telah dipaparkan ditolak', offline: 'luar talian',
    response_language_mismatch: 'penyedia mengembalikan bahasa yang salah', quota_unavailable: 'kuota pelayan tidak tersedia', no_verified_candidates: 'tiada tempat disahkan yang sesuai', catalogue_unavailable: 'katalog tidak tersedia', live_catalogue_not_configured: 'katalog langsung belum dikonfigurasi',
    help_source_missing: 'sumber bantuan tidak tersedia', rate_limit: 'had pusingan dicapai'
  },
  ta: {
    timeout: 'கோரிக்கை நேரம் முடிந்தது', provider_429: 'சேவை வரம்பு எட்டப்பட்டது', provider_unavailable: 'சேவை கிடைக்கவில்லை',
    gemini_disabled: 'Gemini இயக்கப்படவில்லை', invalid_json_shape: 'சேவை பதில் தவறானது',
    provider_changed_rule_batch: 'சேவை சரிபார்க்கப்பட்ட தொகுப்பை மாற்றியது', duplicate_shown_place: 'முன்பு காட்டிய இடம் மீண்டும் காட்டப்படவில்லை', offline: 'இணையம் இல்லை',
    response_language_mismatch: 'சேவை தவறான மொழியில் பதிலளித்தது', quota_unavailable: 'சேவையக ஒதுக்கீடு கிடைக்கவில்லை', no_verified_candidates: 'சரிபார்க்கப்பட்ட இடம் பொருந்தவில்லை', catalogue_unavailable: 'பட்டியல் கிடைக்கவில்லை', live_catalogue_not_configured: 'நேரடி இடப் பட்டியல் கட்டமைக்கப்படவில்லை',
    help_source_missing: 'உதவி ஆதாரம் கிடைக்கவில்லை', rate_limit: 'உரையாடல் வரம்பு எட்டப்பட்டது'
  }
});

export function guideFallbackReasonLabel(reason, language, pack = null) {
  const normalized = normalizeGuideLanguage(language);
  const labels = FALLBACK_REASON_LABELS[normalized] || FALLBACK_REASON_LABELS.en;
  return labels[String(reason || '')] || String(reason || '').replaceAll('_', ' ');
}

export function isKnownGuideLanguage(language) {
  return GUIDE_LANGUAGES.includes(normalizeGuideLanguage(language)) || /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(String(language || ''));
}

export const GUIDE_LANGUAGE_PACK_REQUIRED_KEYS = REQUIRED_PACK_PATHS;
