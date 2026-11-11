import { useState, useEffect, useRef } from "react";
import { MessageCircle, X } from "lucide-react";
import { useLocation } from "wouter";
import { ChatPanel } from "@/components/ChatPanel";

interface ChatConfig {
  enabled: boolean;
  page_patterns: string[];
  content_types: string[];
  agent_name: string | null;
  agent_icon: string | null;
}

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  question_tag?: string | null;
}

function detectContentFromUrl(pathname: string): { contentType: string | null; contentSlug: string | null; locale: string } {
  const programEnMatch = pathname.match(/^\/en\/career-programs\/([^/?#]+)/);
  if (programEnMatch) return { contentType: "program", contentSlug: programEnMatch[1], locale: "en" };

  const programEsMatch = pathname.match(/^\/es\/programas-de-carrera\/([^/?#]+)/);
  if (programEsMatch) return { contentType: "program", contentSlug: programEsMatch[1], locale: "es" };

  const locationEnMatch = pathname.match(/^\/en\/location\/([^/?#]+)/);
  if (locationEnMatch) return { contentType: "location", contentSlug: locationEnMatch[1], locale: "en" };

  const locationEsMatch = pathname.match(/^\/es\/ubicacion\/([^/?#]+)/);
  if (locationEsMatch) return { contentType: "location", contentSlug: locationEsMatch[1], locale: "es" };

  const localeMatch = pathname.match(/^\/(en|es)\//);
  const locale = localeMatch?.[1] || "en";

  const pageSlugMatch = pathname.match(/^\/(en|es)\/([^/?#]+(?:\/[^/?#]+)*)/);
  if (pageSlugMatch) {
    return { contentType: "page", contentSlug: pageSlugMatch[2], locale };
  }

  return { contentType: null, contentSlug: null, locale };
}

export function ChatWidget() {
  const [pathname] = useLocation();
  const [config, setConfig] = useState<ChatConfig | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/chat/config")
      .then(r => r.json())
      .then(setConfig)
      .catch(() => setConfig({ enabled: false, page_patterns: [], content_types: [] }));
  }, []);

  const shouldShow = () => {
    if (!config?.enabled) return false;
    if (pathname.startsWith("/private/")) return false;

    const hasPatterns = config.page_patterns && config.page_patterns.length > 0;
    const hasContentTypes = config.content_types && config.content_types.length > 0;

    if (!hasPatterns && !hasContentTypes) return true;

    let matchesPattern = false;
    if (hasPatterns) {
      matchesPattern = config.page_patterns.some(pattern => {
        try {
          return new RegExp(pattern).test(pathname);
        } catch {
          return false;
        }
      });
    }

    let matchesContentType = false;
    if (hasContentTypes) {
      const { contentType } = detectContentFromUrl(pathname);
      if (contentType) {
        matchesContentType = config.content_types.includes(contentType);
      }
    }

    return matchesPattern || matchesContentType;
  };

  const startConversation = async () => {
    if (conversationId || isStarting) return;
    setIsStarting(true);

    const { contentType, contentSlug, locale } = detectContentFromUrl(pathname);

    try {
      const res = await fetch("/api/chat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_url: pathname,
          content_type: contentType,
          content_slug: contentSlug,
          locale,
        }),
      });
      const data = await res.json();
      setConversationId(data.conversation_id);
    } catch (err) {
      console.error("Failed to start conversation:", err);
    } finally {
      setIsStarting(false);
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    if (!conversationId) {
      startConversation();
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading || !conversationId) return;

    const userMsg: Message = { role: "user", content: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    const { contentType, contentSlug, locale } = detectContentFromUrl(pathname);

    try {
      const res = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          message: trimmed,
          content_type: contentType,
          content_slug: contentSlug,
          locale,
        }),
      });
      const data = await res.json();
      const assistantMsg: Message = {
        id: data.id,
        role: "assistant",
        content: data.content,
        question_tag: data.question_tag,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error("Failed to send message:", err);
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, something went wrong. Please try again." }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!shouldShow()) return null;

  return (
    <>
      {isOpen && (
        <div
          className="fixed right-4 w-[380px] max-w-[calc(100vw-2rem)] bg-background border border-border rounded-md shadow-lg flex flex-col overflow-hidden"
          style={{ height: "500px", bottom: "80px", zIndex: 9998 }}
          data-testid="chat-widget-panel"
        >
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            input={input}
            onInputChange={setInput}
            onSend={sendMessage}
            agentName={config?.agent_name}
            agentIcon={config?.agent_icon}
            onClose={() => setIsOpen(false)}
            inputRef={inputRef}
            inputDisabled={!conversationId}
            className="flex-1"
          />
        </div>
      )}

      <button
        onClick={isOpen ? () => setIsOpen(false) : handleOpen}
        className="fixed bottom-4 right-4 p-3 rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
        style={{ zIndex: 9999 }}
        aria-label={isOpen ? "Close chat" : "Open chat"}
        aria-expanded={isOpen}
        data-testid="button-chat-bubble"
      >
        {isOpen ? (
          <X className="h-6 w-6" aria-hidden="true" />
        ) : (
          <MessageCircle className="h-6 w-6" aria-hidden="true" />
        )}
      </button>
    </>
  );
}
