import React, { useState, useEffect, useRef } from 'react';

interface VoiceControllerProps {
  onProcessUtterance: (text: string) => Promise<void>;
  isProcessing: boolean;
  lastVoiceResponse: string | null;
  ttsEnabled: boolean;
}

export const VoiceController: React.FC<VoiceControllerProps> = ({
  onProcessUtterance,
  isProcessing,
  lastVoiceResponse,
  ttsEnabled
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'hi-IN'; // Default to Indian English / Hindi mix

    recognition.onresult = (event: any) => {
      let current = '';
      for (let i = 0; i < event.results.length; i++) {
        current += event.results[i][0].transcript;
      }
      setTranscript(current);
    };

    recognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
      if (transcript.trim()) {
        onProcessUtterance(transcript.trim());
      }
    };

    recognitionRef.current = recognition;
  }, [transcript, onProcessUtterance]);

  // Handle TTS playback when a new voice response arrives
  useEffect(() => {
    if (ttsEnabled && lastVoiceResponse && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(lastVoiceResponse);
      utterance.lang = 'hi-IN';
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  }, [lastVoiceResponse, ttsEnabled]);

  const toggleRecording = () => {
    if (!supported) {
      alert('Speech recognition is not supported in this browser. Please use the quick simulation buttons below!');
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    } else {
      setTranscript('');
      try {
        recognitionRef.current?.start();
        setIsRecording(true);
      } catch (err) {
        console.error('Failed to start speech recognition:', err);
      }
    }
  };

  const handleChipClick = (promptText: string) => {
    setTranscript(promptText);
    onProcessUtterance(promptText);
  };

  return (
    <section className="voice-hero">
      <div className="mic-container">
        <button
          className={`mic-button ${isRecording ? 'recording' : ''}`}
          onClick={toggleRecording}
          disabled={isProcessing}
          aria-label={isRecording ? 'Stop Recording' : 'Start Recording'}
          title="Click to speak (English / Hindi / Hinglish)"
        >
          {isProcessing ? '⏳' : isRecording ? '⏹️' : '🎙️'}
        </button>

        <div className={`waveform-bars ${isRecording ? 'active' : ''}`}>
          <div className="wave-bar"></div>
          <div className="wave-bar"></div>
          <div className="wave-bar"></div>
          <div className="wave-bar"></div>
          <div className="wave-bar"></div>
        </div>
      </div>

      <div className="transcript-display">
        {isRecording && (
          <span style={{ fontSize: '0.8rem', color: 'var(--debit-rose)', fontWeight: 600 }}>
            ● Listening in real-time...
          </span>
        )}
        {transcript ? (
          <p className="transcript-text">"{transcript}"</p>
        ) : (
          <p className="transcript-placeholder">
            {isRecording
              ? 'Speak naturally (e.g. "Ramesh ko 500 rupaye udhaar")...'
              : 'Tap microphone to speak or click any simulation chip below'}
          </p>
        )}
      </div>

      {lastVoiceResponse && (
        <div className="voice-response-card">
          <span>🔊</span>
          <p>{lastVoiceResponse}</p>
        </div>
      )}

      <div className="quick-prompts">
        <span className="quick-prompts-label">One-Click Voice Simulation Chips</span>
        <div className="prompt-chips">
          <button
            className="chip-btn"
            onClick={() => handleChipClick('Ramesh ko 500 rupaye udhaar')}
            disabled={isProcessing}
          >
            <span>➕</span> "Ramesh ko 500 rupaye udhaar"
          </button>
          <button
            className="chip-btn"
            onClick={() => handleChipClick('Pooja ne 500 jama kiye')}
            disabled={isProcessing}
          >
            <span>💵</span> "Pooja ne 500 jama kiye"
          </button>
          <button
            className="chip-btn"
            onClick={() => handleChipClick('Sharma General Store ka balance batao')}
            disabled={isProcessing}
          >
            <span>🔍</span> "Sharma General Store ka balance batao"
          </button>
          <button
            className="chip-btn"
            onClick={() => handleChipClick('Kitna lena baaki hai?')}
            disabled={isProcessing}
          >
            <span>📋</span> "Kitna lena baaki hai?"
          </button>
          <button
            className="chip-btn"
            onClick={() => handleChipClick('Aaj ka hisaab batao')}
            disabled={isProcessing}
          >
            <span>📊</span> "Aaj ka hisaab batao"
          </button>
        </div>
      </div>
    </section>
  );
};
