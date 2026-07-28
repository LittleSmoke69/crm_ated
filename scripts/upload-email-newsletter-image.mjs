/**
 * Sobe a imagem padrão da newsletter para o Storage self-hosted.
 *
 * Uso:
 *   node --env-file=.env scripts/upload-email-newsletter-image.mjs
 *
 * Requer no .env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Depende do bucket `email-assets` (migration create_email_assets_storage_bucket.sql).
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'email-assets';
const OBJECT_PATH = 'newsletter/consultoria.jpg';
const FILE = path.join(__dirname, 'assets', 'newsletter-consultoria.jpg');

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
    process.exit(1);
  }
  if (!fs.existsSync(FILE)) {
    console.error('Arquivo não encontrado:', FILE);
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const buf = fs.readFileSync(FILE);

  const { error } = await supabase.storage.from(BUCKET).upload(OBJECT_PATH, buf, {
    contentType: 'image/jpeg',
    upsert: true,
    cacheControl: '31536000',
  });

  if (error) {
    console.error('Upload falhou:', error.message);
    if (/bucket not found/i.test(error.message)) {
      console.error('Rode antes: migrations/create_email_assets_storage_bucket.sql');
    }
    process.exit(1);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(OBJECT_PATH);
  console.log('OK — imagem publicada em:');
  console.log(data.publicUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
