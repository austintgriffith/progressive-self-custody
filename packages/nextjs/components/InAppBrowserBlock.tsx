"use client";

import { useState } from "react";
import { CheckIcon, ClipboardIcon } from "@heroicons/react/24/outline";
import { escapeToNativeBrowser, getBrowserName } from "~~/utils/browserEscape";

interface InAppBrowserBlockProps {
  message?: string;
}

export function InAppBrowserBlock({ message }: InAppBrowserBlockProps) {
  const [copied, setCopied] = useState(false);
  const browserName = getBrowserName();
  const currentUrl = typeof window !== "undefined" ? window.location.href : "";

  const handleOpenInBrowser = () => {
    escapeToNativeBrowser();
  };

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
        <p className="text-base-content/70 mb-8">
          {message ||
            "This browser doesn't support passkeys. Please open this page in your device's browser to continue."}
        </p>

        {/* Primary Action - Open in Browser */}
        <button onClick={handleOpenInBrowser} className="btn btn-primary btn-lg w-full mb-4 text-lg">
          Open in {browserName}
        </button>

        {/* Divider */}
        <div className="divider text-sm opacity-60">or copy the link manually</div>

        {/* URL Copy Section */}
        <div className="bg-base-200 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <div className="flex-1 text-left">
              <p className="text-xs text-base-content/50 mb-1">Copy this link:</p>
              <p className="text-sm font-mono break-all opacity-80">{currentUrl}</p>
            </div>
            <button
              onClick={handleCopyUrl}
              className={`btn btn-ghost btn-sm ${copied ? "text-success" : ""}`}
              title={copied ? "Copied!" : "Copy URL"}
            >
              {copied ? <CheckIcon className="w-5 h-5" /> : <ClipboardIcon className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Help text */}
        <p className="text-xs text-base-content/50 mt-6">
          Paste the link in {browserName} to sign in with your passkey.
        </p>
      </div>
    </div>
  );
}
