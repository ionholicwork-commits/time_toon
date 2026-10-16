
import { GoogleGenAI, GenerateContentResponse, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { EndingType, CharacterProfile, BackgroundProfile } from '../types';
import { ENDING_DETAILS } from '../constants';

// Text generation models
const textModel = 'gemini-3-flash-preview';
const promptGenModel = 'gemini-3-flash-preview';

// Image generation models
const imageModel = 'gemini-2.5-flash-image';
const highQualityImageModel = 'gemini-3-pro-image-preview';

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const generateTextWithGemini = async (prompt: string): Promise<string> => {
  let retries = 3;
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  while (retries > 0) {
    try {
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: textModel,
        contents: prompt,
        config: {
          temperature: 0.8,
          topK: 40,
          topP: 0.95,
          safetySettings: safetySettings,
        }
      });
      if (!response.text) throw new Error("모델로부터 빈 응답을 받았습니다.");
      return response.text;
    } catch (error) {
      retries--;
      if (retries === 0) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error("Gemini API 텍스트 생성 실패.");
};

const formatScenarioPrompt = (
  role: string,
  instruction: string,
  coreTheme: string,
  character: CharacterProfile,
  background: BackgroundProfile,
  extraContext: string = ''
) => `
Role: ${role}
Task: ${instruction}

---
[User-Provided Theme/Context]
"${coreTheme}"
---
[Critical Handling Instruction for Theme]
- If the Theme above is long or narrative-driven, DO NOT repeat it verbatim. 
- Distill the "Central Environmental Crisis" and the "Emotional Tone" from it.
- Use it as the foundation, but create a NEW, cinematic scene.

${extraContext}

[Character]
- Name: ${character.name || 'Protagonist'} (${character.occupation})
- Appearance: ${character.gender}, ${character.age}, ${character.nationality}, wearing ${character.outfit}

[Setting]
- Location: ${background.space}
- Atmosphere: ${background.weather}, ${background.timeOfDay}, ${background.mood}
---

[Writing Guidelines]
1. **Thematic Integrity**: Your output MUST focus on the crisis distilled from the Theme.
2. **Strict Structure**: EXACTLY 2 descriptive paragraphs + 1 impactful dialogue line.
3. **New Creation**: Even if the theme is detailed, do not plagiarize the user's words; transform them into a professional script.
4. **Language**: Korean (Dramatic, cinematic, immersive).
5. **Visual Metadata**: Add <Composition>...</Composition> at the end for character pose/emotion.
`;

const parseScenarioResponse = (responseText: string) => {
    const compositionMatch = responseText.match(/<Composition>([\s\S]*?)<\/Composition>/i);
    let scenario = responseText.replace(/<Composition>[\s\S]*?<\/Composition>/i, '').trim();
    let composition = compositionMatch ? compositionMatch[1].trim() : "character standing naturally";
    return { scenario, composition };
};

export const generatePrologueScenario = async (
  coreTheme: string,
  characterProfile: CharacterProfile,
  background: BackgroundProfile
): Promise<{ scenario: string, composition: string }> => {
  const instruction = `
    Write a cinematic prologue. 
    Even if the user provided a full story in the Theme, your job is to write ONLY the opening scene. 
    Set the tension for the environmental crisis mentioned.
  `;
  const prompt = formatScenarioPrompt("Cinematic Scriptwriter", instruction, coreTheme, characterProfile, background);
  const rawText = await generateTextWithGemini(prompt);
  return parseScenarioResponse(rawText);
};

export const generateEndingScenario = async (
  prologue: string,
  endingType: EndingType,
  coreTheme: string,
  characterProfile: CharacterProfile,
  background: BackgroundProfile,
  userSuggestion?: string
): Promise<{ scenario: string, composition: string }> => {
  const endingDetail = ENDING_DETAILS[endingType];
  const extraContext = `
[Previous Story Reference]
Prologue: "${prologue}"

[Target Ending]
Type: ${endingType}
Outcome: ${endingDetail.promptInfo}
${userSuggestion ? `User's Specific Final Direction: "${userSuggestion}"` : ''}
  `;

  const instruction = `
    Write the final scene of the entire narrative. 
    Show the ultimate fate of the world regarding the crisis described in the Theme.
  `;

  const prompt = formatScenarioPrompt("Expert Narrative Designer", instruction, coreTheme, characterProfile, background, extraContext);
  const rawText = await generateTextWithGemini(prompt);
  return parseScenarioResponse(rawText);
};

const translateToEnglish = (profile: CharacterProfile) => {
  const translations = {
    gender: { '남': 'male', '여': 'female' },
    age: { '청소년': 'teenager', '청년': 'young adult', '중년': 'middle-aged', '노년': 'elderly' },
    nationality: { '미국': 'American', '중국': 'Chinese', '케냐': 'Kenyan', '영국': 'British', '한국': 'Korean' },
    outfit: { '캐쥬얼': 'casual clothes', '모던': 'modern stylish outfit', '스트리트': 'streetwear fashion', '빈티지': 'vintage style clothing', '전통의상': 'traditional cultural dress', '아웃도어': 'outdoor hiking gear', '유니폼': 'professional uniform' },
    artStyle: { '애니메이션': 'modern anime', '90s 애니': '90s retro anime', '웹툰': 'korean webtoon style', '유화': 'oil painting', '픽셀아트': '16-bit pixel art', '라인아트': 'ink line art', 'SD캐릭터': 'chibi style', '반실사': 'semi-realistic' },
    occupation: { '학생': 'student', '과학자': 'scientist', '환경 운동가': 'environmental activist', '정치인': 'politician', 'CEO': 'corporate executive' }
  };
  return {
    gender: translations.gender[profile.gender as keyof typeof translations.gender] || profile.gender,
    age: translations.age[profile.age as keyof typeof translations.age] || profile.age,
    nationality: translations.nationality[profile.nationality as keyof typeof translations.nationality] || profile.nationality,
    outfit: translations.outfit[profile.outfit as keyof typeof translations.outfit] || profile.outfit,
    artStyle: translations.artStyle[profile.artStyle as keyof typeof translations.artStyle] || profile.artStyle,
    occupation: translations.occupation[profile.occupation as keyof typeof translations.occupation] || profile.occupation
  };
};

const getStyleSpecificTags = (styleKey: string): string => {
  if (['애니메이션', '90s 애니', '웹툰', 'SD캐릭터'].includes(styleKey)) return "2D, cel shaded, vibrant colors, anime key visual";
  if (styleKey === '라인아트') return "monochrome ink illustration, detailed linework, high contrast";
  if (styleKey === '유화') return "oil on canvas, thick brushstrokes, impasto, rich texture";
  if (styleKey === '픽셀아트') return "pixel art, retro gaming, sharp pixels";
  return "high-quality digital art, cinematic lighting, masterpiece, detailed textures";
};

const translateBackgroundToEnglish = (profile: BackgroundProfile) => {
    // Neutral and descriptive translations that don't force a "Success/Failure" narrative
    const spaces = { '도시': 'urban cityscape', '시골': 'rural countryside', '집': 'domestic interior', '학교': 'school environment', '공원': 'public park' };
    const weathers = {
        '맑음': 'clear bright sky, natural lighting',
        '흐림': 'overcast moody sky, diffused light',
        '비': 'rainy weather, wet surfaces',
        '눈': 'snowy weather, white landscape',
        '안개': 'misty foggy atmosphere'
    };
    const moods = {
        '평화로운': 'peaceful and calm',
        '활기찬': 'dynamic and lively',
        '공허한': 'quiet and desolate',
        '긴박한': 'tense and dramatic'
    };
    const times = { '새벽': 'dawn', '아침': 'morning', '낮': 'daytime', '해질녘': 'sunset', '밤': 'nighttime' };
    
    return {
        space: spaces[profile.space as keyof typeof spaces] || profile.space,
        weather: weathers[profile.weather as keyof typeof weathers] || profile.weather,
        timeOfDay: times[profile.timeOfDay as keyof typeof times] || profile.timeOfDay,
        mood: moods[profile.mood as keyof typeof moods] || profile.mood,
    };
};

export const generateCharacterPreviewPrompt = async (profile: CharacterProfile): Promise<string> => {
  const eng = translateToEnglish(profile);
  const tags = getStyleSpecificTags(profile.artStyle);
  return `Art Style: ${eng.artStyle}, Subject: A ${eng.age} ${eng.nationality} ${eng.gender} ${eng.occupation} wearing ${eng.outfit}, Shot: Waist-up portrait, looking at viewer, centered, simple white background, studio lighting, ${tags}`;
};

export const generateImagePromptInternal = async (
  scenarioText: string, 
  scenarioType: 'prologue' | 'ending', 
  characterProfile: CharacterProfile,
  background: BackgroundProfile,
  title?: string,
  compositionGuidance?: string
): Promise<string> => {
  const eng = translateToEnglish(characterProfile);
  const bg = translateBackgroundToEnglish(background);
  const tags = getStyleSpecificTags(characterProfile.artStyle);
  const pose = compositionGuidance || "standing naturally";
  const comp = background.composition === '인물 중심' ? "Close-up portrait" : background.composition === '배경 중심' ? "Wide shot with detailed background" : "Medium cinematic shot";

  const standardPrompt = `
Task: Act as a Visual Narrative Designer. Create a descriptive English image generation prompt.

[Source Material: Scenario Text]
"${scenarioText}"

[Core Visual Components]
- Character: ${eng.age} ${eng.nationality} ${eng.gender} ${eng.occupation} wearing ${eng.outfit}.
- Atmosphere: ${bg.weather}, ${bg.timeOfDay}, ${bg.mood} at ${bg.space}.
- Composition: ${comp}, ${pose}.
- Style: ${eng.artStyle}, ${tags}.

[CRITICAL INSTRUCTIONS]
1. **Scenario Faithfulness**: Analyze the "Scenario Text" carefully. The prompt MUST visualize the specific event, emotion, and environment described in the text above.
2. **Contextual Environment**: Do not use generic "healing" or "destruction" keywords. Instead, describe the environmental state exactly as suggested by the scenario's narrative (e.g., if the text mentions 'smog choking the sun', describe that).
3. **Avoid Clichés**: Do not add extra elements not mentioned or implied by the text.
4. **Output**: Return ONLY the English prompt text. No commentary.
  `;

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: promptGenModel, 
      contents: standardPrompt,
      config: { temperature: 0.6, safetySettings: safetySettings } // Lower temperature for more focused prompt generation
    });
    return response.text.trim();
  } catch (error) {
    // Basic fallback that still uses profile details
    return `Cinematic scene: ${eng.age} ${eng.gender} ${eng.occupation} in ${bg.space}, mood is ${bg.mood}, ${tags}`;
  }
};

export const generateImageFromPrompt = async (
  imagePrompt: string,
  baseImage?: { data: string; mimeType: string },
  useHighQuality: boolean = false,
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' = '16:9',
  referenceStrength: 'Weak' | 'Medium' | 'Strong' = 'Medium'
): Promise<string> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const strength = { 'Weak': 0.3, 'Medium': 0.6, 'Strong': 0.9 }[referenceStrength];
    const response = await ai.models.generateContent({
        model: useHighQuality ? highQualityImageModel : imageModel,
        contents: { 
          parts: [
            ...(baseImage ? [{ inlineData: { data: baseImage.data, mimeType: baseImage.mimeType } }] : []),
            { text: `${imagePrompt} (Visual consistency focus: ${strength})` }
          ]
        },
        config: { imageConfig: { aspectRatio }, safetySettings: safetySettings },
    });
    const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart?.inlineData) return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
    throw new Error("이미지 생성 실패");
  } catch (error) {
    throw error;
  }
};
