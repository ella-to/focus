const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function getCrypto(): Crypto {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Web Crypto API is not available in this environment')
  }
  return window.crypto
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof window === 'undefined') {
    throw new Error('Window is required for base64 encoding')
  }
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof window === 'undefined') {
    throw new Error('Window is required for base64 decoding')
  }
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function generateSalt(length = 16): string {
  const crypto = getCrypto()
  const salt = crypto.getRandomValues(new Uint8Array(length))
  return bytesToBase64(salt)
}

export async function deriveKey(password: string, saltBase64: string, iterations = 150_000): Promise<CryptoKey> {
  const crypto = getCrypto()
  const saltBytes = base64ToBytes(saltBase64)
  const salt = saltBytes.buffer as ArrayBuffer
  const keyMaterial = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptString(key: CryptoKey, plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const crypto = getCrypto()
  const ivBytes = crypto.getRandomValues(new Uint8Array(12))
  const encoded = textEncoder.encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes }, key, encoded)
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(ivBytes),
  }
}

export async function decryptString(key: CryptoKey, ciphertextBase64: string, ivBase64: string): Promise<string> {
  const crypto = getCrypto()
  const ciphertextBytes = base64ToBytes(ciphertextBase64)
  const ciphertext = ciphertextBytes.buffer as ArrayBuffer
  const ivBytes = base64ToBytes(ivBase64)
  const iv = ivBytes.buffer as ArrayBuffer
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return textDecoder.decode(plaintext)
}

export function generateRandomVerificationString(length = 32): string {
  const crypto = getCrypto()
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return bytesToBase64(bytes)
}

export function encodeBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
}

export function decodeBase64(value: string): Uint8Array {
  return base64ToBytes(value)
}
