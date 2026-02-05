import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

/**
 * Serviço de criptografia para API Keys
 * Usa AES-256-GCM para criptografia segura
 */
export class EncryptionService {
  private getKey(secret: string): Buffer {
    // Usa uma chave derivada do secret (PEPPER do sistema)
    // Em produção, use uma chave master armazenada de forma segura
    const PEPPER = process.env.ENCRYPTION_PEPPER || 'zaploto-encryption-pepper-change-in-production';
    return crypto
      .createHash('sha256')
      .update(PEPPER)
      .digest();
  }

  /**
   * Criptografa uma string (API Key)
   */
  encrypt(text: string): string {
    if (!text) return '';

    const key = this.getKey('');
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    // Retorna: salt + iv + tag + encrypted
    return salt.toString('hex') + iv.toString('hex') + tag.toString('hex') + encrypted;
  }

  /**
   * Descriptografa uma string (API Key)
   */
  decrypt(encryptedText: string): string {
    if (!encryptedText) return '';

    try {
      const key = this.getKey('');
      
      // Extrai componentes
      const salt = Buffer.from(encryptedText.slice(0, SALT_LENGTH * 2), 'hex');
      const iv = Buffer.from(
        encryptedText.slice(SALT_LENGTH * 2, TAG_POSITION * 2),
        'hex'
      );
      const tag = Buffer.from(
        encryptedText.slice(TAG_POSITION * 2, ENCRYPTED_POSITION * 2),
        'hex'
      );
      const encrypted = encryptedText.slice(ENCRYPTED_POSITION * 2);

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (err: any) {
      console.error('❌ [ENCRYPTION] Erro ao descriptografar:', err);
      throw new Error('Erro ao descriptografar API Key');
    }
  }

  /**
   * Mascara API Key para exibição (mostra apenas últimos 4 caracteres)
   */
  maskApiKey(apiKey: string): string {
    if (!apiKey || apiKey.length < 4) return '****';
    return '••••' + apiKey.slice(-4);
  }
}

export const encryptionService = new EncryptionService();

