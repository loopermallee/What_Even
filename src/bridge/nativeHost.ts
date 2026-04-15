type EvenNativeWindow = Window & typeof globalThis & {
  flutter_inappwebview?: unknown;
  webkit?: {
    messageHandlers?: {
      callHandler?: unknown;
    };
  };
};

export function hasEvenNativeHost() {
  if (typeof window === 'undefined') {
    return false;
  }

  const nativeWindow = window as EvenNativeWindow;
  return Boolean(
    nativeWindow.flutter_inappwebview
    || nativeWindow.webkit?.messageHandlers?.callHandler
  );
}
