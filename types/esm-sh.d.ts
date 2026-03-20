declare module 'https://esm.sh/*' {
  export * from '@supabase/supabase-js';
}

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};
