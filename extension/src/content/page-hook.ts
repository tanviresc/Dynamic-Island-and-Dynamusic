/**
 * Page-context (MAIN world) network/streaming lifecycle hook.
 * Detects AI generation start/completion via fetch & EventSource streams
 * without reading or forwarding conversation content.
 */
(function initIslandPageHook() {
  if ((window as unknown as { __islandPageHookInstalled?: boolean }).__islandPageHookInstalled) {
    return;
  }
  (window as unknown as { __islandPageHookInstalled?: boolean }).__islandPageHookInstalled = true;

  const HOOK_TAG = "island-page-hook";
  let activeStreams = 0;

  function emitLifecycle(event: "stream_active" | "stream_idle"): void {
    try {
      window.postMessage(
        {
          __island: HOOK_TAG,
          event,
          activeStreams,
        },
        window.location.origin
      );
    } catch {
      /* ignore cross-origin postMessage errors */
    }
  }

  function isGenerationRequest(urlStr: string, method: string): boolean {
    if (method.toUpperCase() !== "POST") return false;
    const host = window.location.hostname.toLowerCase();
    try {
      const url = new URL(urlStr, window.location.href);
      const p = url.pathname;
      if (host.includes("claude.ai")) {
        return /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/(completion|retry_completion)/i.test(p);
      }
      if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
        return /\/backend-(api|anon)\/(f\/)?conversation\/?$/i.test(p);
      }
      if (host.includes("gemini.google.com")) {
        return /StreamGenerate/i.test(p) || /bardchatui/i.test(url.search);
      }
    } catch {
      return false;
    }
    return false;
  }

  function decrementStream(): void {
    activeStreams = Math.max(0, activeStreams - 1);
    if (activeStreams === 0) {
      emitLifecycle("stream_idle");
    }
  }

  function drainCloneStream(res: Response): void {
    try {
      const cloned = res.clone();
      const body = cloned.body;
      if (!body) {
        decrementStream();
        return;
      }
      const reader = body.getReader();
      const pump = (): void => {
        reader
          .read()
          .then(({ done }) => {
            if (done) {
              decrementStream();
            } else {
              pump();
            }
          })
          .catch(() => {
            decrementStream();
          });
      };
      pump();
    } catch {
      decrementStream();
    }
  }

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const urlStr =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : typeof Request !== "undefined" && input instanceof Request
              ? input.url
              : String(input ?? "");
      const method =
        init?.method ||
        (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET");

      if (!isGenerationRequest(urlStr, method)) {
        return origFetch.apply(this, arguments as unknown as [RequestInfo | URL, RequestInit?]);
      }

      activeStreams += 1;
      if (activeStreams === 1) {
        emitLifecycle("stream_active");
      }

      const promise = origFetch.apply(this, arguments as unknown as [RequestInfo | URL, RequestInit?]);
      promise.then(
        (res) => {
          if (!res.ok) {
            decrementStream();
            return;
          }
          drainCloneStream(res);
        },
        () => {
          decrementStream();
        }
      );
      return promise;
    };
  }

  const OrigEventSource = window.EventSource;
  if (typeof OrigEventSource === "function") {
    const WrappedEventSource = function (
      this: EventSource,
      url: string | URL,
      eventSourceInitDict?: EventSourceInit
    ): EventSource {
      const es = new OrigEventSource(url, eventSourceInitDict);
      const urlStr = String(url);
      if (/conversation|completion|stream/i.test(urlStr)) {
        activeStreams += 1;
        if (activeStreams === 1) emitLifecycle("stream_active");
        let closed = false;
        const closeOnce = () => {
          if (closed) return;
          closed = true;
          decrementStream();
        };
        es.addEventListener("error", closeOnce);
        const origClose = es.close.bind(es);
        es.close = () => {
          closeOnce();
          return origClose();
        };
      }
      return es;
    };
    WrappedEventSource.prototype = OrigEventSource.prototype;
    Object.defineProperty(window, "EventSource", {
      value: WrappedEventSource,
      writable: true,
      configurable: true,
    });
  }
})();

