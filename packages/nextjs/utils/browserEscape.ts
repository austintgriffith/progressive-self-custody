/**
 * Browser Escape Utility
 *
 * Provides functionality to escape from in-app browsers (Telegram, Instagram, etc.)
 * to the device's native browser where WebAuthn/Passkeys are supported.
 */

type Platform = "ios" | "android" | "unknown";

/**
 * Detect the user's platform from the user agent
 */
export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";

  const ua = navigator.userAgent.toLowerCase();

  // Check for iOS (iPhone, iPad, iPod)
  if (/iphone|ipad|ipod/.test(ua)) {
    return "ios";
  }

  // Check for Android
  if (/android/.test(ua)) {
    return "android";
  }

  return "unknown";
}

/**
 * Get the browser name to display to the user
 */
export function getBrowserName(): string {
  const platform = detectPlatform();

  switch (platform) {
    case "ios":
      return "Safari";
    case "android":
      return "Chrome";
    default:
      return "your browser";
  }
}

/**
 * Generate an escape URL that will open in the native browser
 *
 * - iOS: Uses x-safari-https:// URL scheme to force Safari
 * - Android: Uses Chrome intent URL
 * - Fallback: Returns the current URL for manual copy
 */
export function getEscapeUrl(targetUrl?: string): string {
  if (typeof window === "undefined") return targetUrl || "";

  const url = targetUrl || window.location.href;
  const platform = detectPlatform();

  switch (platform) {
    case "ios":
      // iOS Safari URL scheme - replace https:// with x-safari-https://
      // This works in most in-app browsers on iOS
      return url.replace(/^https:\/\//, "x-safari-https://").replace(/^http:\/\//, "x-safari-http://");

    case "android":
      // Chrome intent URL for Android
      // Format: intent://HOST/PATH#Intent;scheme=https;package=com.android.chrome;end
      try {
        const urlObj = new URL(url);
        const intentUrl = `intent://${urlObj.host}${urlObj.pathname}${urlObj.search}${urlObj.hash}#Intent;scheme=${urlObj.protocol.replace(":", "")};package=com.android.chrome;end`;
        return intentUrl;
      } catch {
        // If URL parsing fails, return original
        return url;
      }

    default:
      // Unknown platform - return original URL for manual copy
      return url;
  }
}

/**
 * Attempt to escape to the native browser
 * Returns true if escape was attempted, false if we should show manual instructions
 */
export function escapeToNativeBrowser(targetUrl?: string): boolean {
  const platform = detectPlatform();
  const escapeUrl = getEscapeUrl(targetUrl);

  if (platform === "unknown") {
    // Can't auto-escape on unknown platforms
    return false;
  }

  // Attempt to navigate to the escape URL
  window.location.href = escapeUrl;
  return true;
}

/**
 * Check if the error indicates an in-app browser that doesn't support passkeys
 */
export function isPasskeyNotAllowedError(error: unknown): boolean {
  if (!error) return false;

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorName = error instanceof Error ? error.name : "";

  // Check for common error patterns from in-app browsers
  const notAllowedPatterns = [
    "not allowed by the user agent",
    "not allowed by the platform",
    "NotAllowedError",
    "operation is not supported",
    "authenticator selection",
    "no available authenticator",
  ];

  const lowerMessage = errorMessage.toLowerCase();
  const lowerName = errorName.toLowerCase();

  return notAllowedPatterns.some(
    pattern => lowerMessage.includes(pattern.toLowerCase()) || lowerName.includes(pattern.toLowerCase()),
  );
}
