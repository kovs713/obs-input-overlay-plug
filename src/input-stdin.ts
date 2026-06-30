import readline from 'readline';

export function startStdinInput(onKey: (code: string, pressed: boolean) => void): { stop: () => void } {
  console.log('[Input] Stdin test mode enabled. Type keys to simulate presses.');
  console.log('[Input] Example: type "a" to simulate KeyA press/release');
  console.log('[Input] Press Ctrl+C to exit');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const handler = (key: string) => {
    const upper = key.toUpperCase();
    if (/^[A-Z0-9]$/.test(upper)) {
      const code = key.length === 1 && /[a-z]/.test(key)
        ? `Key${upper}`
        : /^[0-9]$/.test(key)
          ? `Digit${key}`
          : `Key${upper}`;

      onKey(code, true);
      setTimeout(() => onKey(code, false), 100);
    }
  };

  process.stdin.on('data', (chunk: Buffer) => {
    const str = chunk.toString();
    for (const ch of str) {
      handler(ch);
    }
  });

  return {
    stop: () => {
      rl.close();
    },
  };
}
