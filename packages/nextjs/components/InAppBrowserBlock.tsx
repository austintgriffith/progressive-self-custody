"use client";

import { useState } from "react";
import { CheckIcon, ClipboardIcon } from "@heroicons/react/24/outline";
import { getBrowserName } from "~~/utils/browserEscape";

interface InAppBrowserBlockProps {
  message?: string;
}

export function InAppBrowserBlock({ message }: InAppBrowserBlockProps) {
  const [copied, setCopied] = useState(false);
  const browserName = getBrowserName();
  const currentUrl = typeof window !== "undefined" ? window.location.href : "";

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URL:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-base-100 flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        {/* Icon */}
        <div className="text-6xl mb-6">🔒</div>

        {/* Title */}
        <h1 className="text-2xl font-bold mb-3">Open in {browserName}</h1>

        {/* Message */}
        <p className="text-base-content/70 mb-6">
          {message || "This browser doesn't support passkeys. Copy the link below and open it in your browser."}
        </p>

        {/* URL Copy Section - Now Primary */}
        <div className="bg-base-200 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-mono break-all opacity-80 truncate">{currentUrl}</p>
            </div>
            <button onClick={handleCopyUrl} className={`btn ${copied ? "btn-success" : "btn-primary"} btn-sm shrink-0`}>
              {copied ? (
                <>
                  <CheckIcon className="w-4 h-4" />
                  Copied!
                </>
              ) : (
                <>
                  <ClipboardIcon className="w-4 h-4" />
                  Copy Link
                </>
              )}
            </button>
          </div>
        </div>

        {/* Help text */}
        <p className="text-sm text-base-content/60">Paste in {browserName} to continue</p>
      </div>
    </div>
  );
}
