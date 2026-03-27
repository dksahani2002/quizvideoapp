/**
 * On-screen text, TTS intro/outro templates, and answer labels by quiz language.
 * Brand defaults in English (must match settingsService) — when the user has not
 * customized scripts, we substitute the locale matching the selected quiz language.
 */
export const BRAND_DEFAULTS_EN = {
  introTemplate: 'Can you answer this? This quiz is about {{topic}}.',
  outroTemplate: 'Follow for more quizzes. Like and subscribe.',
} as const;

export interface QuizUiStrings {
  /** Voice + optional {{topic}} — used when brand default English is still stored. */
  introTemplate: string;
  outroTemplate: string;
  /** Short line under topic on intro slide (must match script/font for language). */
  introSubtitle: string;
  outroLine1: string;
  outroLine2: string;
  correctAnswerPrefix: string;
  correctBadge: string;
}

const EN: QuizUiStrings = {
  introTemplate: BRAND_DEFAULTS_EN.introTemplate,
  outroTemplate: BRAND_DEFAULTS_EN.outroTemplate,
  introSubtitle: 'Can you answer this?',
  outroLine1: 'Follow for more quizzes!',
  outroLine2: 'Like & Subscribe',
  correctAnswerPrefix: 'The correct answer is:',
  correctBadge: 'Correct!',
};

/** Full overrides per ISO 639-1 base code; missing keys fall back to EN. */
const BY_LANG: Record<string, Partial<QuizUiStrings>> = {
  hi: {
    introTemplate: 'क्या आप इसका उत्तर दे सकते हैं? यह क्विज़ {{topic}} के बारे में है।',
    outroTemplate: 'और क्विज़ के लिए फॉलो करें। लाइक करें और सब्सक्राइब करें।',
    introSubtitle: 'क्या आप इसका उत्तर दे सकते हैं?',
    outroLine1: 'और क्विज़ के लिए फॉलो करें!',
    outroLine2: 'लाइक और सब्सक्राइब',
    correctAnswerPrefix: 'सही उत्तर है:',
    correctBadge: 'सही!',
  },
  mr: {
    introTemplate: 'तुम्ही हे उत्तर देऊ शकता का? ही क्विझ {{topic}} विषयी आहे.',
    outroTemplate: 'अधिक क्विझसाठी फॉलो करा. लाइक आणि सबस्क्राइब करा.',
    introSubtitle: 'तुम्ही हे उत्तर देऊ शकता का?',
    outroLine1: 'अधिक क्विझसाठी फॉलो करा!',
    outroLine2: 'लाइक आणि सबस्क्राइब',
    correctAnswerPrefix: 'बरोबर उत्तर आहे:',
    correctBadge: 'बरोबर!',
  },
  es: {
    introTemplate: '¿Puedes responder? Este cuestionario trata sobre {{topic}}.',
    outroTemplate: 'Síguenos para más cuestionarios. Dale like y suscríbete.',
    introSubtitle: '¿Puedes responder?',
    outroLine1: '¡Síguenos para más cuestionarios!',
    outroLine2: 'Me gusta y suscríbete',
    correctAnswerPrefix: 'La respuesta correcta es:',
    correctBadge: '¡Correcto!',
  },
  fr: {
    introTemplate: 'Pouvez-vous répondre ? Ce quiz parle de {{topic}}.',
    outroTemplate: 'Suivez-nous pour plus de quiz. Aimez et abonnez-vous.',
    introSubtitle: 'Pouvez-vous répondre ?',
    outroLine1: 'Suivez-nous pour plus de quiz !',
    outroLine2: 'Aimer et s’abonner',
    correctAnswerPrefix: 'La bonne réponse est :',
    correctBadge: 'Correct !',
  },
  de: {
    introTemplate: 'Kannst du das beantworten? Dieses Quiz geht über {{topic}}.',
    outroTemplate: 'Folge uns für mehr Quizze. Like und abonnieren.',
    introSubtitle: 'Kannst du das beantworten?',
    outroLine1: 'Folge uns für mehr Quizze!',
    outroLine2: 'Like & Abonnieren',
    correctAnswerPrefix: 'Die richtige Antwort ist:',
    correctBadge: 'Richtig!',
  },
  pt: {
    introTemplate: 'Consegue responder? Este quiz é sobre {{topic}}.',
    outroTemplate: 'Siga-nos para mais quizzes. Curta e inscreva-se.',
    introSubtitle: 'Consegue responder?',
    outroLine1: 'Siga-nos para mais quizzes!',
    outroLine2: 'Curtir e inscrever-se',
    correctAnswerPrefix: 'A resposta correta é:',
    correctBadge: 'Correto!',
  },
  ar: {
    introTemplate: 'هل يمكنك الإجابة؟ هذا الاختبار عن {{topic}}.',
    outroTemplate: 'تابعنا لمزيد من الاختبارات. أعجب واشترك.',
    introSubtitle: 'هل يمكنك الإجابة؟',
    outroLine1: 'تابعنا لمزيد من الاختبارات!',
    outroLine2: 'إعجاب واشتراك',
    correctAnswerPrefix: 'الإجابة الصحيحة هي:',
    correctBadge: 'صحيح!',
  },
  zh: {
    introTemplate: '你能回答吗？本测验关于{{topic}}。',
    outroTemplate: '关注获取更多测验。点赞并订阅。',
    introSubtitle: '你能回答吗？',
    outroLine1: '关注获取更多测验！',
    outroLine2: '点赞并订阅',
    correctAnswerPrefix: '正确答案是：',
    correctBadge: '正确！',
  },
  ja: {
    introTemplate: '答えられますか？このクイズは{{topic}}についてです。',
    outroTemplate: 'もっとクイズを見るにはフォローを。いいねとチャンネル登録を。',
    introSubtitle: '答えられますか？',
    outroLine1: 'もっとクイズを見るにはフォローを！',
    outroLine2: 'いいねと登録',
    correctAnswerPrefix: '正解は：',
    correctBadge: '正解！',
  },
  ko: {
    introTemplate: '답할 수 있나요? 이번 퀴즈는 {{topic}}입니다.',
    outroTemplate: '더 많은 퀴즈를 보려면 팔로우하세요. 좋아요와 구독.',
    introSubtitle: '답할 수 있나요?',
    outroLine1: '더 많은 퀴즈를 보려면 팔로우!',
    outroLine2: '좋아요와 구독',
    correctAnswerPrefix: '정답은:',
    correctBadge: '정답!',
  },
  ru: {
    introTemplate: 'Сможете ответить? Этот квиз про {{topic}}.',
    outroTemplate: 'Подпишитесь на больше квизов. Лайк и подписка.',
    introSubtitle: 'Сможете ответить?',
    outroLine1: 'Подпишитесь на больше квизов!',
    outroLine2: 'Лайк и подписка',
    correctAnswerPrefix: 'Правильный ответ:',
    correctBadge: 'Верно!',
  },
  uk: {
    introTemplate: 'Зможете відповісти? Цей квіз про {{topic}}.',
    outroTemplate: 'Підпишіться на більше квізів. Лайк і підписка.',
    introSubtitle: 'Зможете відповісти?',
    outroLine1: 'Підпишіться на більше квізів!',
    outroLine2: 'Лайк і підписка',
    correctAnswerPrefix: 'Правильна відповідь:',
    correctBadge: 'Вірно!',
  },
};

export function getQuizUiStrings(language: string | undefined): QuizUiStrings {
  const base = (language || 'en').split('-')[0].toLowerCase();
  const o = BY_LANG[base];
  if (!o) return { ...EN };
  return { ...EN, ...o };
}

/** Pick intro TTS/slide template: request overrides, else localized default if settings still English default. */
export function resolveIntroOutroScripts(
  lang: string,
  reqIntro: string | undefined,
  reqOutro: string | undefined,
  settingsIntro: string | undefined,
  settingsOutro: string | undefined
): { introTemplate: string; outroTemplate: string } {
  const ui = getQuizUiStrings(lang);
  const introReq = (reqIntro || '').trim();
  const outroReq = (reqOutro || '').trim();
  const introSet = (settingsIntro || '').trim();
  const outroSet = (settingsOutro || '').trim();

  const introTemplate =
    introReq ||
    (introSet && introSet !== BRAND_DEFAULTS_EN.introTemplate ? introSet : ui.introTemplate);
  const outroTemplate =
    outroReq ||
    (outroSet && outroSet !== BRAND_DEFAULTS_EN.outroTemplate ? outroSet : ui.outroTemplate);

  return { introTemplate, outroTemplate };
}
