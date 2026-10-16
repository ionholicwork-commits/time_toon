
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { EndingContent, AppPage, ImageState, CharacterProfile, BackgroundProfile } from './types';
import { APP_TITLE, INITIAL_ENDING_CONTENT, STEPS, INITIAL_BACKGROUND_PROFILE, ENDING_DEFAULT_BACKGROUNDS, LOADING_TIPS } from './constants';
import { 
  generatePrologueScenario, 
  generateEndingScenario, 
  generateImagePromptInternal, 
  generateImageFromPrompt,
} from './services/geminiService';
import Button from './components/Button';
import Alert from './components/Alert';
import ScenarioDisplay from './components/ScenarioDisplay';
import PageLayout from './components/PageLayout';
import ImageDisplay from './components/ImageDisplay';
import CharacterCreator from './components/CharacterCreator';
import BackgroundSelector from './components/BackgroundSelector';
import LoadingOverlay from './components/LoadingOverlay';
import AIEthicsGuide from './components/AIEthicsGuide';
import ConfirmModal from './components/ConfirmModal';

const STORAGE_KEY = 'carbon_crisis_save_v1';
const CORE_THEME_LIMIT = 500;

// Helper to extract MIME type and base64 data from a Data URL
const extractBase64Data = (dataUrl?: string) => {
  if (!dataUrl) return undefined;
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (match && match[1] && match[2]) {
    return { mimeType: match[1], data: match[2] };
  }
  return undefined;
};

// Helper to map technical errors to user-friendly guides
const getUserFriendlyErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('403') || message.includes('API_KEY_INVALID') || message.includes('API key not valid') || message.includes('PERMISSION_DENIED')) {
    return "API 키가 올바르지 않습니다. 관리자에게 문의하세요.";
  }
  if (message.includes('SAFETY') || message.includes('PROHIBITED_CONTENT') || message.includes('안전 정책')) {
    return "시나리오 내용이 안전 정책에 의해 차단되었습니다. 시나리오 텍스트를 다시 생성하거나, 조금 더 순화된 표현으로 다시 시도해보세요.";
  }
  if (message.includes('503') || message.includes('504') || message.includes('INTERNAL') || message.includes('OVERLOADED') || message.includes('Gateway Timeout')) {
    return "서버가 혼잡하여 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.";
  }
  if (message.includes('NO_IMAGE') || message.includes('모델 응답 없음') || message.includes('응답에서 이미지 데이터')) {
    return "이미지를 생성하지 못했습니다. 다시 시도해도 오류가 발생한다면, 캐릭터 설정이나 배경을 조금 단순하게 변경하여 다시 시도해주세요.";
  }
  if (message.includes('429') || message.includes('QUOTA') || message.includes('Too Many Requests') || message.includes('RESOURCE_EXHAUSTED')) {
    return "요청 횟수 제한을 초과했습니다. 잠시 기다렸다가 다시 시도해주세요.";
  }
  return message;
};

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<AppPage>(AppPage.INTRODUCTION);
  const [characterProfile, setCharacterProfile] = useState<CharacterProfile | null>(null);
  const [coreTheme, setCoreTheme] = useState<string>('');
  const [background, setBackground] = useState<BackgroundProfile>({ ...INITIAL_BACKGROUND_PROFILE });
  const [prologue, setPrologue] = useState<string>('');
  const [prologueComposition, setPrologueComposition] = useState<string>('');
  const [isPrologueGenerated, setIsPrologueGenerated] = useState<boolean>(false);
  const [prologueImage, setPrologueImage] = useState<ImageState>({ isLoading: false, isGenerated: false, error: null, skipped: false });
  const [endings, setEndings] = useState<EndingContent[]>(JSON.parse(JSON.stringify(INITIAL_ENDING_CONTENT)));
  const [currentEndingIndex, setCurrentEndingIndex] = useState<number>(0);
  const [userEndingSuggestion, setUserEndingSuggestion] = useState<string>(''); 
  const [isLoadingText, setIsLoadingText] = useState<boolean>(false); 
  const [error, setError] = useState<string | null>(null);
  const [currentLoadingTip, setCurrentLoadingTip] = useState<string>('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<CharacterProfile | null>(null);
  const [referenceStrength, setReferenceStrength] = useState<'Weak' | 'Medium' | 'Strong'>('Medium');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.currentPage) setCurrentPage(data.currentPage);
        if (data.characterProfile) setCharacterProfile(data.characterProfile);
        if (data.coreTheme) setCoreTheme(data.coreTheme);
        if (data.background) setBackground(data.background);
        if (data.prologue) setPrologue(data.prologue);
        if (data.prologueComposition) setPrologueComposition(data.prologueComposition);
        if (data.isPrologueGenerated !== undefined) setIsPrologueGenerated(data.isPrologueGenerated);
        if (data.prologueImage) setPrologueImage(data.prologueImage);
        if (data.endings) setEndings(data.endings);
        if (data.currentEndingIndex !== undefined) setCurrentEndingIndex(data.currentEndingIndex);
        if (data.userEndingSuggestion) setUserEndingSuggestion(data.userEndingSuggestion);
      } catch (e) {
        console.error("Failed to load save state", e);
      }
    }
  }, []);

  useEffect(() => {
    const stateToSave = {
      currentPage, characterProfile, coreTheme, background, prologue, prologueComposition,
      isPrologueGenerated, prologueImage, endings, currentEndingIndex, userEndingSuggestion
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
      try {
        const strippedState = {
          ...stateToSave,
          prologueImage: { ...stateToSave.prologueImage, url: undefined },
          endings: stateToSave.endings.map((e: EndingContent) => ({ ...e, image: { ...e.image, url: undefined } }))
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(strippedState));
      } catch (innerE) {
        console.error("Failed to save state", innerE);
      }
    }
  }, [currentPage, characterProfile, coreTheme, background, prologue, prologueComposition, isPrologueGenerated, prologueImage, endings, currentEndingIndex, userEndingSuggestion]);

  useEffect(() => {
    if (!process.env.API_KEY) {
      setError("API 키가 설정되지 않았습니다. 환경 변수를 확인해주세요.");
    }
  }, []);
  
  const currentStep = useMemo(() => {
    const pageIndex = STEPS.findIndex(step => step.id === currentPage);
    if (pageIndex !== -1) return pageIndex;
    if (currentPage === AppPage.INTRODUCTION) return -1;
    return STEPS.length -1;
  }, [currentPage]);

  const handleError = (err: unknown) => {
    setError(getUserFriendlyErrorMessage(err));
    setTimeout(() => setError(null), 8000);
  };

  const clearError = () => setError(null);
  const clearPrologueImageError = () => setPrologueImage(prev => ({ ...prev, error: null }));
  const clearEndingImageError = (index: number) => {
    setEndings(prev => prev.map((e, i) => i === index ? { ...e, image: { ...e.image, error: null } } : e));
  };
  
  const getRandomTip = () => LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];

  const areProfilesEqual = (p1: CharacterProfile | null, p2: CharacterProfile | null) => {
    if (p1 === p2) return true;
    if (!p1 || !p2) return false;
    const normalize = (str?: string) => (str || '').trim();
    return (
      normalize(p1.name) === normalize(p2.name) &&
      normalize(p1.gender) === normalize(p2.gender) &&
      normalize(p1.age) === normalize(p2.age) &&
      normalize(p1.nationality) === normalize(p2.nationality) &&
      normalize(p1.occupation) === normalize(p2.occupation) &&
      normalize(p1.outfit) === normalize(p2.outfit) &&
      normalize(p1.artStyle) === normalize(p2.artStyle) &&
      normalize(p1.imageUrl) === normalize(p2.imageUrl)
    );
  };

  const handleCharacterCreationComplete = (newProfile: CharacterProfile) => {
    const isProfileChanged = !areProfilesEqual(characterProfile, newProfile);
    const hasGeneratedContent = isPrologueGenerated || endings.some(e => e.isGenerated);
    if (isProfileChanged && hasGeneratedContent) {
      setPendingProfile(newProfile);
      setShowConfirmModal(true);
      return;
    }
    setCharacterProfile(newProfile);
    navigateToPage(AppPage.PROLOGUE_GENERATION);
  };

  const handleConfirmReset = () => {
    if (pendingProfile) {
        setCharacterProfile(pendingProfile);
        setPrologue('');
        setPrologueComposition('');
        setIsPrologueGenerated(false);
        setPrologueImage({ isLoading: false, isGenerated: false, error: null, skipped: false });
        setEndings(JSON.parse(JSON.stringify(INITIAL_ENDING_CONTENT)));
        setCurrentEndingIndex(0);
        setUserEndingSuggestion('');
        navigateToPage(AppPage.PROLOGUE_GENERATION);
    }
    setShowConfirmModal(false);
    setPendingProfile(null);
  };

  const handleConfirmKeep = () => {
     if (pendingProfile) {
        setCharacterProfile(pendingProfile);
        navigateToPage(AppPage.PROLOGUE_GENERATION);
    }
    setShowConfirmModal(false);
    setPendingProfile(null);
  };

  const handleCancelModal = () => {
    setShowConfirmModal(false);
    setPendingProfile(null);
  };

  const handleGeneratePrologue = useCallback(async () => {
    if (!coreTheme.trim()) {
      setError("게임의 핵심 테마를 입력해주세요.");
      return;
    }
    if (!characterProfile) {
      handleError(new Error("캐릭터 정보가 누락되었습니다."));
      return;
    }
    clearError();
    setIsLoadingText(true);
    setPrologue(''); 
    setPrologueComposition('');
    setIsPrologueGenerated(false);
    setPrologueImage({ isLoading: false, isGenerated: false, error: null, skipped: false }); 
    try {
      const result = await generatePrologueScenario(coreTheme, characterProfile, background);
      setPrologue(result.scenario);
      setPrologueComposition(result.composition);
      setIsPrologueGenerated(true);
    } catch (err) {
      handleError(err);
    } finally {
      setIsLoadingText(false);
    }
  }, [coreTheme, characterProfile, background]);

  const handleSkipPrologueImage = () => {
    setPrologueImage(prev => ({ ...prev, skipped: true, error: null }));
  };

  const handleGeneratePrologueImage = useCallback(async () => {
    if (!prologue || !characterProfile) return;
    setCurrentLoadingTip(getRandomTip());
    setPrologueImage({ isLoading: true, isGenerated: false, error: null, url: prologueImage.url, skipped: false }); 
    try {
      const imagePrompt = await generateImagePromptInternal(prologue, 'prologue', characterProfile, background, undefined, prologueComposition);
      setPrologueImage(prev => ({ ...prev, prompt: imagePrompt }));
      const baseImage = extractBase64Data(characterProfile.imageUrl);
      const imageUrl = await generateImageFromPrompt(imagePrompt, baseImage, false, '16:9', referenceStrength);
      setPrologueImage(prev => ({ ...prev, url: imageUrl, isGenerated: true, isLoading: false }));
    } catch (err) {
      setPrologueImage(prev => ({ ...prev, error: getUserFriendlyErrorMessage(err), isLoading: false, isGenerated: prev.url ? true: false })); 
    }
  }, [prologue, prologueImage.url, characterProfile, background, prologueComposition, referenceStrength]);

  const handleGenerateCurrentEnding = useCallback(async () => {
    if (!prologue || !coreTheme.trim() || !characterProfile) return;
    clearError();
    setIsLoadingText(true);
    setEndings(prev => prev.map((e, i) => i === currentEndingIndex ? { ...e, scenario: '', isGenerated: false, image: { isLoading: false, isGenerated: false, error: null, skipped: false } } : e));
    try {
      const result = await generateEndingScenario(prologue, endings[currentEndingIndex].type, coreTheme, characterProfile, background, userEndingSuggestion);
      setEndings(prev => prev.map((e, i) => i === currentEndingIndex ? { ...e, scenario: result.scenario, compositionGuidance: result.composition, isGenerated: true } : e));
    } catch (err) {
      handleError(err);
    } finally {
      setIsLoadingText(false);
    }
  }, [prologue, currentEndingIndex, endings, coreTheme, characterProfile, userEndingSuggestion, background]); 

  const handleSkipCurrentEndingImage = () => {
    setEndings(prev => prev.map((e, i) => i === currentEndingIndex ? { ...e, image: { ...e.image, skipped: true, error: null } } : e));
  };

  const handleGenerateCurrentEndingImage = useCallback(async () => {
    const currentEnding = endings[currentEndingIndex];
    if (!currentEnding?.scenario || !characterProfile) return;
    setCurrentLoadingTip(getRandomTip());
    setEndings(prev => prev.map((e, i) => i === currentEndingIndex ? { ...e, image: { ...e.image, isLoading: true, isGenerated: false, error: null, url: e.image.url, skipped: false } } : e));
    try {
      const imagePrompt = await generateImagePromptInternal(currentEnding.scenario, 'ending', characterProfile, background, currentEnding.title, currentEnding.compositionGuidance);
      setEndings(prev => prev.map((e, i) => i === currentEndingIndex ? { ...e, image: { ...e.image, prompt: imagePrompt } } : e));
      const baseImageForEnding = extractBase64Data(characterProfile.imageUrl);
      const imageUrl = await generateImageFromPrompt(imagePrompt, baseImageForEnding, false, '16:9', referenceStrength);
      setEndings(prev => prev.map((e, i) => i === currentEndingIndex ? { ...e, image: { ...e.image, url: imageUrl, isGenerated: true, isLoading: false } } : e));
    } catch (err) {
       setEndings(prev => prev.map((e, i) => i === currentEndingIndex ? { ...e, image: { ...e.image, error: getUserFriendlyErrorMessage(err), isLoading: false, isGenerated: e.image.url ? true : false } } : e));
    }
  }, [endings, currentEndingIndex, characterProfile, background, referenceStrength]);

  const navigateToPage = (page: AppPage) => { clearError(); setCurrentPage(page); };
  const handleGoToStart = () => navigateToPage(AppPage.CHARACTER_CREATION);
  const navigateToFirstEnding = () => {
    const defaultBackground = ENDING_DEFAULT_BACKGROUNDS[endings[0].type];
    setBackground(prev => ({ ...defaultBackground, space: prev.space }));
    navigateToPage(AppPage.ENDING_GENERATION);
  };

  const handleNextEnding = () => {
    if (currentEndingIndex < endings.length - 1) {
      const nextIndex = currentEndingIndex + 1;
      setBackground(prev => ({ ...ENDING_DEFAULT_BACKGROUNDS[endings[nextIndex].type], space: prev.space }));
      setCurrentEndingIndex(nextIndex);
      setUserEndingSuggestion('');
      clearError();
    }
  };

  const handlePrevious = () => {
    clearError();
    if (currentPage === AppPage.PROLOGUE_GENERATION) navigateToPage(AppPage.CHARACTER_CREATION);
    else if (currentPage === AppPage.ENDING_GENERATION) {
      if (currentEndingIndex > 0) {
        const prevIndex = currentEndingIndex - 1;
        setBackground(prev => ({ ...ENDING_DEFAULT_BACKGROUNDS[endings[prevIndex].type], space: prev.space }));
        setCurrentEndingIndex(prevIndex);
        setUserEndingSuggestion(''); 
      } else navigateToPage(AppPage.PROLOGUE_GENERATION);
    }
  };

  const handleDownloadCompletePackage = async () => {
    const zip = new JSZip();
    const data = [
      ["번호", "시나리오 내용", "엔딩 타입"],
      ["1", prologue || "N/A", "Prologue"],
      ...endings.map((e, i) => [`${i + 2}`, e.scenario || "N/A", e.title])
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "시나리오");
    zip.file("시나리오.xlsx", XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }));
    if (prologueImage.url) {
        const extracted = extractBase64Data(prologueImage.url);
        if (extracted) zip.file("1_프롤로그.jpg", extracted.data, { base64: true });
    }
    endings.forEach((e, i) => {
        if (e.image.url) {
            const extracted = extractBase64Data(e.image.url);
            if (extracted) zip.file(`${i + 2}_${e.title}.jpg`, extracted.data, { base64: true });
        }
    });
    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = `carbon_crisis_scenario.zip`;
    link.click();
  };

  const renderContent = () => {
    const currentEnding = endings[currentEndingIndex];
    const currentEndingImage = currentEnding?.image;
    const isProcessing = isLoadingText || prologueImage.isLoading || (currentEndingImage?.isLoading ?? false);
    const isProloguePage = currentPage === AppPage.PROLOGUE_GENERATION;
    const targetText = isProloguePage ? prologue : currentEnding?.scenario;
    const targetImage = isProloguePage ? prologueImage : currentEndingImage;
    const isTextGenerated = isProloguePage ? isPrologueGenerated : currentEnding?.isGenerated;
    const isNextButtonDisabled = isProcessing || !isTextGenerated || !(targetImage?.isGenerated || targetImage?.url || targetImage?.skipped);

    switch (currentPage) {
      case AppPage.INTRODUCTION:
        return (
          <div className="flex flex-col items-center space-y-12 animate-fade-in py-8">
            <div className="text-center max-w-2xl">
              <h2 className="text-xl sm:text-2xl font-light text-sky-200 mb-6 tracking-wide">지속 가능한 미래를 위한 스토리텔링</h2>
              <p className="text-base sm:text-lg text-gray-300">탄소 배출 문제를 주제로 한 독창적인 시나리오를 생성합니다.</p>
            </div>
            <AIEthicsGuide />
            <Button onClick={() => navigateToPage(AppPage.CHARACTER_CREATION)} size="lg">시나리오 시작</Button>
          </div>
        );
      case AppPage.CHARACTER_CREATION:
        return <CharacterCreator onComplete={handleCharacterCreationComplete} initialData={characterProfile} onBack={() => navigateToPage(AppPage.INTRODUCTION)} />;
      case AppPage.PROLOGUE_GENERATION:
      case AppPage.ENDING_GENERATION:
        return (
          <div className="animate-fade-in">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-4 lg:sticky lg:top-8 flex flex-col space-y-6">
                 <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 backdrop-blur-md shadow-lg">
                    <div className="flex items-center justify-between mb-5 pb-2 border-b border-gray-700/50">
                        <h3 className="text-sm font-bold text-sky-400 uppercase tracking-wider">{isProloguePage ? "Step 1: 핵심 테마 설정" : "Step 1: 엔딩 시나리오"}</h3>
                    </div>
                    <div className="space-y-6">
                      {isProloguePage ? (
                        <div>
                          <div className="flex justify-between items-center mb-3">
                            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">핵심 테마 (Core Theme)</label>
                            <span className={`text-[10px] px-2 py-0.5 rounded ${coreTheme.length > CORE_THEME_LIMIT * 0.9 ? 'bg-red-900/40 text-red-400' : 'bg-gray-700 text-gray-400'}`}>
                                {coreTheme.length} / {CORE_THEME_LIMIT}
                            </span>
                          </div>
                          <textarea 
                            value={coreTheme} 
                            onChange={(e) => setCoreTheme(e.target.value.slice(0, CORE_THEME_LIMIT))} 
                            placeholder="예: 해수면 상승으로 인한 도시 침몰" 
                            rows={4} 
                            disabled={isProcessing} 
                            className="w-full p-3 bg-gray-900/50 border border-sky-500/30 rounded-lg focus:ring-2 focus:ring-sky-500 text-gray-200 text-sm transition-all shadow-inner" 
                          />
                        </div>
                      ) : (
                        <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-4 rounded-lg border border-gray-700/50">
                          <h4 className="text-sky-300 font-bold mb-2">🎯 {currentEnding.title}</h4>
                          <p className="text-sm text-gray-400 leading-relaxed">{currentEnding.description}</p>
                        </div>
                      )}
                      {!isProloguePage && (
                        <div>
                           <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">추가 아이디어 (Optional)</label>
                           <textarea value={userEndingSuggestion} onChange={(e) => setUserEndingSuggestion(e.target.value)} placeholder="예: 특정 기술의 발전 등" rows={3} disabled={isProcessing} className="w-full p-3 bg-gray-900/50 border border-sky-500/30 rounded-lg text-sm" />
                        </div>
                      )}
                      <BackgroundSelector profile={background} onChange={setBackground} isProcessing={isProcessing} />
                      <Button onClick={isProloguePage ? handleGeneratePrologue : handleGenerateCurrentEnding} isLoading={isLoadingText} disabled={isProcessing || (isProloguePage && !coreTheme.trim())} className="w-full py-3.5 font-bold">
                        {isTextGenerated ? "↻ 텍스트 다시 생성" : "✨ 시나리오 텍스트 생성"}
                      </Button>
                    </div>
                 </div>
              </div>
              <div className="lg:col-span-8 flex flex-col space-y-6">
                <ScenarioDisplay title={isProloguePage ? "PROLOGUE" : currentEnding.title.toUpperCase()} text={targetText} isLoading={isLoadingText && !isTextGenerated} />
                <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-5 backdrop-blur-sm">
                   <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-sky-400 uppercase tracking-wider">Step 2: 비주얼라이제이션</h3>
                      {isTextGenerated && (
                        <div className="flex gap-3">
                            <div className="hidden sm:flex items-center bg-gray-900/60 rounded-lg p-1 border border-gray-700">
                                {['Weak', 'Medium', 'Strong'].map((level) => (
                                    <button key={level} onClick={() => setReferenceStrength(level as any)} className={`px-2 py-1 text-xs rounded transition-all ${referenceStrength === level ? 'bg-sky-600 text-white' : 'text-gray-400'}`}>{{'Weak': '창의', 'Medium': '균형', 'Strong': '유지'}[level]}</button>
                                ))}
                            </div>
                            <Button onClick={isProloguePage ? handleGeneratePrologueImage : handleGenerateCurrentEndingImage} isLoading={targetImage?.isLoading} disabled={isProcessing} size="sm">🎨 이미지 {targetImage?.url ? "재생성" : "생성"}</Button>
                        </div>
                      )}
                   </div>
                   <div className="relative w-full aspect-video bg-gray-900/50 rounded-lg overflow-hidden border border-gray-800 shadow-inner">
                      <LoadingOverlay isVisible={targetImage?.isLoading ?? false} message={currentLoadingTip} />
                      <ImageDisplay imageUrl={targetImage?.url} altText="Visual" placeholderText={isTextGenerated ? "이미지를 생성하세요." : "텍스트 생성 후 가능합니다."} className="h-full w-full" />
                      {targetImage?.error && <div className="absolute bottom-0 left-0 right-0 p-4 z-20"><Alert message={targetImage.error} type="error" onClose={isProloguePage ? clearPrologueImageError : () => clearEndingImageError(currentEndingIndex)} /></div>}
                   </div>
                </div>
              </div>
            </div>
            <div className="mt-10 pt-6 border-t border-gray-700/50 flex justify-between items-center bg-gray-900/40 p-4 rounded-xl">
              <Button onClick={handlePrevious} variant="secondary">{isProloguePage ? '← 캐릭터 수정' : '← 이전 단계'}</Button>
              <Button onClick={isProloguePage ? navigateToFirstEnding : (currentEndingIndex < endings.length - 1 ? handleNextEnding : () => navigateToPage(AppPage.FULL_SCENARIO))} disabled={isNextButtonDisabled} variant="primary" size="lg" className="px-8 font-bold">다음 단계 →</Button>
            </div>
          </div>
        );
      case AppPage.FULL_SCENARIO:
        return (
          <div className="space-y-12 animate-fade-in">
             <div className="text-center bg-gray-800/30 p-6 rounded-xl border border-gray-700/50">
                <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest">Core Theme</h2>
                <p className="text-2xl text-sky-300 font-light">{coreTheme}</p>
            </div>
            <div className="space-y-16">
              <section><ScenarioDisplay title="Prologue" text={prologue} />{prologueImage.url && <div className="mt-6"><ImageDisplay imageUrl={prologueImage.url} altText="Prologue" title="Scene Visualization" /></div>}</section>
              {endings.map((e, i) => (
                <section key={e.type} className="pt-8 border-t border-gray-800">
                   <h3 className="text-xl font-bold text-white mb-4">{i + 1}. {e.title}</h3>
                   <ScenarioDisplay text={e.scenario} />
                   {e.image.url && <div className="mt-6"><ImageDisplay imageUrl={e.image.url} altText={e.title} title="Ending Visualization" /></div>}
                </section>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row justify-center gap-4 mt-12 border-t border-gray-700 pt-8">
              <Button onClick={handleGoToStart} variant="secondary">캐릭터 수정으로</Button>
              <Button onClick={handleDownloadCompletePackage} variant="primary">📦 전체 패키지 다운로드</Button>
            </div>
          </div>
        );
      default: return null;
    }
  };

  return (
    <PageLayout title={currentPage === AppPage.INTRODUCTION ? APP_TITLE : (STEPS.find(s => s.id === currentPage)?.name || APP_TITLE)} showStepper={currentPage !== AppPage.INTRODUCTION && currentPage !== AppPage.CHARACTER_CREATION} stepperProps={{ steps: STEPS, currentStep: currentStep }} fullWidth={true}>
      <div className="w-full">
        {error && <Alert message={error} type="error" onClose={clearError} className="mb-6 shadow-lg shadow-red-900/20"/>}
        {renderContent()}
      </div>
      <ConfirmModal isOpen={showConfirmModal} title="캐릭터 설정 변경 확인" message={`캐릭터 설정이 변경되었습니다.\n기존 시나리오를 어떻게 처리하시겠습니까?`} onConfirmReset={handleConfirmReset} onConfirmKeep={handleConfirmKeep} onCancel={handleCancelModal} />
    </PageLayout>
  );
};

export default App;
