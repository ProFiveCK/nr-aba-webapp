import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../lib/api';

interface Message {
    id: string;
    text: string;
    isUser: boolean;
    timestamp: Date;
}

function parseMarkdown(text: string) {
    return text
        // Headers
        .replace(/^### (.*$)/gim, '<h3 class="font-bold text-base mt-3 mb-1">$1</h3>')
        .replace(/^## (.*$)/gim, '<h2 class="font-bold text-lg mt-3 mb-1">$1</h2>')
        .replace(/^# (.*$)/gim, '<h1 class="font-bold text-xl mt-3 mb-1">$1</h1>')
        // Bold
        .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
        // Italic
        .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
        // Code blocks
        .replace(/```([\s\S]*?)```/g, '<pre class="bg-gray-100 rounded p-2 my-2 overflow-x-auto text-xs"><code>$1</code></pre>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 rounded text-sm">$1</code>')
        // Numbered lists
        .replace(/^\d+\.\s+(.*)$/gim, '<li class="ml-4 list-decimal">$1</li>')
        // Bullet lists
        .replace(/^[\-\*]\s+(.*)$/gim, '<li class="ml-4 list-disc">$1</li>')
        // Line breaks
        .replace(/\n/g, '<br>');
}

export function AiHelper() {
    const { user } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping]);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text) return;

        const newUserMsg: Message = {
            id: Date.now().toString(),
            text,
            isUser: true,
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, newUserMsg]);
        setInput('');
        setIsTyping(true);

        const role = user?.role || 'user';
        const accessibleFeatures = [];
        if (['user', 'banking', 'reviewer', 'admin'].includes(role)) accessibleFeatures.push('Generator', 'My Batches');
        if (['user', 'banking', 'reviewer', 'admin'].includes(role)) accessibleFeatures.push('Reader');
        if (['banking', 'reviewer', 'admin'].includes(role)) accessibleFeatures.push('Banking');
        if (['reviewer', 'admin'].includes(role)) accessibleFeatures.push('SaaS', 'Reviewer');
        if (['admin'].includes(role)) accessibleFeatures.push('Admin');

        const contextMessage = `[System Context: User role is '${role}'. Accessible features: ${accessibleFeatures.join(', ')}. ${text}]`;

        try {
            const response = await apiClient.post<{ reply: string }>('/ai-helper/chat', {
                message: contextMessage,
                userRole: role,
                userName: user?.display_name || user?.email || 'Guest',
            });

            const botMsg: Message = {
                id: (Date.now() + 1).toString(),
                text: response.reply,
                isUser: false,
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, botMsg]);
        } catch (err) {
            const errorMsg: Message = {
                id: (Date.now() + 1).toString(),
                text: `Error: ${(err as Error)?.message || 'Failed to get response'}`,
                isUser: false,
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, errorMsg]);
        } finally {
            setIsTyping(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end space-y-4">
            {/* Chat Window */}
            {isOpen && (
                <div className="w-80 sm:w-96 h-[500px] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 animate-in slide-in-from-bottom-10 fade-in duration-200">
                    {/* Header */}
                    <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-4 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2 text-white">
                            <span className="text-xl">🤖</span>
                            <h3 className="font-semibold">AI Helper</h3>
                        </div>
                        <button 
                            onClick={() => setIsOpen(false)}
                            className="text-white/80 hover:text-white transition-colors"
                        >
                            ✕
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                        {messages.length === 0 && (
                            <div className="text-center text-gray-500 text-sm mt-8">
                                <p>Ekamawir omo {user?.display_name?.split(' ')[0] || 'there'},</p>
                                <p className="mt-1">how can I help you?</p>
                            </div>
                        )}
                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-sm ${
                                        msg.isUser
                                            ? 'bg-indigo-600 text-white rounded-br-none'
                                            : 'bg-white text-gray-800 rounded-bl-none border border-gray-100'
                                    }`}
                                >
                                    {msg.isUser ? (
                                        msg.text
                                    ) : (
                                        <div 
                                            dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.text) }} 
                                            className="prose prose-sm max-w-none"
                                        />
                                    )}
                                </div>
                            </div>
                        ))}
                        {isTyping && (
                            <div className="flex justify-start">
                                <div className="bg-white border border-gray-100 text-gray-500 rounded-2xl rounded-bl-none px-4 py-3 text-xs shadow-sm">
                                    AI is thinking...
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="p-3 bg-white border-t border-gray-100 shrink-0">
                        <div className="relative">
                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyPress}
                                placeholder="Ask a question..."
                                className="w-full pl-4 pr-10 py-2.5 bg-gray-100 border-transparent focus:bg-white border focus:border-indigo-500 rounded-full text-sm focus:outline-none transition-all"
                                disabled={isTyping}
                            />
                            <button
                                onClick={handleSend}
                                disabled={!input.trim() || isTyping}
                                className="absolute right-1.5 top-1.5 p-1.5 bg-indigo-600 text-white rounded-full hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                                </svg>
                            </button>
                        </div>
                        <div className="mt-2 flex justify-center">
                            <p className="text-[10px] text-gray-400">AI can make mistakes. Verify important info.</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`h-14 w-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-105 focus:outline-none focus:ring-4 focus:ring-indigo-200 ${
                    isOpen 
                        ? 'bg-gray-800 text-white rotate-90' 
                        : 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white'
                }`}
            >
                {isOpen ? (
                    <span className="text-2xl font-light leading-none">✕</span>
                ) : (
                    <span className="text-3xl">🤖</span>
                )}
            </button>
        </div>
    );
}

