import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiProductCard } from '@shop/shared';
import { api } from '../lib/api';
const ASSISTANT_TURN_TIMEOUT_MS = 30000;
export type TextAssistMessage = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    language: string;
    products: AiProductCard[];
};
type SpeechAlternative = {
    transcript: string;
};
type SpeechResult = {
    isFinal: boolean;
    0: SpeechAlternative;
};
type SpeechResultList = {
    length: number;
    [index: number]: SpeechResult;
};
type SpeechEvent = {
    resultIndex: number;
    results: SpeechResultList;
};
type SpeechRecognizer = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((event: SpeechEvent) => void) | null;
    onerror: ((event: {
        error: string;
    }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};
type SpeechRecognizerConstructor = new () => SpeechRecognizer;
const recognizerConstructor = (): SpeechRecognizerConstructor | null => {
    const w = window as unknown as {
        SpeechRecognition?: SpeechRecognizerConstructor;
        webkitSpeechRecognition?: SpeechRecognizerConstructor;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
export type UseTextAssistResult = {
    messages: TextAssistMessage[];
    send: (text: string) => Promise<void>;
    pending: boolean;
    error: string | null;
    dictation: {
        supported: boolean;
        listening: boolean;
        interim: string;
        start: () => void;
        stop: () => void;
    };
};
export const useTextAssist = (opts: {
    ensureConversation: () => Promise<string>;
    resolveLanguage: () => string;
}): UseTextAssistResult => {
    const { ensureConversation, resolveLanguage } = opts;
    const [messages, setMessages] = useState<TextAssistMessage[]>([]);
    const [pending, setPending] = useState(false);
    const pendingRef = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [listening, setListening] = useState(false);
    const [interim, setInterim] = useState('');
    const messagesRef = useRef<TextAssistMessage[]>([]);
    messagesRef.current = messages;
    const recognizerRef = useRef<SpeechRecognizer | null>(null);
    const supported = useMemo(() => recognizerConstructor() !== null, []);
    const send = useCallback(async (text: string): Promise<void> => {
        const body = text.trim();
        if (body.length === 0 || pendingRef.current)
            return;
        pendingRef.current = true;
        const id = crypto.randomUUID();
        setMessages((current) => [
            ...current,
            { id, role: 'user', text: body, language: resolveLanguage(), products: [] },
        ]);
        setPending(true);
        setError(null);
        try {
            const conversationId = await ensureConversation();
            const result = await api.post<{
                reply: string;
                language: string;
                products?: AiProductCard[];
            }>(`/api/ai/convo/${conversationId}/message`, {
                text: body,
                history: messagesRef.current.slice(-12).map((message) => ({
                    role: message.role,
                    content: message.text,
                })),
            }, undefined, AbortSignal.timeout(ASSISTANT_TURN_TIMEOUT_MS));
            setMessages((current) => [
                ...current.map((message) => message.id === id ? { ...message, language: result.language } : message),
                {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    text: result.reply,
                    language: result.language,
                    products: result.products ?? [],
                },
            ]);
        }
        catch (err) {
            setError(err instanceof DOMException && err.name === 'TimeoutError'
                ? 'That took too long, so I stopped the request. Try once more.'
                : "That didn't go through — try again.");
        }
        finally {
            pendingRef.current = false;
            setPending(false);
        }
    }, [ensureConversation, resolveLanguage]);
    const sendRef = useRef(send);
    sendRef.current = send;
    const startDictation = useCallback(() => {
        const Recognizer = recognizerConstructor();
        if (!Recognizer || recognizerRef.current)
            return;
        const recognizer = new Recognizer();
        recognizerRef.current = recognizer;
        recognizer.lang = resolveLanguage();
        recognizer.continuous = false;
        recognizer.interimResults = true;
        recognizer.onresult = (event) => {
            let finalText = '';
            let draft = '';
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const result = event.results[i];
                if (!result)
                    continue;
                if (result.isFinal)
                    finalText += result[0].transcript;
                else
                    draft += result[0].transcript;
            }
            setInterim(draft);
            if (finalText.trim().length > 0) {
                setInterim('');
                void sendRef.current(finalText);
            }
        };
        recognizer.onerror = (event) => {
            setError(event.error === 'not-allowed'
                ? "Your browser is blocking the microphone — keep typing and I'll answer."
                : "The mic didn't catch that — try again.");
        };
        recognizer.onend = () => {
            recognizerRef.current = null;
            setListening(false);
            setInterim('');
        };
        recognizer.start();
        setListening(true);
    }, [resolveLanguage]);
    const stopDictation = useCallback(() => {
        recognizerRef.current?.stop();
    }, []);
    useEffect(() => () => {
        recognizerRef.current?.abort();
        recognizerRef.current = null;
    }, []);
    return {
        messages,
        send,
        pending,
        error,
        dictation: {
            supported,
            listening,
            interim,
            start: startDictation,
            stop: stopDictation,
        },
    };
};
