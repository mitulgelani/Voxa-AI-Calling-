// Languages the agent can speak, each with free Edge neural voices that sound native.
// `speech` is the BCP-47 tag for the browser recogniser and SSML; `whisper` is the
// Whisper language code. Every voice here is in Edge's free read-aloud catalogue.

export interface Voice {
  id: string;
  label: string;
  group: 'Female' | 'Male';
  tone: string;
}

export interface Language {
  id: string;
  label: string;
  /** Name in its own script, shown next to the label. */
  native: string;
  speech: string;
  whisper: string;
  voices: Voice[];
  /** Short listening sounds used when a reply is slow. */
  bridges: string[];
  /** Spoken when the model fails, so the line never goes dead. */
  sorry: string;
  /** Voice preview line; {name} is replaced with the voice name. */
  sample: string;
  /** Extra instruction for the model about how to speak. */
  style: string;
}

const v = (id: string, label: string, group: Voice['group'], tone: string): Voice => ({ id, label, group, tone });

export const LANGUAGES: Language[] = [
  {
    id: 'en-US', label: 'English (US)', native: 'English', speech: 'en-US', whisper: 'en',
    voices: [
      v('en-US-AriaNeural', 'Aria', 'Female', 'natural, expressive'),
      v('en-US-AvaNeural', 'Ava', 'Female', 'warm'),
      v('en-US-EmmaNeural', 'Emma', 'Female', 'cheerful'),
      v('en-US-JennyNeural', 'Jenny', 'Female', 'friendly'),
      v('en-US-AvaMultilingualNeural', 'Ava Natural', 'Female', 'most human'),
      v('en-US-AndrewNeural', 'Andrew', 'Male', 'confident'),
      v('en-US-BrianNeural', 'Brian', 'Male', 'casual'),
      v('en-US-GuyNeural', 'Guy', 'Male', 'lively'),
      v('en-US-AndrewMultilingualNeural', 'Andrew Natural', 'Male', 'most human'),
    ],
    bridges: ['Mm-hmm.', 'Right.', 'Okay.', 'Sure.'],
    sorry: 'Sorry, could you say that again?',
    sample: "Hi, I'm {name}. This is how I'll sound on your calls.",
    style: 'Speak natural, casual American English.',
  },
  {
    id: 'en-IN', label: 'English (India)', native: 'English', speech: 'en-IN', whisper: 'en',
    voices: [v('en-IN-NeerjaNeural', 'Neerja', 'Female', 'warm'), v('en-IN-PrabhatNeural', 'Prabhat', 'Male', 'calm')],
    bridges: ['Hmm.', 'Right.', 'Okay.', 'Sure.'],
    sorry: 'Sorry, could you please say that again?',
    sample: "Hi, I'm {name}. This is how I'll sound on your calls.",
    style: 'Speak friendly Indian English, the way people talk on calls in India.',
  },
  {
    id: 'en-GB', label: 'English (UK)', native: 'English', speech: 'en-GB', whisper: 'en',
    voices: [v('en-GB-SoniaNeural', 'Sonia', 'Female', 'polished'), v('en-GB-RyanNeural', 'Ryan', 'Male', 'friendly')],
    bridges: ['Mm.', 'Right.', 'Okay.', 'Sure.'],
    sorry: 'Sorry, could you say that again?',
    sample: "Hi, I'm {name}. This is how I'll sound on your calls.",
    style: 'Speak natural British English.',
  },
  {
    id: 'hi-IN', label: 'Hindi', native: 'हिन्दी', speech: 'hi-IN', whisper: 'hi',
    voices: [v('hi-IN-SwaraNeural', 'Swara', 'Female', 'warm'), v('hi-IN-MadhurNeural', 'Madhur', 'Male', 'friendly')],
    bridges: ['हम्म।', 'अच्छा।', 'जी।', 'ठीक है।'],
    sorry: 'माफ़ कीजिए, क्या आप फिर से बोल सकते हैं?',
    sample: 'नमस्ते, मैं {name} हूँ। आपकी कॉल पर मेरी आवाज़ ऐसी सुनाई देगी।',
    style: 'Speak everyday spoken Hindi in Devanagari script, simple and polite, not formal or textbook Hindi. Use आप.',
  },
  {
    id: 'hinglish', label: 'Hinglish', native: 'Hindi + English', speech: 'hi-IN', whisper: 'hi',
    voices: [v('hi-IN-SwaraNeural', 'Swara', 'Female', 'warm'), v('hi-IN-MadhurNeural', 'Madhur', 'Male', 'friendly')],
    bridges: ['हम्म।', 'अच्छा।', 'जी।', 'ओके।'],
    sorry: 'Sorry, क्या आप एक बार फिर बोल सकते हैं?',
    sample: 'Hi, मैं {name} हूँ। आपकी calls पर मेरी आवाज़ ऐसी सुनाई देगी।',
    style:
      'Speak Hinglish like urban Indians on a phone call: Hindi sentences in Devanagari script, with common English words (call, time, okay, problem, order, payment) kept in English letters.',
  },
  {
    id: 'gu-IN', label: 'Gujarati', native: 'ગુજરાતી', speech: 'gu-IN', whisper: 'gu',
    voices: [v('gu-IN-DhwaniNeural', 'Dhwani', 'Female', 'warm'), v('gu-IN-NiranjanNeural', 'Niranjan', 'Male', 'friendly')],
    bridges: ['હમ્મ.', 'સારું.', 'હા.', 'બરાબર.'],
    sorry: 'માફ કરશો, તમે ફરીથી કહી શકશો?',
    sample: 'નમસ્તે, હું {name} છું. તમારા કૉલ પર મારો અવાજ આવો સંભળાશે.',
    style: 'Speak everyday spoken Gujarati in Gujarati script.',
  },
  {
    id: 'mr-IN', label: 'Marathi', native: 'मराठी', speech: 'mr-IN', whisper: 'mr',
    voices: [v('mr-IN-AarohiNeural', 'Aarohi', 'Female', 'warm'), v('mr-IN-ManoharNeural', 'Manohar', 'Male', 'friendly')],
    bridges: ['हम्म.', 'बरं.', 'हो.', 'ठीक आहे.'],
    sorry: 'माफ करा, तुम्ही पुन्हा सांगू शकाल का?',
    sample: 'नमस्कार, मी {name} आहे. तुमच्या कॉलवर माझा आवाज असा ऐकू येईल.',
    style: 'Speak everyday spoken Marathi in Devanagari script.',
  },
  {
    id: 'ta-IN', label: 'Tamil', native: 'தமிழ்', speech: 'ta-IN', whisper: 'ta',
    voices: [v('ta-IN-PallaviNeural', 'Pallavi', 'Female', 'warm'), v('ta-IN-ValluvarNeural', 'Valluvar', 'Male', 'calm')],
    bridges: ['ம்ம்.', 'சரி.', 'ஆமா.'],
    sorry: 'மன்னிக்கவும், மீண்டும் சொல்ல முடியுமா?',
    sample: 'வணக்கம், நான் {name}. உங்கள் அழைப்புகளில் என் குரல் இப்படித்தான் இருக்கும்.',
    style: 'Speak everyday spoken Tamil in Tamil script.',
  },
  {
    id: 'te-IN', label: 'Telugu', native: 'తెలుగు', speech: 'te-IN', whisper: 'te',
    voices: [v('te-IN-ShrutiNeural', 'Shruti', 'Female', 'warm'), v('te-IN-MohanNeural', 'Mohan', 'Male', 'calm')],
    bridges: ['హ్మ్.', 'సరే.', 'అవును.'],
    sorry: 'క్షమించండి, మళ్ళీ చెప్పగలరా?',
    sample: 'నమస్తే, నేను {name}. మీ కాల్స్‌లో నా గొంతు ఇలా వినిపిస్తుంది.',
    style: 'Speak everyday spoken Telugu in Telugu script.',
  },
  {
    id: 'bn-IN', label: 'Bengali', native: 'বাংলা', speech: 'bn-IN', whisper: 'bn',
    voices: [v('bn-IN-TanishaaNeural', 'Tanishaa', 'Female', 'warm'), v('bn-IN-BashkarNeural', 'Bashkar', 'Male', 'calm')],
    bridges: ['হুম।', 'আচ্ছা।', 'ঠিক আছে।'],
    sorry: 'দুঃখিত, আবার একবার বলবেন?',
    sample: 'নমস্কার, আমি {name}। আপনার কলে আমার গলা এরকম শোনাবে।',
    style: 'Speak everyday spoken Bengali in Bengali script.',
  },
  {
    id: 'kn-IN', label: 'Kannada', native: 'ಕನ್ನಡ', speech: 'kn-IN', whisper: 'kn',
    voices: [v('kn-IN-SapnaNeural', 'Sapna', 'Female', 'warm'), v('kn-IN-GaganNeural', 'Gagan', 'Male', 'calm')],
    bridges: ['ಹ್ಮ್.', 'ಸರಿ.', 'ಹೌದು.'],
    sorry: 'ಕ್ಷಮಿಸಿ, ಮತ್ತೊಮ್ಮೆ ಹೇಳುತ್ತೀರಾ?',
    sample: 'ನಮಸ್ಕಾರ, ನಾನು {name}. ನಿಮ್ಮ ಕರೆಗಳಲ್ಲಿ ನನ್ನ ಧ್ವನಿ ಹೀಗೆ ಕೇಳಿಸುತ್ತದೆ.',
    style: 'Speak everyday spoken Kannada in Kannada script.',
  },
  {
    id: 'ml-IN', label: 'Malayalam', native: 'മലയാളം', speech: 'ml-IN', whisper: 'ml',
    voices: [v('ml-IN-SobhanaNeural', 'Sobhana', 'Female', 'warm'), v('ml-IN-MidhunNeural', 'Midhun', 'Male', 'calm')],
    bridges: ['ഹ്മ്.', 'ശരി.', 'അതെ.'],
    sorry: 'ക്ഷമിക്കണം, ഒന്നുകൂടി പറയാമോ?',
    sample: 'നമസ്കാരം, ഞാൻ {name}. നിങ്ങളുടെ കോളുകളിൽ എന്റെ ശബ്ദം ഇങ്ങനെയായിരിക്കും.',
    style: 'Speak everyday spoken Malayalam in Malayalam script.',
  },
  {
    id: 'ur-IN', label: 'Urdu', native: 'اردو', speech: 'ur-IN', whisper: 'ur',
    voices: [v('ur-IN-GulNeural', 'Gul', 'Female', 'warm'), v('ur-IN-SalmanNeural', 'Salman', 'Male', 'calm')],
    bridges: ['ہمم۔', 'اچھا۔', 'جی۔'],
    sorry: 'معاف کیجیے، کیا آپ دوبارہ کہہ سکتے ہیں؟',
    sample: 'السلام علیکم، میں {name} ہوں۔ آپ کی کالز پر میری آواز ایسی سنائی دے گی۔',
    style: 'Speak everyday spoken Urdu in Urdu script.',
  },
  {
    id: 'es-ES', label: 'Spanish (Spain)', native: 'Español', speech: 'es-ES', whisper: 'es',
    voices: [v('es-ES-ElviraNeural', 'Elvira', 'Female', 'warm'), v('es-ES-AlvaroNeural', 'Álvaro', 'Male', 'friendly')],
    bridges: ['Ajá.', 'Vale.', 'Claro.'],
    sorry: 'Perdona, ¿me lo puedes repetir?',
    sample: 'Hola, soy {name}. Así sonaré en tus llamadas.',
    style: 'Speak natural spoken Spanish from Spain.',
  },
  {
    id: 'es-MX', label: 'Spanish (Mexico)', native: 'Español', speech: 'es-MX', whisper: 'es',
    voices: [v('es-MX-DaliaNeural', 'Dalia', 'Female', 'warm'), v('es-MX-JorgeNeural', 'Jorge', 'Male', 'friendly')],
    bridges: ['Ajá.', 'Claro.', 'Sí.'],
    sorry: 'Disculpa, ¿me lo puedes repetir?',
    sample: 'Hola, soy {name}. Así voy a sonar en tus llamadas.',
    style: 'Speak natural spoken Latin American Spanish.',
  },
  {
    id: 'fr-FR', label: 'French', native: 'Français', speech: 'fr-FR', whisper: 'fr',
    voices: [
      v('fr-FR-DeniseNeural', 'Denise', 'Female', 'warm'),
      v('fr-FR-VivienneMultilingualNeural', 'Vivienne', 'Female', 'most human'),
      v('fr-FR-HenriNeural', 'Henri', 'Male', 'friendly'),
      v('fr-FR-RemyMultilingualNeural', 'Rémy', 'Male', 'most human'),
    ],
    bridges: ['Mm-hmm.', "D'accord.", 'Oui.'],
    sorry: 'Pardon, vous pouvez répéter ?',
    sample: "Bonjour, je suis {name}. Voilà comment je sonnerai pendant vos appels.",
    style: 'Speak natural spoken French.',
  },
  {
    id: 'de-DE', label: 'German', native: 'Deutsch', speech: 'de-DE', whisper: 'de',
    voices: [
      v('de-DE-KatjaNeural', 'Katja', 'Female', 'warm'),
      v('de-DE-SeraphinaMultilingualNeural', 'Seraphina', 'Female', 'most human'),
      v('de-DE-ConradNeural', 'Conrad', 'Male', 'calm'),
      v('de-DE-FlorianMultilingualNeural', 'Florian', 'Male', 'most human'),
    ],
    bridges: ['Mhm.', 'Genau.', 'Okay.'],
    sorry: 'Entschuldigung, können Sie das wiederholen?',
    sample: 'Hallo, ich bin {name}. So klinge ich bei Ihren Anrufen.',
    style: 'Speak natural spoken German.',
  },
  {
    id: 'pt-BR', label: 'Portuguese (Brazil)', native: 'Português', speech: 'pt-BR', whisper: 'pt',
    voices: [
      v('pt-BR-FranciscaNeural', 'Francisca', 'Female', 'warm'),
      v('pt-BR-ThalitaMultilingualNeural', 'Thalita', 'Female', 'most human'),
      v('pt-BR-AntonioNeural', 'Antônio', 'Male', 'friendly'),
    ],
    bridges: ['Uhum.', 'Certo.', 'Tá.'],
    sorry: 'Desculpa, pode repetir?',
    sample: 'Oi, eu sou {name}. É assim que vou soar nas suas ligações.',
    style: 'Speak natural spoken Brazilian Portuguese.',
  },
  {
    id: 'it-IT', label: 'Italian', native: 'Italiano', speech: 'it-IT', whisper: 'it',
    voices: [v('it-IT-ElsaNeural', 'Elsa', 'Female', 'warm'), v('it-IT-DiegoNeural', 'Diego', 'Male', 'friendly')],
    bridges: ['Mm.', 'Certo.', 'Sì.'],
    sorry: 'Scusi, può ripetere?',
    sample: 'Ciao, sono {name}. Ecco come suonerò nelle tue chiamate.',
    style: 'Speak natural spoken Italian.',
  },
  {
    id: 'ar-SA', label: 'Arabic', native: 'العربية', speech: 'ar-SA', whisper: 'ar',
    voices: [v('ar-SA-ZariyahNeural', 'Zariyah', 'Female', 'warm'), v('ar-SA-HamedNeural', 'Hamed', 'Male', 'calm')],
    bridges: ['نعم.', 'تمام.', 'طيب.'],
    sorry: 'عذرًا، هل يمكنك أن تعيد ذلك؟',
    sample: 'مرحبًا، أنا {name}. هكذا سيبدو صوتي في مكالماتك.',
    style: 'Speak simple, natural spoken Arabic in Arabic script.',
  },
  {
    id: 'ru-RU', label: 'Russian', native: 'Русский', speech: 'ru-RU', whisper: 'ru',
    voices: [v('ru-RU-SvetlanaNeural', 'Svetlana', 'Female', 'warm'), v('ru-RU-DmitryNeural', 'Dmitry', 'Male', 'calm')],
    bridges: ['Угу.', 'Так.', 'Понятно.'],
    sorry: 'Извините, можете повторить?',
    sample: 'Здравствуйте, я {name}. Так я буду звучать в ваших звонках.',
    style: 'Speak natural spoken Russian.',
  },
  {
    id: 'tr-TR', label: 'Turkish', native: 'Türkçe', speech: 'tr-TR', whisper: 'tr',
    voices: [v('tr-TR-EmelNeural', 'Emel', 'Female', 'warm'), v('tr-TR-AhmetNeural', 'Ahmet', 'Male', 'calm')],
    bridges: ['Hı hı.', 'Tamam.', 'Evet.'],
    sorry: 'Pardon, tekrar eder misiniz?',
    sample: 'Merhaba, ben {name}. Aramalarınızda sesim böyle duyulacak.',
    style: 'Speak natural spoken Turkish.',
  },
  {
    id: 'id-ID', label: 'Indonesian', native: 'Bahasa Indonesia', speech: 'id-ID', whisper: 'id',
    voices: [v('id-ID-GadisNeural', 'Gadis', 'Female', 'warm'), v('id-ID-ArdiNeural', 'Ardi', 'Male', 'friendly')],
    bridges: ['Hmm.', 'Oke.', 'Iya.'],
    sorry: 'Maaf, bisa diulang?',
    sample: 'Halo, saya {name}. Seperti inilah suara saya di panggilan Anda.',
    style: 'Speak natural, casual spoken Indonesian.',
  },
  {
    id: 'ja-JP', label: 'Japanese', native: '日本語', speech: 'ja-JP', whisper: 'ja',
    voices: [v('ja-JP-NanamiNeural', 'Nanami', 'Female', 'warm'), v('ja-JP-KeitaNeural', 'Keita', 'Male', 'calm')],
    bridges: ['はい。', 'ええ。', 'なるほど。'],
    sorry: 'すみません、もう一度お願いできますか？',
    sample: 'こんにちは、{name}です。お電話ではこのような声でお話しします。',
    style: 'Speak natural, polite spoken Japanese (desu/masu form).',
  },
  {
    id: 'zh-CN', label: 'Chinese (Mandarin)', native: '中文', speech: 'zh-CN', whisper: 'zh',
    voices: [v('zh-CN-XiaoxiaoNeural', 'Xiaoxiao', 'Female', 'warm'), v('zh-CN-YunxiNeural', 'Yunxi', 'Male', 'friendly')],
    bridges: ['嗯。', '好的。', '明白。'],
    sorry: '不好意思，您能再说一遍吗？',
    sample: '你好，我是{name}。这就是我在通话中的声音。',
    style: 'Speak natural spoken Mandarin in simplified Chinese characters.',
  },
  {
    id: 'ko-KR', label: 'Korean', native: '한국어', speech: 'ko-KR', whisper: 'ko',
    voices: [v('ko-KR-SunHiNeural', 'SunHi', 'Female', 'warm'), v('ko-KR-InJoonNeural', 'InJoon', 'Male', 'calm')],
    bridges: ['네.', '음.', '그렇군요.'],
    sorry: '죄송한데, 다시 말씀해 주시겠어요?',
    sample: '안녕하세요, 저는 {name}입니다. 통화에서 제 목소리는 이렇게 들립니다.',
    style: 'Speak natural, polite spoken Korean.',
  },
  {
    id: 'nl-NL', label: 'Dutch', native: 'Nederlands', speech: 'nl-NL', whisper: 'nl',
    voices: [v('nl-NL-ColetteNeural', 'Colette', 'Female', 'warm'), v('nl-NL-MaartenNeural', 'Maarten', 'Male', 'calm')],
    bridges: ['Mm.', 'Oké.', 'Ja.'],
    sorry: 'Sorry, kunt u dat herhalen?',
    sample: 'Hallo, ik ben {name}. Zo klink ik tijdens uw gesprekken.',
    style: 'Speak natural spoken Dutch.',
  },
];

export const DEFAULT_LANGUAGE = 'hinglish';

export function getLanguage(id: string | undefined): Language {
  return LANGUAGES.find((l) => l.id === id) || LANGUAGES[0];
}

/** Every allowed voice, across all languages (deduplicated). */
export const ALL_VOICES: (Voice & { lang: string })[] = (() => {
  const seen = new Set<string>();
  const out: (Voice & { lang: string })[] = [];
  for (const l of LANGUAGES) {
    for (const voice of l.voices) {
      if (seen.has(voice.id)) continue;
      seen.add(voice.id);
      out.push({ ...voice, lang: l.id });
    }
  }
  return out;
})();

/** SSML xml:lang for a voice, from its name ("hi-IN-SwaraNeural" → "hi-IN"). */
export function voiceLocale(voiceId: string): string {
  const m = /^([a-z]{2,3}-[A-Z]{2})-/.exec(voiceId);
  return m ? m[1] : 'en-US';
}

// Unicode ranges for each language's own script. Languages written in Latin letters are absent.
const SCRIPTS: Record<string, RegExp> = {
  'hi-IN': /[ऀ-ॿ]/g,
  hinglish: /[ऀ-ॿ]/g,
  'mr-IN': /[ऀ-ॿ]/g,
  'gu-IN': /[઀-૿]/g,
  'ta-IN': /[஀-௿]/g,
  'te-IN': /[ఀ-౿]/g,
  'bn-IN': /[ঀ-৿]/g,
  'kn-IN': /[ಀ-೿]/g,
  'ml-IN': /[ഀ-ൿ]/g,
  'ur-IN': /[؀-ۿ]/g,
  'ar-SA': /[؀-ۿ]/g,
  'ru-RU': /[Ѐ-ӿ]/g,
  'ja-JP': /[぀-ヿ一-鿿]/g,
  'zh-CN': /[一-鿿]/g,
  'ko-KR': /[가-힯]/g,
};

function letterCount(text: string): number {
  return (text.match(/\p{L}/gu) || []).length;
}

/**
 * Whether a reply is written in the language's own script. Hinglish may carry English words,
 * so it needs less; Latin-script languages must be mostly Latin letters.
 */
export function matchesScript(text: string, languageId: string): boolean {
  const clean = String(text || '').replace(/\[[^\]]*\]/g, '');
  const total = letterCount(clean);
  if (total < 4) return true;
  const re = SCRIPTS[languageId];
  if (re) {
    const own = (clean.match(re) || []).length;
    return own / total >= (languageId === 'hinglish' ? 0.35 : 0.6);
  }
  const latin = (clean.match(/[A-Za-zÀ-ɏ]/g) || []).length;
  return latin / total >= 0.8;
}

/** "[LANG:en-IN]" or "[LANG:English]" → the language, if it is one we support. */
export function parseLanguageTag(text: string): Language | null {
  const m = /\[LANG:\s*([^\]]+?)\s*\]/i.exec(String(text || ''));
  if (!m) return null;
  const key = m[1].toLowerCase();
  return (
    LANGUAGES.find((l) => l.id.toLowerCase() === key) ||
    LANGUAGES.find((l) => l.label.toLowerCase() === key) ||
    LANGUAGES.find((l) => l.label.toLowerCase().startsWith(key)) ||
    null
  );
}

/**
 * Guess the caller's language from the script of what they said, compared with the call
 * language. Returns a label like "English" only when it clearly differs, else ''.
 */
export function guessCallerLanguage(text: string, callLanguageId: string): string {
  const t = String(text || '');
  const total = letterCount(t);
  if (total < 8) return '';
  for (const [id, re] of Object.entries(SCRIPTS)) {
    const n = (t.match(re) || []).length;
    if (n / total >= 0.6) {
      const same = SCRIPTS[callLanguageId] && SCRIPTS[callLanguageId].source === re.source;
      return same ? '' : getLanguage(id === 'hinglish' ? 'hi-IN' : id).label;
    }
  }
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  if (latin / total >= 0.8 && SCRIPTS[callLanguageId]) return callLanguageId === 'hinglish' ? '' : 'English';
  return '';
}

/** VaniDial's production languages (GA after native-speaker scoring). Others are playground-only. */
export const CORE_LANGUAGE_IDS = ['hinglish', 'hi-IN', 'gu-IN', 'en-IN'] as const;
/** The playground opens on English (US) with Aria: the best-sounding default. */
export const DEFAULT_LANGUAGE_ID = 'en-US';
export const DEFAULT_VOICE_ID = 'en-US-AriaNeural';
export const CORE_LANGUAGES: Language[] = CORE_LANGUAGE_IDS.map((id) => getLanguage(id));
export const MORE_LANGUAGES: Language[] = LANGUAGES.filter((l) => !(CORE_LANGUAGE_IDS as readonly string[]).includes(l.id));
