import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AudioLines, Bot, Download, Mic, MicOff, Phone, PhoneOff, Send, ShieldCheck, Trash2, Volume2 } from 'lucide-react';
import { getVoiceEndpoint } from '../api.js';
import { usePageTools } from '../App.jsx';

function errorMessage(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = error.data?.error || error.data?.message || error.message || error.error || error.detail;
    return typeof message === 'string' ? message : JSON.stringify(error, null, 2);
  }
  return String(error || 'Unknown voice service error');
}

export function isTtsFailure(message) {
  const value = message.toLowerCase();
  const providerBlocked = value.includes('model_terms_required') || value.includes('terms acceptance')
    || value.includes('library voices') || value.includes('voice is not available');
  const noAudio = value.includes('no audio') || value.includes('without audio');
  return providerBlocked || ((value.includes('tts') || value.includes('text-to-speech') || value.includes('text to speech')) && noAudio);
}

function durationText(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function transcriptTime(value) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(value);
}

function cleanAssistantText(value = '') {
  return String(value)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}[-+*]\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/[*_`]/g, '')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export default function VoiceAgent() {
  const { notify } = usePageTools();
  const clientRef = useRef(null);
  const entryIdRef = useRef(0);
  const activeUserEntryRef = useRef(null);
  const assistantLlmEntryRef = useRef(null);
  const assistantLlmTextRef = useRef('');
  const assistantSegmentsRef = useRef(new Map());
  const assistantCaptionIdsRef = useRef(new Map());
  const lastFinalUserRef = useRef({ text: '', turn: -1 });
  const userTurnRef = useRef(0);
  const noAudioTimerRef = useRef(null);
  const idleResponseTimerRef = useRef(null);
  const farewellWatchdogRef = useRef(null);
  const scheduleIdleResponseRef = useRef(null);
  const endCallRef = useRef(null);
  const autoClosingRef = useRef(false);
  const userSpeakingRef = useRef(false);
  const micEnabledRef = useRef(true);
  const micEnabledBeforeAgentSpeechRef = useRef(null);
  const activeAgentSpeechRef = useRef(new Set());
  const browserSpeechSourceRef = useRef(null);
  const fallbackActiveRef = useRef(false);
  const fallbackAttemptedForTurnRef = useRef(false);
  const fallbackReasonRef = useRef('');
  const assistantLlmCompleteRef = useRef(false);
  const mountedRef = useRef(true);

  const [voiceState, setVoiceState] = useState('idle');
  const [voiceMessage, setVoiceMessage] = useState('Ready to start a voice session');
  const [captionStatus, setCaptionStatus] = useState('Waiting for a call');
  const [entries, setEntries] = useState([]);
  const [diagnostic, setDiagnostic] = useState(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const [textInput, setTextInput] = useState('');
  const [sendingText, setSendingText] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);

  const pushEntry = useCallback((speaker, text, partial = false) => {
    const id = `caption-${++entryIdRef.current}`;
    const entry = { id, speaker, text, partial, createdAt: new Date() };
    setEntries((current) => [...current, entry]);
    return id;
  }, []);

  const updateEntry = useCallback((id, text, partial = false) => {
    if (!id) return;
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, text, partial } : entry));
  }, []);

  const clearIdleResponseTimer = useCallback(() => {
    if (idleResponseTimerRef.current) window.clearTimeout(idleResponseTimerRef.current);
    idleResponseTimerRef.current = null;
  }, []);

  const changeMicrophoneState = useCallback((enabled) => {
    const client = clientRef.current;
    if (!client) return;
    try {
      client.enableMic(enabled);
      micEnabledRef.current = enabled;
      setMicEnabled(enabled);
    } catch (error) {
      setDiagnostic({ title: 'Could not change microphone state', message: errorMessage(error), details: JSON.stringify(error, null, 2) });
    }
  }, []);

  const beginAgentSpeech = useCallback((source) => {
    const activeSources = activeAgentSpeechRef.current;
    if (activeSources.has(source)) return;
    if (activeSources.size === 0) micEnabledBeforeAgentSpeechRef.current = micEnabledRef.current;
    activeSources.add(source);
    setAssistantSpeaking(true);
    if (micEnabledRef.current) changeMicrophoneState(false);
  }, [changeMicrophoneState]);

  const finishAgentSpeech = useCallback((source) => {
    const activeSources = activeAgentSpeechRef.current;
    if (!activeSources.delete(source)) return;
    if (activeSources.size > 0) return;
    setAssistantSpeaking(false);
    const shouldRestoreMicrophone = micEnabledBeforeAgentSpeechRef.current;
    micEnabledBeforeAgentSpeechRef.current = null;
    if (shouldRestoreMicrophone) changeMicrophoneState(true);
  }, [changeMicrophoneState]);

  const stopBrowserSpeech = useCallback(() => {
    fallbackActiveRef.current = false;
    if (noAudioTimerRef.current) window.clearTimeout(noAudioTimerRef.current);
    noAudioTimerRef.current = null;
    clearIdleResponseTimer();
    if (browserSpeechSourceRef.current) {
      finishAgentSpeech(browserSpeechSourceRef.current);
      browserSpeechSourceRef.current = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, [clearIdleResponseTimer, finishAgentSpeech]);

  const speakWithBrowser = useCallback((text, reason = '') => {
    const cleaned = String(text || '').trim();
    if (!cleaned) {
      setCaptionStatus('TTS failed before assistant text arrived');
      return false;
    }
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setCaptionStatus('Browser speech is unavailable in this browser');
      if (autoClosingRef.current) endCallRef.current?.();
      else scheduleIdleResponseRef.current?.();
      return false;
    }
    fallbackActiveRef.current = true;
    if (noAudioTimerRef.current) window.clearTimeout(noAudioTimerRef.current);
    noAudioTimerRef.current = null;
    if (browserSpeechSourceRef.current) {
      finishAgentSpeech(browserSpeechSourceRef.current);
      browserSpeechSourceRef.current = null;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleaned);
    const speechSource = {};
    browserSpeechSourceRef.current = speechSource;
    beginAgentSpeech(speechSource);
    utterance.lang = navigator.language || 'en-US';
    utterance.rate = 1;
    utterance.onstart = () => { if (mountedRef.current) setCaptionStatus('Speaking with browser voice'); };
    utterance.onend = () => {
      if (!mountedRef.current) return;
      fallbackActiveRef.current = false;
      finishAgentSpeech(speechSource);
      if (browserSpeechSourceRef.current === speechSource) browserSpeechSourceRef.current = null;
      setCaptionStatus('Browser voice finished · waiting for you');
      if (autoClosingRef.current) endCallRef.current?.();
      else scheduleIdleResponseRef.current?.();
    };
    utterance.onerror = (event) => {
      if (!mountedRef.current) return;
      const wasActive = fallbackActiveRef.current;
      fallbackActiveRef.current = false;
      finishAgentSpeech(speechSource);
      if (browserSpeechSourceRef.current === speechSource) browserSpeechSourceRef.current = null;
      const detail = event?.error ? ` (${event.error})` : '';
      setCaptionStatus(`Browser speech failed${detail}`);
      setDiagnostic((current) => ({ title: 'Browser speech fallback failed', message: `The browser could not play assistant speech${detail}. Check the output device and browser audio permissions.`, details: current?.details || reason }));
      if (autoClosingRef.current) endCallRef.current?.();
      else if (wasActive) scheduleIdleResponseRef.current?.();
    };
    try {
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (error) {
      fallbackActiveRef.current = false;
      finishAgentSpeech(speechSource);
      if (browserSpeechSourceRef.current === speechSource) browserSpeechSourceRef.current = null;
      setDiagnostic({ title: 'Browser speech fallback failed', message: errorMessage(error), details: error?.stack || '' });
      return false;
    }
  }, [beginAgentSpeech, finishAgentSpeech]);

  const tryBrowserFallback = useCallback((reason = '') => {
    if (fallbackAttemptedForTurnRef.current) return false;
    if (!assistantLlmCompleteRef.current) {
      fallbackReasonRef.current ||= reason;
      return false;
    }
    const text = assistantSegmentsRef.current.size
      ? [...assistantSegmentsRef.current.values()].join(' ')
      : assistantLlmTextRef.current;
    const started = speakWithBrowser(cleanAssistantText(text), reason || fallbackReasonRef.current);
    if (started) {
      fallbackAttemptedForTurnRef.current = true;
      fallbackReasonRef.current = '';
      setVoiceMessage('The voice provider returned no audio; browser speech is being used for this reply.');
    }
    return started;
  }, [speakWithBrowser]);

  const scheduleIdleResponse = useCallback(() => {
    clearIdleResponseTimer();
    if (!clientRef.current?.connected || autoClosingRef.current || userSpeakingRef.current) return;
    idleResponseTimerRef.current = window.setTimeout(() => {
      idleResponseTimerRef.current = null;
      if (!clientRef.current?.connected || autoClosingRef.current || userSpeakingRef.current) return;
      autoClosingRef.current = true;
      const farewell = "I haven't heard back, so I'll end the call now. Thank you for calling. Goodbye.";
      pushEntry('assistant', farewell);
      setVoiceMessage('No response received. Ending the call.');
      setCaptionStatus('Call closing');
      farewellWatchdogRef.current = window.setTimeout(() => endCallRef.current?.(), 12000);
      if (!speakWithBrowser(farewell, 'Automatic call closing')) endCallRef.current?.();
    }, 8000);
  }, [clearIdleResponseTimer, pushEntry, speakWithBrowser]);
  scheduleIdleResponseRef.current = scheduleIdleResponse;

  const scheduleNoAudioFallback = useCallback(() => {
    if (noAudioTimerRef.current || fallbackActiveRef.current) return;
    noAudioTimerRef.current = window.setTimeout(() => {
      noAudioTimerRef.current = null;
      if (clientRef.current?.connected && !fallbackActiveRef.current) {
        tryBrowserFallback('No bot audio arrived after the assistant generated text.');
      }
    }, 6000);
  }, [tryBrowserFallback]);

  const handleUserTranscript = useCallback((message) => {
    const data = message?.data && typeof message.data === 'object' ? message.data : message;
    const text = String(typeof data === 'string' ? data : data?.text || '').trim();
    if (!text) return;
    clearIdleResponseTimer();
    const partial = data?.final === false;
    if (!partial) {
      const normalized = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const previous = lastFinalUserRef.current;
      if (normalized && normalized === previous.text && previous.turn === userTurnRef.current) return;
      lastFinalUserRef.current = { text: normalized, turn: userTurnRef.current };
    }
    if (!activeUserEntryRef.current) activeUserEntryRef.current = pushEntry('user', text, partial);
    else updateEntry(activeUserEntryRef.current, text, partial);
    if (!partial) activeUserEntryRef.current = null;
    setCaptionStatus(partial ? 'Listening · live caption updating' : 'Request received · preparing a reply');
  }, [clearIdleResponseTimer, pushEntry, updateEntry]);

  const handleBotOutput = useCallback((message) => {
    if (!message || message.will_be_spoken === false) return;
    const progress = message.spoken_progress?.accumulated_text;
    const text = String(progress?.trim() ? progress : message.text || '').trim();
    if (!text) return;
    const segment = message.segment_id ?? 'active';
    assistantSegmentsRef.current.set(segment, text);
    const partial = message.spoken_status === 'new' || message.spoken_status === 'in-progress';
    let entryId = assistantCaptionIdsRef.current.get(segment);
    if (!entryId && assistantLlmEntryRef.current) {
      entryId = assistantLlmEntryRef.current;
      assistantLlmEntryRef.current = null;
      assistantCaptionIdsRef.current.set(segment, entryId);
    }
    if (!entryId) {
      entryId = pushEntry('assistant', text, partial);
      assistantCaptionIdsRef.current.set(segment, entryId);
    } else updateEntry(entryId, text, partial);
    setCaptionStatus(message.spoken_status === 'completed' ? 'Assistant finished · waiting for you' : 'Assistant is responding');
    scheduleNoAudioFallback();
  }, [pushEntry, scheduleNoAudioFallback, updateEntry]);

  const handleBotLlmText = useCallback((message) => {
    const data = message?.data && typeof message.data === 'object' ? message.data : message;
    const chunk = String(typeof data === 'string' ? data : data?.text || '');
    if (!chunk.trim()) return;
    assistantLlmTextRef.current += chunk;
    const hasOutput = assistantSegmentsRef.current.size > 0;
    if (!hasOutput) {
      if (!assistantLlmEntryRef.current) assistantLlmEntryRef.current = pushEntry('assistant', assistantLlmTextRef.current, true);
      else updateEntry(assistantLlmEntryRef.current, assistantLlmTextRef.current, true);
    }
    setCaptionStatus('Assistant is preparing a reply');
    scheduleNoAudioFallback();
  }, [pushEntry, scheduleNoAudioFallback, updateEntry]);

  const endCall = useCallback(async () => {
    autoClosingRef.current = false;
    clearIdleResponseTimer();
    if (farewellWatchdogRef.current) window.clearTimeout(farewellWatchdogRef.current);
    farewellWatchdogRef.current = null;
    const client = clientRef.current;
    if (!client) {
      setVoiceState('idle');
      setVoiceMessage('Ready to start a voice session');
      return;
    }
    setVoiceState('disconnecting');
    setVoiceMessage('Ending the call…');
    stopBrowserSpeech();
    activeAgentSpeechRef.current.clear();
    micEnabledBeforeAgentSpeechRef.current = null;
    setAssistantSpeaking(false);
    try {
      await client.disconnect();
    } catch (error) {
      setDiagnostic({ title: 'Call disconnect failed', message: errorMessage(error), details: JSON.stringify(error, null, 2) });
    } finally {
      clientRef.current = null;
      setVoiceState('idle');
      setVoiceMessage('Call ended');
      setCaptionStatus('Call ended');
    }
  }, [clearIdleResponseTimer, stopBrowserSpeech]);
  endCallRef.current = endCall;

  const startCall = useCallback(async () => {
    if (clientRef.current || voiceState === 'connecting') return;
    stopBrowserSpeech();
    autoClosingRef.current = false;
    userSpeakingRef.current = false;
    setVoiceState('connecting');
    setVoiceMessage('Requesting microphone access and connecting…');
    setCaptionStatus('Connecting to the voice assistant');
    setDiagnostic(null);
    setCallSeconds(0);
    setMicEnabled(true);
    micEnabledRef.current = true;
    micEnabledBeforeAgentSpeechRef.current = null;
    activeAgentSpeechRef.current.clear();
    setAssistantSpeaking(false);
    setEntries([]);
    entryIdRef.current = 0;
    assistantSegmentsRef.current.clear();
    assistantCaptionIdsRef.current.clear();
    assistantCaptionIdsRef.current.clear();
    assistantLlmTextRef.current = '';
    assistantLlmEntryRef.current = null;
    activeUserEntryRef.current = null;
    lastFinalUserRef.current = { text: '', turn: -1 };
    userTurnRef.current = 0;
    fallbackAttemptedForTurnRef.current = false;
    fallbackReasonRef.current = '';
    assistantLlmCompleteRef.current = false;

    try {
      const [{ PipecatClient }, { SmallWebRTCTransport }] = await Promise.all([
        import('@pipecat-ai/client-js'),
        import('@pipecat-ai/small-webrtc-transport'),
      ]);
      const client = new PipecatClient({
        transport: new SmallWebRTCTransport(),
        enableMic: true,
        callbacks: {
          onConnected: () => {
            if (!mountedRef.current) return;
            setVoiceState('connected');
            setVoiceMessage('Connected. Speak naturally or type a message below.');
            setCaptionStatus('Connected · waiting for speech');
          },
          onDisconnected: () => {
            stopBrowserSpeech();
            if (farewellWatchdogRef.current) window.clearTimeout(farewellWatchdogRef.current);
            farewellWatchdogRef.current = null;
            activeAgentSpeechRef.current.clear();
            micEnabledBeforeAgentSpeechRef.current = null;
            clientRef.current = null;
            if (mountedRef.current) {
              setAssistantSpeaking(false);
              setVoiceState('idle');
              setVoiceMessage('Call ended');
              setCaptionStatus('Call ended');
            }
          },
          onUserInput: handleUserTranscript,
          onUserTranscript: handleUserTranscript,
          onBotOutput: handleBotOutput,
          onBotLlmText: handleBotLlmText,
          onBotLlmStarted: () => {
            stopBrowserSpeech();
            fallbackAttemptedForTurnRef.current = false;
            fallbackReasonRef.current = '';
            assistantLlmCompleteRef.current = false;
            assistantLlmTextRef.current = '';
            assistantSegmentsRef.current.clear();
            assistantCaptionIdsRef.current.clear();
            assistantCaptionIdsRef.current.clear();
            assistantLlmEntryRef.current = null;
            if (noAudioTimerRef.current) window.clearTimeout(noAudioTimerRef.current);
            noAudioTimerRef.current = null;
            setCaptionStatus('Assistant is preparing a reply');
          },
          onBotLlmStopped: () => {
            assistantLlmCompleteRef.current = true;
            if (assistantLlmEntryRef.current) updateEntry(assistantLlmEntryRef.current, assistantLlmTextRef.current, false);
            if (fallbackReasonRef.current) tryBrowserFallback(fallbackReasonRef.current);
          },
          onBotTtsStarted: () => setCaptionStatus('Generating spoken reply'),
          onBotStartedSpeaking: () => {
            if (noAudioTimerRef.current) window.clearTimeout(noAudioTimerRef.current);
            noAudioTimerRef.current = null;
            beginAgentSpeech('server');
            stopBrowserSpeech();
            setCaptionStatus('Assistant is speaking');
          },
          onBotStoppedSpeaking: () => {
            finishAgentSpeech('server');
            setCaptionStatus('Waiting for you to speak');
            scheduleIdleResponse();
          },
          onUserStartedSpeaking: () => {
            userTurnRef.current += 1;
            userSpeakingRef.current = true;
            if (autoClosingRef.current) {
              endCallRef.current?.();
              return;
            }
            clearIdleResponseTimer();
            if (noAudioTimerRef.current) window.clearTimeout(noAudioTimerRef.current);
            noAudioTimerRef.current = null;
            setCaptionStatus('Listening to you');
          },
          onUserStoppedSpeaking: () => {
            userSpeakingRef.current = false;
            setCaptionStatus('Processing what you said');
          },
          onError: (error) => {
            const message = errorMessage(error);
            const details = JSON.stringify(error, null, 2);
            const ttsFailure = isTtsFailure(message);
            setDiagnostic({ title: ttsFailure ? 'TTS returned no audio' : 'Pipecat voice error', message, details });
            if (ttsFailure) {
              if (!fallbackAttemptedForTurnRef.current && !fallbackReasonRef.current) {
                fallbackReasonRef.current = message;
                tryBrowserFallback(message);
                notify('The voice provider returned no audio. Trying browser speech for this reply.', 'error');
              }
            }
            const fatal = error?.data?.fatal === true || error?.fatal === true;
            if (fatal) {
              setVoiceState('error');
              setVoiceMessage(message);
            } else if (!ttsFailure) setCaptionStatus(`Voice service error · ${message}`);
          },
          onDeviceError: (error) => {
            const message = errorMessage(error);
            setDiagnostic({ title: 'Microphone or speaker device error', message, details: JSON.stringify(error, null, 2) });
          },
        },
      });
      clientRef.current = client;
      await client.connect({ webrtcRequestParams: { endpoint: getVoiceEndpoint() } });
      if (mountedRef.current) setVoiceState('connected');
    } catch (error) {
      stopBrowserSpeech();
      const failedClient = clientRef.current;
      clientRef.current = null;
      failedClient?.disconnect().catch(() => {});
      const message = errorMessage(error);
      setVoiceState('error');
      setVoiceMessage('The voice call could not connect. Check the Pipecat server, endpoint, and microphone permission.');
      setCaptionStatus('Voice call failed');
      setDiagnostic({ title: 'Voice call failed', message, details: error?.stack || JSON.stringify(error, null, 2) });
      notify(message, 'error');
    }
  }, [beginAgentSpeech, clearIdleResponseTimer, finishAgentSpeech, handleBotLlmText, handleBotOutput, handleUserTranscript, notify, scheduleIdleResponse, stopBrowserSpeech, tryBrowserFallback, updateEntry, voiceState]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopBrowserSpeech();
      if (farewellWatchdogRef.current) window.clearTimeout(farewellWatchdogRef.current);
      farewellWatchdogRef.current = null;
      if (clientRef.current) clientRef.current.disconnect().catch(() => {});
      clientRef.current = null;
    };
  }, [stopBrowserSpeech]);

  useEffect(() => {
    if (voiceState !== 'connected') return undefined;
    const timer = window.setInterval(() => setCallSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [voiceState]);

  async function sendText(event) {
    event.preventDefault();
    const text = textInput.trim();
    if (!text || !clientRef.current?.connected) return;
    if (autoClosingRef.current) {
      endCallRef.current?.();
      return;
    }
    clearIdleResponseTimer();
    setSendingText(true);
    setTextInput('');
    try {
      await clientRef.current.sendText(text, { run_immediately: true, audio_response: true });
    } catch (error) {
      setTextInput(text);
      const message = errorMessage(error);
      setDiagnostic({ title: 'Could not send text to the voice agent', message, details: JSON.stringify(error, null, 2) });
      notify(message, 'error');
    } finally {
      setSendingText(false);
    }
  }

  function toggleMicrophone() {
    if (!clientRef.current || activeAgentSpeechRef.current.size > 0) return;
    changeMicrophoneState(!micEnabledRef.current);
  }

  function clearTranscript() {
    setEntries([]);
    activeUserEntryRef.current = null;
    assistantLlmEntryRef.current = null;
    assistantSegmentsRef.current.clear();
    assistantCaptionIdsRef.current.clear();
    assistantCaptionIdsRef.current.clear();
  }

  function exportTranscript() {
    const content = entries.map((entry) => {
      const text = entry.speaker === 'assistant' ? cleanAssistantText(entry.text) : entry.text;
      return `[${transcriptTime(entry.createdAt)}] ${entry.speaker === 'user' ? 'Patient' : 'AetherCare'}: ${text}`;
    }).join('\n\n');
    const blob = new Blob([content || 'No conversation transcript yet.'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `aethercare-transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const isActive = voiceState === 'connected';
  const isBusy = voiceState === 'connecting' || voiceState === 'disconnecting';
  const newestFirstEntries = entries.slice().reverse();

  return (
    <section className="voice-page">
      <div className="voice-session-strip">
        <div className={`session-chip ${isActive ? 'live' : ''}`}><i />{isActive ? 'Listening · live session' : voiceState === 'connecting' ? 'Connecting · microphone requested' : 'Voice session'}{isActive && <><span>·</span><strong>{durationText(callSeconds)}</strong></>}</div>
        <span className="voice-endpoint-label">Pipecat · WebRTC</span>
      </div>

      <section className="voice-stage" aria-label="Voice call controls">
        <div className={`voice-orb-shell ${isActive ? 'active' : ''} ${voiceState === 'connecting' ? 'connecting' : ''}`}>
          <div className="voice-orb"><AudioLines size={44} strokeWidth={1.5} /></div>
        </div>
        <p className="voice-mode-label">{isActive ? 'LIVE' : voiceState === 'connecting' ? 'CONNECTING' : 'VOICE ASSISTANT'}</p>
        <h1>{isActive ? 'I’m listening.' : 'Talk through an appointment.'}</h1>
        <p className="voice-intro">Ask about doctors and availability, or book and cancel after confirming the patient’s phone number.</p>
        <div className="voice-controls">
          <button className="button button-primary start-call" type="button" onClick={startCall} disabled={isActive || isBusy}><Mic size={17} />{voiceState === 'connecting' ? 'Connecting…' : 'Start call'}</button>
          {isActive && <button className="button button-secondary mic-toggle" type="button" onClick={toggleMicrophone} disabled={assistantSpeaking} aria-label={assistantSpeaking ? 'Microphone muted while assistant speaks' : micEnabled ? 'Mute microphone' : 'Unmute microphone'}>{micEnabled ? <Mic size={16} /> : <MicOff size={16} />}</button>}
          <button className="button button-danger end-call" type="button" onClick={endCall} disabled={!isActive}><PhoneOff size={16} />End call</button>
        </div>
        <p className={`voice-state-copy ${voiceState === 'error' ? 'error-text' : ''}`}>{voiceMessage}</p>
      </section>

      <section className="panel conversation-panel" aria-label="Live conversation transcript">
        <div className="conversation-heading"><div className="conversation-title"><span className="conversation-icon"><Bot size={18} /></span><div><div className="conversation-title-line"><h2>Live clinical conversation</h2><span className="live-feed-chip">{isActive ? 'Live feed' : 'Transcript'}</span></div><p>Voice captions from the microphone and assistant response appear here.</p></div></div><div className="conversation-actions"><button className="button button-small button-secondary" type="button" onClick={exportTranscript} disabled={!entries.length}><Download size={14} />Export .txt</button><button className="icon-button" type="button" onClick={clearTranscript} aria-label="Clear transcript"><Trash2 size={15} /></button></div></div>
        <div className="transcript-list" aria-live="polite" aria-relevant="additions text">
          {entries.length ? newestFirstEntries.map((entry) => <article className={`transcript-entry ${entry.speaker} ${entry.partial ? 'partial' : ''}`} key={entry.id}><div className="transcript-avatar">{entry.speaker === 'user' ? 'YOU' : <Bot size={16} />}</div><div className="transcript-content"><div className="transcript-meta"><strong>{entry.speaker === 'user' ? 'Patient (You)' : 'AetherCare AI'}</strong><time>{transcriptTime(entry.createdAt)}</time>{entry.partial && <span className="partial-label">Live</span>}</div><p>{entry.speaker === 'assistant' ? cleanAssistantText(entry.text) : entry.text}</p></div></article>) : <div className="transcript-empty"><span><Activity size={20} /></span><strong>Your conversation will appear here</strong><p>Start a call and speak. You can also send typed messages while connected.</p></div>}
        </div>
        <form className="message-composer" onSubmit={sendText}>
          <span className={`composer-state ${isActive ? 'active' : ''}`}><i />{isActive ? 'Voice channel active' : 'Start a call to send a message'}</span>
          <div className="composer-input-row"><input value={textInput} onChange={(event) => setTextInput(event.target.value)} disabled={!isActive || sendingText} placeholder={isActive ? 'Type a response or speak into your microphone…' : 'Text messages are available during a call'} aria-label="Message the voice assistant" /><span className="composer-audio-label"><Volume2 size={14} />Audio reply</span><button className="button button-primary send-button" type="submit" disabled={!isActive || !textInput.trim() || sendingText}><Send size={15} />{sendingText ? 'Sending…' : 'Send'}</button></div>
        </form>
      </section>
      <div className="voice-footnote"><ShieldCheck size={15} /><span>Appointment scheduling assistant · Stored appointment data is managed by your local JSON-backed API.</span></div>
    </section>
  );
}
